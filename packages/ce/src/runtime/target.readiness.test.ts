import { describe, expect, it, vi } from 'vitest';

import {
  openTarget,
  TargetConfigError,
  TargetUnreachableError,
  type TargetOptions,
} from './target.js';

// Attach_Mode readiness unit tests (task 4.3). Fake fetch, fake clock, fake sleep.

type Step = number | Error | 'hang';

interface Harness {
  options: TargetOptions;
  calls: { url: string; init: RequestInit | undefined }[];
  sleeps: number[];
  spawn: ReturnType<typeof vi.fn>;
  clock: { t: number };
}

function harness(steps: Step[], extra: Partial<TargetOptions> = {}): Harness {
  const clock = { t: 0 };
  const calls: Harness['calls'] = [];
  const sleeps: number[] = [];
  const spawn = vi.fn();
  let i = 0;
  const fakeFetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    if (step === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          // The probe's own timeout fired: the clock has moved by that much.
          clock.t += 300;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(new Response(null, { status: step as number }));
  }) as typeof fetch;
  const options: TargetOptions = {
    url: 'http://127.0.0.1:4321',
    cwd: '/tmp',
    env: {},
    fetch: fakeFetch,
    now: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
    spawn: spawn as unknown as TargetOptions['spawn'],
    ...extra,
  };
  return { options, calls, sleeps, spawn, clock };
}

async function catchError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected rejection');
}

describe('Attach_Mode readiness', () => {
  it('resolves for 503, 503, 200 after two 250 ms retries (1.2, 3.3, 3.4, 11.7)', async () => {
    const h = harness([503, 503, 200]);
    const handle = await openTarget(h.options);
    expect(handle.mode).toBe('attached');
    expect(handle.baseUrl).toBe('http://127.0.0.1:4321');
    expect(handle.lastStatus).toBe(200);
    expect(h.calls).toHaveLength(3);
    expect(h.sleeps).toEqual([250, 250]);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('resolves after the first ready probe without sleeping (1.3)', async () => {
    const h = harness([200]);
    await openTarget(h.options);
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it('resolves for a 3xx status and does not follow the redirect (3.5)', async () => {
    const h = harness([302]);
    const handle = await openTarget(h.options);
    expect(handle.lastStatus).toBe(302);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.init?.redirect).toBe('manual');
  });

  it('records GET as the only method (3.7)', async () => {
    const h = harness([503, 200]);
    await openTarget(h.options);
    expect(h.calls.length).toBeGreaterThan(1);
    expect(new Set(h.calls.map((c) => c.init?.method))).toEqual(new Set(['GET']));
  });

  it('uses ready.path "/" and a 30 s timeout by default (3.1, 3.9)', async () => {
    const h = harness([503]);
    const err = (await catchError(openTarget({ ...h.options, url: 'http://127.0.0.1:4321/app' }))) as TargetUnreachableError;
    expect(err).toBeInstanceOf(TargetUnreachableError);
    expect(err.timeoutMs).toBe(30000);
    expect(h.calls[0]!.url).toBe('http://127.0.0.1:4321/app/');
  });

  it('uses a configured ready.path and ready.timeout (3.1)', async () => {
    const h = harness([503]);
    const err = (await catchError(
      openTarget({ ...h.options, ready: { path: '/health', timeout: '2s' } }),
    )) as TargetUnreachableError;
    expect(err.timeoutMs).toBe(2000);
    expect(h.calls[0]!.url).toBe('http://127.0.0.1:4321/health');
  });

  it('throws TargetUnreachableError with the last status when nothing becomes ready (3.8, 4.1, 4.2)', async () => {
    const h = harness([503, 503, 500]);
    const err = (await catchError(openTarget({ ...h.options, ready: { timeout: '1s' } }))) as TargetUnreachableError;
    expect(err).toBeInstanceOf(TargetUnreachableError);
    expect(err.lastStatus).toBe(500);
    expect(err.timeoutMs).toBe(1000);
    expect(err.mode).toBe('attached');
    expect(err.url).toBe('http://127.0.0.1:4321');
    // nextReadinessAction times out when elapsed + 250 >= timeout, so with a 1000 ms
    // timeout probes run at 0, 250, 500, 750 and none at 1000 (see report: no probe in the last 250 ms).
    expect(h.calls).toHaveLength(4);
    expect(h.clock.t).toBe(750);
  });

  it('reports lastStatus "timeout" for a hanging probe (4.3, 3.6, 11.7)', async () => {
    const h = harness(['hang']);
    const err = (await catchError(openTarget({ ...h.options, ready: { timeout: '300ms' } }))) as TargetUnreachableError;
    expect(err).toBeInstanceOf(TargetUnreachableError);
    expect(err.lastStatus).toBe('timeout');
  });

  it.each([
    ['ECONNREFUSED', 'connection-refused'],
    ['ENOTFOUND', 'dns'],
    ['EAI_AGAIN', 'dns'],
    ['ECONNRESET', 'network'],
  ])('maps a throwing probe (%s) to %s (4.3, 4.4)', async (code, kind) => {
    const h = harness([Object.assign(new TypeError('fetch failed'), { cause: { code } })]);
    const err = (await catchError(openTarget({ ...h.options, ready: { timeout: '1s' } }))) as TargetUnreachableError;
    expect(err.lastStatus).toBe(kind);
  });

  it('keeps the last status of an earlier response when the final probe only differs by kind (4.1)', async () => {
    const h = harness([503, Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]);
    const err = (await catchError(openTarget({ ...h.options, ready: { timeout: '1s' } }))) as TargetUnreachableError;
    expect(err.lastStatus).toBe('connection-refused');
  });
});

describe('TargetConfigError before any probe or spawn (8.3, 8.4, 3.10, 11.10)', () => {
  const cases: [string, Partial<TargetOptions>, string][] = [
    ['start without url', { url: undefined, start: 'npm run dev' }, 'target.url'],
    ['neither url nor start', { url: undefined }, 'target.url'],
    ['start with a non-loopback url', { start: 'npm run dev', url: 'http://example.com:3000' }, 'target.url'],
    ['invalid ready.timeout', { ready: { timeout: 'soon' } }, 'target.ready.timeout'],
  ];

  it.each(cases)('%s', async (_name, patch, key) => {
    const h = harness([200]);
    const err = await catchError(openTarget({ ...h.options, ...patch }));
    expect(err).toBeInstanceOf(TargetConfigError);
    expect((err as TargetConfigError).key).toBe(key);
    expect(h.calls).toHaveLength(0);
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe('error content (4.7, 5.7, 11.11)', () => {
  const userinfoUrl = 'http://alice:s3cret@127.0.0.1:4321';

  it('credentialed URL is rejected up front, without userinfo in the error and without probing', async () => {
    const h = harness([503]);
    const err = (await catchError(
      openTarget({ ...h.options, url: userinfoUrl, ready: { timeout: '1s' }, env: { OPENROUTER_API_KEY: 'sk-dummy' } }),
    )) as TargetConfigError;
    expect(err).toBeInstanceOf(TargetConfigError);
    expect(err.key).toBe('target.url');
    expect(err.message).toContain('credentials is not supported');
    expect(err.message).not.toContain('alice');
    expect(err.message).not.toContain('s3cret');
    expect(err.message).not.toContain('sk-dummy');
    expect(h.calls).toHaveLength(0);
  });
  it('credentialed URL fails fast with the real fetch', async () => {
    const started = Date.now();
    const err = await catchError(openTarget({ url: 'http://alice:s3cret@127.0.0.1:9', ready: { timeout: '30s' }, cwd: process.cwd(), env: {} }));
    expect(err).toBeInstanceOf(TargetConfigError);
    expect(Date.now() - started).toBeLessThan(2000);
  });
  it('TargetConfigError carries no userinfo', async () => {
    const h = harness([200]);
    const err = (await catchError(
      openTarget({ ...h.options, url: 'http://alice:s3cret@example.com', start: 'npm run dev' }),
    )) as TargetConfigError;
    expect(err).toBeInstanceOf(TargetConfigError);
    expect(err.message).not.toContain('alice');
    expect(err.message).not.toContain('s3cret');
  });
});

describe('AbortSignal during the wait (6.2)', () => {
  it('throws AbortError when aborted while sleeping between probes', async () => {
    const controller = new AbortController();
    const h = harness([503]);
    const options: TargetOptions = {
      ...h.options,
      signal: controller.signal,
      sleep: async (ms) => {
        h.sleeps.push(ms);
        controller.abort();
      },
    };
    const err = await catchError(openTarget(options));
    expect((err as Error).name).toBe('AbortError');
    expect(h.calls).toHaveLength(1);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('throws AbortError when already aborted before the first probe', async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness([200]);
    const err = await catchError(openTarget({ ...h.options, signal: controller.signal }));
    expect((err as Error).name).toBe('AbortError');
    expect(h.calls).toHaveLength(0);
  });
});
