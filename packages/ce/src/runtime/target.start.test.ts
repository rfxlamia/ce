import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  openTarget,
  TargetConfigError,
  TargetStartError,
  TargetUnreachableError,
  type TargetOptions,
} from './target.js';

// Start_Mode unit tests (task 5.3). Fake spawn, fake fetch, fake process.

type Step = number | Error | 'hang';

class FakeChild extends EventEmitter {
  pid: number | undefined;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(withPid = true) {
    super();
    this.pid = withPid ? 4242 : undefined;
  }
  out(text: string): void {
    this.stdout.emit('data', Buffer.from(text, 'utf8'));
  }
  exit(code: number | null, signal: string | null = null): void {
    this.emit('exit', code, signal);
  }
}

interface Rig {
  options: TargetOptions;
  child: FakeChild;
  spawn: ReturnType<typeof vi.fn>;
  kills: { pid: number; sig: string }[];
  fetchCalls: { url: string; init: RequestInit | undefined }[];
  abortTimes: number[];
}

interface RigInit {
  steps?: Step[];
  /** Signals that make the fake child exit. Default: SIGTERM and SIGKILL. */
  exitOn?: string[];
  child?: FakeChild;
  spawnThrows?: boolean;
  afterSpawn?: (child: FakeChild) => void;
  extra?: Partial<TargetOptions>;
}

function rig(init: RigInit = {}): Rig {
  const steps = init.steps ?? [503, 200];
  const child = init.child ?? new FakeChild();
  const exitOn = init.exitOn ?? ['SIGTERM', 'SIGKILL'];
  const kills: Rig['kills'] = [];
  const fetchCalls: Rig['fetchCalls'] = [];
  const abortTimes: number[] = [];
  let i = 0;
  const fakeFetch = ((url: string | URL | Request, reqInit?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: reqInit });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    if (step === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        reqInit?.signal?.addEventListener('abort', () => {
          abortTimes.push(Date.now());
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(new Response(null, { status: step as number }));
  }) as typeof fetch;

  const spawn = vi.fn((_command: string, _opts: unknown) => {
    if (init.spawnThrows) throw new Error('spawn exploded');
    init.afterSpawn?.(child);
    return child;
  });
  const fakeProcess = {
    pid: 1,
    kill: (pid: number, sig: string) => {
      kills.push({ pid, sig });
      if (exitOn.includes(sig)) queueMicrotask(() => child.exit(null, sig));
      return true;
    },
    on: () => fakeProcess,
    removeListener: () => fakeProcess,
  };
  const options: TargetOptions = {
    url: 'http://127.0.0.1:4321',
    start: 'npm run dev',
    cwd: '/work',
    env: {},
    fetch: fakeFetch,
    spawn: spawn as unknown as TargetOptions['spawn'],
    process: fakeProcess as unknown as NodeJS.Process,
    ...init.extra,
  };
  return { options, child, spawn, kills, fetchCalls, abortTimes };
}

async function catchError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected rejection');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('spawn failure and early exit', () => {
  it('throws TargetStartError when spawn throws, and probes nothing after the pre-probe (2.9)', async () => {
    const r = rig({ spawnThrows: true, steps: [503] });
    const err = await catchError(openTarget(r.options));
    expect(err).toBeInstanceOf(TargetStartError);
    expect((err as TargetStartError).command).toBe('npm run dev');
    expect(r.fetchCalls).toHaveLength(1); // the Pre_Start_Probe only
  });

  it('throws TargetStartError with logTail when the process has no pid, and does not probe (2.9, 5.6)', async () => {
    const r = rig({
      steps: [503],
      child: new FakeChild(false),
      afterSpawn: (c) => {
        // A spawn failure that is reported on stderr and by an error event.
        setImmediate(() => c.emit('error', new Error('ENOENT')));
      },
    });
    const err = (await catchError(openTarget(r.options))) as TargetStartError;
    expect(err).toBeInstanceOf(TargetStartError);
    expect(err.logTail).toBeDefined();
    expect(r.fetchCalls).toHaveLength(1);
  });

  it('throws TargetStartError with exitCode and logTail when the process exits before readiness, without waiting for the Ready_Timeout (2.10)', async () => {
    const clock = { t: 0 };
    const r = rig({
      steps: [503],
      afterSpawn: (c) => {
        setImmediate(() => {
          c.out('boom: cannot bind port\n');
          c.exit(3, null);
        });
      },
      extra: {
        ready: { timeout: '60s' },
        now: () => clock.t,
        sleep: async (ms) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          clock.t += ms;
        },
      },
    });
    const err = (await catchError(openTarget(r.options))) as TargetStartError;
    expect(err).toBeInstanceOf(TargetStartError);
    expect(err.exitCode).toBe(3);
    expect(err.signal).toBeNull();
    expect(err.logTail).toContain('boom: cannot bind port');
    expect(clock.t).toBeLessThan(60_000);
    expect(r.kills).toEqual([]); // already exited: no signal
  });
});

describe('spawn arguments', () => {
  it('spawns once with shell, detached: true and the caller cwd (2.3)', async () => {
    const r = rig();
    const handle = await openTarget(r.options);
    expect(r.spawn).toHaveBeenCalledTimes(1);
    const [command, opts] = r.spawn.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe('npm run dev');
    expect(opts.detached).toBe(true);
    expect(opts.shell).toBe(true);
    expect(opts.cwd).toBe('/work');
    expect(handle.mode).toBe('started');
    await handle.stop();
  });
});

describe('stop state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sends SIGTERM to the group, then SIGKILL after the 5 s grace period (2.4, 2.5)', async () => {
    const r = rig({ exitOn: [] });
    const handle = await openTarget(r.options);
    const stopped = vi.fn();
    const p = handle.stop().then(stopped);

    await vi.advanceTimersByTimeAsync(0);
    expect(r.kills).toEqual([{ pid: -4242, sig: 'SIGTERM' }]);

    await vi.advanceTimersByTimeAsync(4999);
    expect(r.kills).toEqual([{ pid: -4242, sig: 'SIGTERM' }]);

    await vi.advanceTimersByTimeAsync(1);
    expect(r.kills).toEqual([
      { pid: -4242, sig: 'SIGTERM' },
      { pid: -4242, sig: 'SIGKILL' },
    ]);

    r.child.exit(null, 'SIGKILL');
    await p;
    expect(stopped).toHaveBeenCalled();
    expect(handle.warnings).toEqual([]);
  });

  it('resolves 5 s after SIGKILL with one warning when the process never exits (2.5, 2.6)', async () => {
    const r = rig({ exitOn: [] });
    const handle = await openTarget(r.options);
    const stopped = vi.fn();
    const p = handle.stop().then(stopped);

    await vi.advanceTimersByTimeAsync(5000); // SIGKILL sent
    expect(r.kills.map((k) => k.sig)).toEqual(['SIGTERM', 'SIGKILL']);
    await vi.advanceTimersByTimeAsync(4999);
    expect(stopped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(stopped).toHaveBeenCalled();
    expect(handle.warnings).toHaveLength(1);
    expect(handle.warnings[0]).toContain('npm run dev');
    expect(handle.warnings[0]).toContain('4242');
  });

  it('a second stop() does nothing: same promise, no further signal, no second warning (2.6)', async () => {
    const r = rig({ exitOn: [] });
    const handle = await openTarget(r.options);
    const first = handle.stop();
    const second = handle.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([first, second]);
    const killsAfterFirst = r.kills.length;
    await handle.stop();
    expect(r.kills).toHaveLength(killsAfterFirst);
    expect(r.kills.map((k) => k.sig)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(handle.warnings).toHaveLength(1);
  });

  it('stop() after a natural exit sends no signal and records the exit (6.6)', async () => {
    const r = rig();
    const handle = await openTarget(r.options);
    r.child.exit(0, null);
    await handle.stop();
    expect(r.kills).toEqual([]);
    expect(handle.exited).toEqual({ exitCode: 0, signal: null });
  });
});

describe('Pre_Start_Probe', () => {
  it.each([200, 204, 301, 302, 399])(
    'status %i before spawn throws "already served" and never spawns (2.11)',
    async (status) => {
      const r = rig({ steps: [status] });
      const err = await catchError(openTarget(r.options));
      expect(err).toBeInstanceOf(TargetConfigError);
      expect((err as Error).message).toMatch(/already served/);
      expect((err as TargetConfigError).key).toBe('target.url');
      expect(r.spawn).not.toHaveBeenCalled();
      expect(r.fetchCalls).toHaveLength(1);
    },
  );

  it('spawns after a 503 pre-probe (2.11)', async () => {
    const r = rig({ steps: [503, 200] });
    const handle = await openTarget(r.options);
    expect(r.spawn).toHaveBeenCalledTimes(1);
    await handle.stop();
  });

  it('spawns after a pre-probe that throws (2.11)', async () => {
    const r = rig({ steps: [new TypeError('fetch failed'), 200] });
    const handle = await openTarget(r.options);
    expect(r.spawn).toHaveBeenCalledTimes(1);
    await handle.stop();
  });

  it('uses a 2 s request timeout and does not consume the Ready_Timeout (2.12, 3.7)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const r = rig({ steps: ['hang', 503], extra: { ready: { timeout: '3s' } } });
    const t0 = Date.now();
    const result = openTarget(r.options).then(
      () => null,
      (e: unknown) => e,
    );

    await vi.advanceTimersByTimeAsync(1999);
    expect(r.spawn).not.toHaveBeenCalled();
    expect(r.abortTimes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.abortTimes).toEqual([t0 + 2000]); // the pre-probe aborted at 2 s
    expect(r.spawn).toHaveBeenCalledTimes(1);

    // The full Ready_Timeout of probing follows the spawn.
    await vi.advanceTimersByTimeAsync(10_000);
    const err = (await result) as TargetUnreachableError;
    expect(err).toBeInstanceOf(TargetUnreachableError);
    expect(err.mode).toBe('started');
    expect(err.timeoutMs).toBe(3000);
    expect(err.lastStatus).toBe(503);
    // Readiness probes after the pre-probe: roughly 3000 / 250 of them.
    const readinessProbes = r.fetchCalls.length - 1;
    expect(readinessProbes).toBeGreaterThanOrEqual(10);
    // The started process was stopped before the error was thrown.
    expect(r.kills.map((k) => k.sig)).toEqual(['SIGTERM']);
  });

  it('records only GET requests, pre-probe included (3.7)', async () => {
    const r = rig({ steps: [503, 503, 200] });
    const handle = await openTarget(r.options);
    expect(r.fetchCalls.length).toBeGreaterThanOrEqual(3);
    for (const call of r.fetchCalls) {
      expect(call.init?.method).toBe('GET');
    }
    await handle.stop();
  });
});

describe('environment of the started process', () => {
  const KEY_A = 'sk-or-dummy-AAAA1111';
  const KEY_B = 'ts-dummy-BBBB2222';
  const baseEnv = {
    OPENROUTER_API_KEY: KEY_A,
    TYPESAFE_API_KEY: KEY_B,
    EXTRA_SECRET: 'extra-dummy-CCCC3333',
    PATH: '/usr/bin',
    FOO: 'bar',
  };

  it.each([
    ['[]', [] as string[] | undefined],
    ['absent', undefined],
    ['another name', ['OTHER_NAME']],
  ])('removes both CE keys and keeps other names with secrets %s (2.7)', async (_label, secrets) => {
    const r = rig({
      extra: { env: { ...baseEnv, OTHER_NAME: 'other-value' }, ...(secrets !== undefined ? { secrets } : {}) },
    });
    const handle = await openTarget(r.options);
    const env = (r.spawn.mock.calls[0]![1] as { env: Record<string, string> }).env;
    expect(env).not.toHaveProperty('OPENROUTER_API_KEY');
    expect(env).not.toHaveProperty('TYPESAFE_API_KEY');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.FOO).toBe('bar');
    expect(env.EXTRA_SECRET).toBe('extra-dummy-CCCC3333');
    if (secrets?.includes('OTHER_NAME')) {
      expect(env).not.toHaveProperty('OTHER_NAME');
    } else {
      expect(env.OTHER_NAME).toBe('other-value');
    }
    await handle.stop();
  });

  it('removes an extra configured secret name from the environment (2.7)', async () => {
    const r = rig({ extra: { env: baseEnv, secrets: ['EXTRA_SECRET'] } });
    const handle = await openTarget(r.options);
    const env = (r.spawn.mock.calls[0]![1] as { env: Record<string, string> }).env;
    expect(env).not.toHaveProperty('EXTRA_SECRET');
    expect(env.FOO).toBe('bar');
    await handle.stop();
  });

  describe('output that prints the dummy keys', () => {
    let runDir: string;
    beforeEach(async () => {
      runDir = await mkdtemp(join(tmpdir(), 'ce-target-start-'));
    });
    afterEach(async () => {
      await rm(runDir, { recursive: true, force: true });
    });

    it('leaves neither key in handle.logs nor in target.log after a successful start (5.6, 11.16, 11.17)', async () => {
      const r = rig({ extra: { env: baseEnv, runDir } });
      const handle = await openTarget(r.options);
      r.child.out(`key one ${KEY_A} and `);
      r.child.stdout.emit('data', Buffer.from(KEY_B.slice(0, 6)));
      r.child.stdout.emit('data', Buffer.from(`${KEY_B.slice(6)} done\n`));
      r.child.stderr.emit('data', Buffer.from(`err ${KEY_A}\n`));
      await handle.stop();

      const file = await readFile(join(runDir, 'target.log'), 'utf8');
      for (const text of [handle.logs, file]) {
        expect(text).not.toContain(KEY_A);
        expect(text).not.toContain(KEY_B);
        expect(text).toContain('key one');
        expect(text).toContain('***');
      }
    });

    it('leaves neither key in logTail of TargetStartError, the capture or the file (5.6, 11.16, 11.17)', async () => {
      const r = rig({
        steps: [503],
        extra: { env: baseEnv, runDir },
        afterSpawn: (c) => {
          setImmediate(() => {
            c.out(`token=${KEY_A} other=${KEY_B}\n`);
            c.exit(1, null);
          });
        },
      });
      const err = (await catchError(openTarget(r.options))) as TargetStartError;
      expect(err).toBeInstanceOf(TargetStartError);
      expect(err.logTail).toBeDefined();
      expect(err.logTail).not.toContain(KEY_A);
      expect(err.logTail).not.toContain(KEY_B);
      expect(err.logTail).toContain('token=');
      expect(err.message).not.toContain(KEY_A);
      const file = await readFile(join(runDir, 'target.log'), 'utf8');
      expect(file).not.toContain(KEY_A);
      expect(file).not.toContain(KEY_B);
    });
  });
});

describe('TargetUnreachableError in Start_Mode', () => {
  it('carries logTail and stops the process before throwing (4.5, 5.6)', async () => {
    vi.useFakeTimers();
    const r = rig({
      steps: [503],
      afterSpawn: (c) => setImmediate(() => c.out('still booting\n')),
      extra: { ready: { timeout: '1s' } },
    });
    const result = openTarget(r.options).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(5000);
    const err = (await result) as TargetUnreachableError;
    expect(err).toBeInstanceOf(TargetUnreachableError);
    expect(err.logTail).toContain('still booting');
    expect(r.kills.map((k) => k.sig)).toEqual(['SIGTERM']);
  });
});
