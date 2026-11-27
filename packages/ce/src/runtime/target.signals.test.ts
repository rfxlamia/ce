import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { openTarget } from './target.js';
import type { TargetOptions } from './target.js';

const CHILD_PID = 4242;
const SELF_PID = 1000;

interface Harness {
  events: string[];
  child: EventEmitter;
  proc: EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> };
  spawn: ReturnType<typeof vi.fn>;
  fetch: typeof fetch;
  options: TargetOptions;
  exitChild: () => void;
}

/** Fake process + fake spawn + fake fetch (503 for the pre-probe, then `readyStatus`). */
function harness(opts: { autoExit?: boolean; readyStatus?: number } = {}): Harness {
  const autoExit = opts.autoExit ?? true;
  const readyStatus = opts.readyStatus ?? 200;
  const events: string[] = [];

  const child = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter };
  child.pid = CHILD_PID;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const exitChild = (): void => {
    events.push('child-exit');
    child.emit('exit', null, 'SIGTERM');
  };

  const proc = new EventEmitter() as Harness['proc'];
  proc.pid = SELF_PID;
  proc.kill = vi.fn((pid: number, sig: string | number) => {
    if (sig === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    if (pid === -CHILD_PID) {
      events.push(`group:${sig}`);
      if (autoExit && (sig === 'SIGTERM' || sig === 'SIGKILL')) exitChild();
    } else if (pid === SELF_PID) {
      events.push(`self:${sig}`);
    }
    return true;
  });

  const spawn = vi.fn(() => child);
  let calls = 0;
  const fetchFn = (async () => {
    calls += 1;
    return new Response(null, { status: calls === 1 ? 503 : readyStatus });
  }) as unknown as typeof fetch;

  const options: TargetOptions = {
    url: 'http://127.0.0.1:39999',
    start: 'serve',
    cwd: '/tmp',
    env: {},
    fetch: fetchFn,
    spawn: spawn as unknown as typeof nodeSpawn,
    process: proc as unknown as NodeJS.Process,
  };
  return { events, child, proc, spawn, fetch: fetchFn, options, exitChild };
}

const SIGNAL_EVENTS = ['SIGINT', 'SIGTERM', 'exit'] as const;
const listenerCounts = (p: EventEmitter): number[] => SIGNAL_EVENTS.map((e) => p.listenerCount(e));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('stopOnSignals', () => {
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    it(`${sig} stops the process, removes listeners, then re-raises ${sig} once`, async () => {
      const h = harness();
      const handle = await openTarget({ ...h.options, stopOnSignals: true });
      expect(listenerCounts(h.proc)).toEqual([1, 1, 1]);

      h.proc.emit(sig, sig);
      await tick();

      expect(h.events).toEqual([`group:SIGTERM`, 'child-exit', `self:${sig}`]);
      expect(h.proc.kill.mock.calls.filter(([pid]) => pid === SELF_PID)).toEqual([[SELF_PID, sig]]);
      expect(listenerCounts(h.proc)).toEqual([0, 0, 0]);
      await handle.stop();
    });
  }

  it('the exit listener sends SIGTERM to the group synchronously', async () => {
    const h = harness({ autoExit: false });
    await openTarget({ ...h.options, stopOnSignals: true });

    h.proc.emit('exit', 0);

    expect(h.proc.kill).toHaveBeenCalledWith(-CHILD_PID, 'SIGTERM');
    expect(h.events).toEqual(['group:SIGTERM']);
  });

  it('ignores a second signal while stopping', async () => {
    const h = harness({ autoExit: false });
    await openTarget({ ...h.options, stopOnSignals: true });

    h.proc.emit('SIGTERM', 'SIGTERM');
    h.proc.emit('SIGINT', 'SIGINT');
    h.proc.emit('SIGTERM', 'SIGTERM');
    await tick();
    expect(h.events).toEqual(['group:SIGTERM']);

    h.exitChild();
    await tick();

    expect(h.events).toEqual(['group:SIGTERM', 'child-exit', 'self:SIGTERM']);
    expect(h.proc.kill.mock.calls.filter(([pid]) => pid === SELF_PID)).toHaveLength(1);
  });

  it('registers no listener when stopOnSignals is absent', async () => {
    const h = harness();
    const handle = await openTarget(h.options);
    expect(listenerCounts(h.proc)).toEqual([0, 0, 0]);
    await handle.stop();
  });

  it('leaves no listener after stop()', async () => {
    const h = harness();
    const handle = await openTarget({ ...h.options, stopOnSignals: true });
    expect(listenerCounts(h.proc)).toEqual([1, 1, 1]);

    await handle.stop();

    expect(listenerCounts(h.proc)).toEqual([0, 0, 0]);
    expect(h.events.some((e) => e.startsWith('self:'))).toBe(false);
  });
});

describe('abort during readiness', () => {
  it('stops the started process and throws AbortError', async () => {
    const h = harness({ readyStatus: 503 });
    const controller = new AbortController();
    const pending = openTarget({
      ...h.options,
      stopOnSignals: true,
      signal: controller.signal,
      sleep: () => new Promise((r) => setTimeout(r, 2)),
    });
    const outcome = pending.then(
      () => undefined,
      (e: unknown) => e,
    );

    const deadline = Date.now() + 2000;
    while (h.spawn.mock.calls.length === 0 && Date.now() < deadline) await tick();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    controller.abort();

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('AbortError');
    expect(h.events).toEqual(['group:SIGTERM', 'child-exit']);
    expect(listenerCounts(h.proc)).toEqual([0, 0, 0]);
  });
});
