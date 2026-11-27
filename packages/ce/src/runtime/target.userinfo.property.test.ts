import { EventEmitter } from 'node:events';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TargetStartError, TargetUnreachableError, openTarget } from './target.js';
import type { TargetOptions } from './target.js';

// Marker-prefixed alphanumerics: cannot appear incidentally in messages or URLs, and
// survive URL parsing without percent-encoding.
const username = fc.stringMatching(/^[a-z0-9]{1,8}$/).map((s) => `zqxuser${s}`);
const password = fc.stringMatching(/^[a-z0-9]{1,8}$/).map((s) => `zqxpass${s}`);
const port = fc.integer({ min: 1, max: 65535 });
const loopback = fc.constantFrom('localhost', '127.0.0.1', '[::1]', '0.0.0.0');
const remote = fc.constantFrom('example.com', 'api.example.org', '10.1.2.3', '[2001:db8::1]');

interface Userinfo {
  user: string;
  pass: string;
  /** `user:pass`, `user` or `:pass` forms are all covered by the generator. */
  info: string;
}

const userinfo: fc.Arbitrary<Userinfo> = fc
  .tuple(username, password, fc.constantFrom('both', 'user', 'pass'))
  .map(([user, pass, form]) => {
    if (form === 'user') return { user, pass: '', info: user };
    if (form === 'pass') return { user: '', pass, info: `:${pass}` };
    return { user, pass, info: `${user}:${pass}` };
  });

function fakes(opts: { response?: number } = {}) {
  let t = 0;
  let spawnCalls = 0;
  const fetchFn = (async () => {
    if (opts.response !== undefined) return new Response(null, { status: opts.response });
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  }) as unknown as typeof fetch;
  const fakeProcess = Object.assign(new EventEmitter(), {
    pid: 1,
    kill: () => true,
  }) as unknown as NodeJS.Process;
  const spawn = (() => {
    spawnCalls++;
    return Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
  }) as never;
  return {
    spawnCalls: () => spawnCalls,
    base: {
      cwd: '/tmp',
      env: {},
      fetch: fetchFn,
      spawn,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
      process: fakeProcess,
    } satisfies TargetOptions,
  };
}

async function thrown(options: TargetOptions): Promise<unknown> {
  return openTarget(options).then(
    () => undefined,
    (e: unknown) => e,
  );
}

function expectNoLeak(error: unknown, info: Userinfo): void {
  expect(error).toBeInstanceOf(Error);
  const e = error as Error & { url?: unknown };
  const texts = [e.message, String(e), ...(typeof e.url === 'string' ? [e.url] : [])];
  for (const text of texts) {
    if (info.user !== '') expect(text).not.toContain(info.user);
    if (info.pass !== '') expect(text).not.toContain(info.pass);
  }
}

const runs = { numRuns: 100 };

describe('openTarget errors never contain the original userinfo', () => {
  // Feature: runtime-target, Property 7: redactUrl removes userinfo and is a no-op without it (errors)
  // **Validates: Requirements 4.7, 8.7**
  it('Attach_Mode timeout: url field and message are redacted', async () => {
    await fc.assert(
      fc.asyncProperty(userinfo, loopback, port, async (info, host, p) => {
        const f = fakes();
        const error = await thrown({
          ...f.base,
          url: `http://${info.info}@${host}:${p}/`,
          ready: { timeout: '1s' },
        });
        expect(error).toBeInstanceOf(TargetUnreachableError);
        expect(typeof (error as TargetUnreachableError).url).toBe('string');
        expectNoLeak(error, info);
        expect(f.spawnCalls()).toBe(0);
      }),
      runs,
    );
  });

  // Feature: runtime-target, Property 7: redactUrl removes userinfo and is a no-op without it (errors)
  // **Validates: Requirements 4.7, 8.7**
  it('Start_Mode timeout: url field and message are redacted', async () => {
    await fc.assert(
      fc.asyncProperty(userinfo, loopback, port, async (info, host, p) => {
        const f = fakes();
        const error = await thrown({
          ...f.base,
          url: `http://${info.info}@${host}:${p}/`,
          start: 'node server.js',
          ready: { timeout: '1s' },
        });
        expect(error).toBeInstanceOf(TargetUnreachableError);
        expectNoLeak(error, info);
        expect(f.spawnCalls()).toBe(1);
      }),
      runs,
    );
  });

  // Feature: runtime-target, Property 7: redactUrl removes userinfo and is a no-op without it (errors)
  // **Validates: Requirements 4.7, 8.7**
  it('config errors: non-loopback url with start', async () => {
    await fc.assert(
      fc.asyncProperty(userinfo, remote, port, async (info, host, p) => {
        const f = fakes();
        const error = await thrown({
          ...f.base,
          url: `https://${info.info}@${host}:${p}/`,
          start: 'node server.js',
        });
        expect(error).toBeInstanceOf(Error);
        expectNoLeak(error, info);
        expect(f.spawnCalls()).toBe(0);
      }),
      runs,
    );
  });

  // Feature: runtime-target, Property 7: redactUrl removes userinfo and is a no-op without it (errors)
  // **Validates: Requirements 4.7, 8.7**
  it('config errors: invalid ready.timeout', async () => {
    await fc.assert(
      fc.asyncProperty(
        userinfo,
        loopback,
        port,
        fc.constantFrom(false, true),
        fc.constantFrom('bogus', '', '-5s', '10 parsecs'),
        async (info, host, p, withStart, timeout) => {
          const f = fakes();
          const error = await thrown({
            ...f.base,
            url: `http://${info.info}@${host}:${p}/`,
            ...(withStart ? { start: 'node server.js' } : {}),
            ready: { timeout },
          });
          expect(error).toBeInstanceOf(Error);
          expectNoLeak(error, info);
        },
      ),
      runs,
    );
  });

  // Feature: runtime-target, Property 7: redactUrl removes userinfo and is a no-op without it (errors)
  // **Validates: Requirements 4.7, 8.7**
  it('config errors: unsupported protocol and unparsable url', async () => {
    await fc.assert(
      fc.asyncProperty(
        userinfo,
        fc.constantFrom('ftp://', 'file://', 'ws://', 'http://', 'https://'),
        fc.constantFrom('', ':notaport', '/'),
        async (info, scheme, tail) => {
          const f = fakes();
          // Without a host the URL is unparsable (http/https); other schemes are unsupported.
          const error = await thrown({
            ...f.base,
            url: `${scheme}${info.info}@${tail === '/' ? 'localhost/' : tail}`,
          });
          if (error === undefined) return; // parsed and probed fine: nothing thrown, nothing to leak
          expectNoLeak(error, info);
        },
      ),
      runs,
    );
  });

  // Feature: runtime-target, Property 7: redactUrl removes userinfo and is a no-op without it (errors)
  // **Validates: Requirements 4.7, 8.7**
  it('config errors: url already served before start', async () => {
    await fc.assert(
      fc.asyncProperty(userinfo, loopback, port, fc.integer({ min: 200, max: 399 }), async (info, host, p, status) => {
        const f = fakes({ response: status });
        const error = await thrown({
          ...f.base,
          url: `http://${info.info}@${host}:${p}/`,
          start: 'node server.js',
        });
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('already served');
        expectNoLeak(error, info);
        expect(f.spawnCalls()).toBe(0);
      }),
      runs,
    );
  });

  // Feature: runtime-target, Property 7: redactUrl removes userinfo and is a no-op without it (errors)
  // **Validates: Requirements 4.7, 8.7**
  it('Start_Mode spawn failure: TargetStartError carries no userinfo', async () => {
    await fc.assert(
      fc.asyncProperty(userinfo, loopback, port, async (info, host, p) => {
        const f = fakes();
        const spawn = (() =>
          Object.assign(new EventEmitter(), { pid: undefined, stdout: null, stderr: null })) as never;
        const error = await thrown({
          ...f.base,
          spawn,
          url: `http://${info.info}@${host}:${p}/`,
          start: 'node server.js',
        });
        expect(error).toBeInstanceOf(TargetStartError);
        expectNoLeak(error, info);
      }),
      runs,
    );
  });
});
