import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { TargetStartError, openTarget } from './target.js';

// Feature: runtime-target, Property 10: Only the configured secret names are removed from the started process's environment
// **Validates: Requirements 2.7**

const CE_NAMES = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'];
const POOL = ['PATH', 'HOME', 'NODE_ENV', 'EXTRA_A', 'EXTRA_B', 'MY_TOKEN', ...CE_NAMES];

const keyArb = fc.oneof(
  fc.constantFrom(...POOL),
  fc.stringMatching(/^[A-Z_][A-Z0-9_]{0,8}$/),
);
const envArb = fc.dictionary(keyArb, fc.option(fc.string({ maxLength: 12 }), { nil: undefined }));
const secretsArb = fc.option(fc.array(keyArb, { maxLength: 4 }), { nil: undefined });

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
}

describe('Property 10: env passed to spawn', () => {
  it('removes exactly the secret names and keeps every other pair', async () => {
    await fc.assert(
      fc.asyncProperty(envArb, secretsArb, async (env, secrets) => {
        let passed: Record<string, string | undefined> | undefined;
        const spawn = ((_cmd: string, opts: { env?: Record<string, string | undefined> }) => {
          passed = opts.env;
          const child = new FakeChild();
          setImmediate(() => child.emit('exit', 1, null));
          return child;
        }) as never;
        const fakeProcess = { kill: () => true, on: () => {}, removeListener: () => {}, pid: 1 } as never;

        try {
          await openTarget({
            url: 'http://127.0.0.1:9',
            start: 'serve',
            cwd: '/tmp',
            env,
            ...(secrets !== undefined ? { secrets } : {}),
            fetch: (() => Promise.reject(new Error('refused'))) as never,
            spawn,
            now: () => 0,
            sleep: () => new Promise<void>(() => {}),
            process: fakeProcess,
          });
          throw new Error('openTarget should not resolve');
        } catch (error) {
          expect(error).toBeInstanceOf(TargetStartError);
        }

        const removed = new Set([...(secrets ?? []), ...CE_NAMES]);
        const expected = Object.fromEntries(Object.entries(env).filter(([k]) => !removed.has(k)));
        expect(passed).toBeDefined();
        expect(Object.fromEntries(Object.entries(passed!))).toEqual(expected);
        expect(Object.keys(passed!).length).toBe(Object.keys(expected).length);
      }),
      { numRuns: 100 },
    );
  });
});
