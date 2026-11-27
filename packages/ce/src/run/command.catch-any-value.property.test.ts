// Feature: evidence-bundle, Property 24: The command's last-resort catch is independent of the thrown value's shape
// **Validates: Requirements 11.4, 11.6**

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runRunCommand } from './command.js';
import type { RunCommandDeps } from './command.js';
import { run } from './pipeline.js';
import type { CreateGateway } from './types.js';

vi.mock('./pipeline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipeline.js')>();
  return { ...actual, run: vi.fn(actual.run) };
});

class CustomError extends Error {}

/** Each arbitrary yields the thrown value and the name the command must report on stderr. */
const thrownArb: fc.Arbitrary<{ value: unknown; name: string }> = fc.oneof(
  fc.string().map((m) => ({ value: new Error(m), name: 'Error' })),
  fc.string().map((m) => ({ value: new RangeError(m), name: 'RangeError' })),
  fc.string().map((m) => ({ value: new CustomError(m), name: 'CustomError' })),
  fc.dictionary(fc.string(), fc.jsonValue()).map((o) => ({ value: o, name: 'Object' })),
  fc.string().map((s) => ({ value: s, name: 'string' })),
  fc.oneof(fc.double(), fc.integer()).map((n) => ({ value: n, name: 'number' })),
  fc.boolean().map((b) => ({ value: b, name: 'boolean' })),
  fc.constant({ value: null, name: 'object' }),
  fc.constant({ value: undefined, name: 'undefined' }),
);

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-catch-any-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('Property 24: last-resort catch is independent of the thrown value shape', () => {
  it('prints Outcome: ERROR first, names the value on stderr, exits 1 and writes no bundle', async () => {
    await fc.assert(
      fc.asyncProperty(thrownArb, async ({ value, name }) => {
        vi.mocked(run).mockRejectedValueOnce(value);
        const out: string[] = [];
        const err: string[] = [];
        const deps: RunCommandDeps = {
          env: { OPENROUTER_API_KEY: 'sk-or-fake-key-0123456789abcdef' },
          cwd,
          stdout: { write: (t: string) => out.push(t) },
          stderr: { write: (t: string) => err.push(t) },
          createGateway: vi.fn<CreateGateway>(() => {
            throw new Error('createGateway must not be called');
          }),
          now: () => new Date('2026-01-02T03:04:05.678Z'),
        };

        const code = await runRunCommand([], deps);

        expect(code).toBe(1);
        expect(out.join('').startsWith('Outcome: ERROR')).toBe(true);
        expect(out.join('').split('\n')[0]).toBe('Outcome: ERROR');
        expect(err.join('')).toBe(`${name}\n`);
        expect(readdirSync(cwd)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
