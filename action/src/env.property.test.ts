// Feature: github-action-pr-comment, Property 7: Child-environment sanitizing removes every forbidden variable and preserves every other one, under any name collision
// **Validates: Requirements 5.10, 5.11**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sanitizeChildEnv } from './env.js';

const NUM_RUNS = 100;

const suffix = fc.string({ minLength: 0, maxLength: 8 });
const nameArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }),
  suffix.map((s) => `INPUT_${s}`),
  suffix.map((s) => `ACTIONS_${s}`),
  suffix.map((s) => `GITHUB_${s}`),
  suffix.map((s) => `CE_${s}`),
  fc.constantFrom('GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_EVENT_PATH', 'PATH'),
);
const valueArb = fc.string({ maxLength: 12 });
const runTokenArb = fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 12 }));

const FORBIDDEN_NAMES = ['GITHUB_TOKEN', 'GH_TOKEN'];
const isForbiddenName = (name: string): boolean =>
  name.startsWith('INPUT_') || name.startsWith('ACTIONS_') || FORBIDDEN_NAMES.includes(name);

describe('Property 7: child-environment sanitizing', () => {
  it('removes every forbidden variable and preserves every other one', () => {
    fc.assert(
      fc.property(
        fc.dictionary(nameArb, valueArb),
        runTokenArb,
        fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }).map((s) => `MIRROR_${s}`), valueArb),
        fc.array(nameArb, { maxLength: 4 }),
        (base, runToken, mirrorEnv, collisionNames) => {
          // Repeat the Run_Token under unrelated names to force value collisions.
          const env: Record<string, string> = Object.fromEntries(Object.entries(base));
          if (runToken.length > 0) {
            for (const name of collisionNames) {
              Object.defineProperty(env, name, { value: runToken, enumerable: true, configurable: true, writable: true });
            }
          }
          const snapshot = Object.fromEntries(Object.entries(env));

          const out = sanitizeChildEnv(env, runToken, mirrorEnv);

          expect(env).toEqual(snapshot);
          for (const [name, value] of Object.entries(out)) {
            if (Object.hasOwn(mirrorEnv, name)) continue;
            expect(isForbiddenName(name)).toBe(false);
            if (runToken.length > 0) expect(value).not.toBe(runToken);
          }
          for (const [name, value] of Object.entries(env)) {
            if (Object.hasOwn(mirrorEnv, name)) continue;
            const forbidden = isForbiddenName(name) || (runToken.length > 0 && value === runToken);
            if (forbidden) expect(Object.hasOwn(out, name)).toBe(false);
            else expect(Object.getOwnPropertyDescriptor(out, name)?.value).toBe(value);
          }
          for (const [name, value] of Object.entries(mirrorEnv)) {
            expect(Object.getOwnPropertyDescriptor(out, name)?.value).toBe(value);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
