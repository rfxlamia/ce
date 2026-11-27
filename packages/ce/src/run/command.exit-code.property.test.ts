import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { runRunCommand } from './command.js';
import { run } from './pipeline.js';
import type { RunResult } from './types.js';

vi.mock('./pipeline.js', () => ({ run: vi.fn() }));

const OUTCOMES = ['SKIPPED', 'EVIDENCED', 'UNSUPPORTED', 'ERROR'] as const;

const resultArb = fc.record({
  outcome: fc.constantFrom(...OUTCOMES),
  exitCode: fc.constantFrom(0, 1, 2, 3),
  reason: fc.option(fc.string(), { nil: undefined }),
  surface: fc.option(fc.constantFrom('browser_ui', 'backend', 'other'), { nil: undefined }),
  claimTexts: fc.array(fc.string(), { maxLength: 4 }),
});

describe('runRunCommand exit code', () => {
  it('Feature: evidence-bundle, Property 29: Printing the summary never changes the exit code', async () => {
    // **Validates: Requirements 8.17**
    await fc.assert(
      fc.asyncProperty(resultArb, async (fields) => {
        const result = {
          kind: 'resolved',
          bundleWritten: false,
          runDir: '/nonexistent-run-dir',
          ...fields,
        } as unknown as RunResult;
        vi.mocked(run).mockResolvedValueOnce(result);
        const out: string[] = [];
        const code = await runRunCommand([], {
          env: {},
          cwd: '/nonexistent-cwd',
          stdout: { write: (t: string) => out.push(t) },
          stderr: { write: () => true },
          createGateway: () => {
            throw new Error('createGateway must not be called');
          },
          now: () => new Date(0),
        });
        expect(code).toBe(fields.exitCode);
        expect(out.join('')).toContain(`Outcome: ${fields.outcome}`);
      }),
      { numRuns: 100 },
    );
  });
});
