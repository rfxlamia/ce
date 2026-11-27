import { EventEmitter } from 'node:events';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TargetConfigError, TargetStartError, openTarget } from './target.js';

const octet = fc.integer({ min: 0, max: 255 });
const port = fc.integer({ min: 1, max: 65535 });
const label = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);

const loopbackHost = fc.oneof(
  fc.constant('localhost'),
  fc.constant('[::1]'),
  fc.constant('0.0.0.0'),
  fc.tuple(octet, octet, octet).map(([a, b, c]) => `127.${a}.${b}.${c}`),
);

const remoteHost = fc.oneof(
  fc.tuple(label, label).map(([a, b]) => `${a}.${b}.example`),
  fc.constant('localhost.example.com'),
  fc.constant('127.0.0.1.example.com'),
  fc.constant('[::2]'),
  fc.constant('[2001:db8::1]'),
  fc.constant('0.0.0.1'),
  fc
    .tuple(fc.integer({ min: 1, max: 255 }).filter((n) => n !== 127), octet, octet, octet)
    .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
);

const urlArb = (host: fc.Arbitrary<string>): fc.Arbitrary<string> =>
  fc
    .tuple(fc.constantFrom('http', 'https'), host, fc.option(port, { nil: undefined }))
    .map(([scheme, h, p]) => `${scheme}://${h}${p === undefined ? '' : `:${p}`}/`);

function setup() {
  let spawnCalls = 0;
  const spawn = (() => {
    spawnCalls++;
    // A child that failed to spawn: no pid, no streams.
    return Object.assign(new EventEmitter(), { pid: undefined, stdout: null, stderr: null });
  }) as never;
  const fetchFn = (async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  }) as unknown as typeof fetch;
  return {
    spawnCalls: () => spawnCalls,
    options: {
      start: 'node server.js',
      cwd: '/tmp',
      env: {},
      fetch: fetchFn,
      spawn,
      now: () => 0,
      sleep: async () => {},
      process: new EventEmitter() as unknown as NodeJS.Process,
    },
  };
}

describe('openTarget loopback classification', () => {
  // Feature: runtime-target, Property 11: Loopback classification decides the start-with-remote-url rejection
  // **Validates: Requirements 8.4**
  it('rejects a non-loopback url with start, without spawning', async () => {
    await fc.assert(
      fc.asyncProperty(urlArb(remoteHost), async (url) => {
        const s = setup();
        const error = await openTarget({ ...s.options, url }).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(TargetConfigError);
        expect((error as TargetConfigError).message).toContain('loopback');
        expect(s.spawnCalls()).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: runtime-target, Property 11: Loopback classification decides the start-with-remote-url rejection
  // **Validates: Requirements 8.4**
  it('proceeds to Start_Mode for a loopback url with start', async () => {
    await fc.assert(
      fc.asyncProperty(urlArb(loopbackHost), async (url) => {
        const s = setup();
        const error = await openTarget({ ...s.options, url }).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(s.spawnCalls()).toBe(1);
        expect(error).toBeInstanceOf(TargetStartError);
        expect(error).not.toBeInstanceOf(TargetConfigError);
      }),
      { numRuns: 100 },
    );
  });
});
