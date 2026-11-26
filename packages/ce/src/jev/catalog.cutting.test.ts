import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STATE_BUDGET_TOKENS, estimateTokens, isTestFile } from '../context/budget.js';
import type { ChangeContext, ChangedFile } from '../context/types.js';
import { buildAssessmentRequest } from './catalog.js';

const provenance = { provider: 'git' } as const;

function file(path: string, patch: string): ChangedFile {
  return { path, status: 'modified', patch, provenance };
}

function context(files: ChangedFile[]): ChangeContext {
  return {
    change: { files, commits: [], claims: [], provenance: [] },
    candidates: [],
    checks: [],
    truncated: [],
    providers: [],
    redactions: [],
  };
}

const subject = { id: 'c1', text: 'the button works' };
const stateOf = (r: { request: { state: unknown } }): string => r.request.state as string;
const entry = (path: string, patch: string): string => `${path}\n${patch}`;

describe('buildAssessmentRequest patch cutting', () => {
  it('cuts only the non-test patch when that suffices', () => {
    const testPatch = 'T'.repeat(500);
    const result = buildAssessmentRequest(
      context([file('src/a.ts', 'a'.repeat(100_000)), file('src/a.test.ts', testPatch)]),
      subject,
    );
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0]).toMatchObject({ file: 'src/a.ts', isTest: false });
    expect(stateOf(result)).toContain(entry('src/a.test.ts', testPatch));
    expect(estimateTokens(stateOf(result))).toBeLessThanOrEqual(STATE_BUDGET_TOKENS);
  });

  it('cuts the last non-test file first', () => {
    const first = 'a'.repeat(60_000);
    const result = buildAssessmentRequest(
      context([file('src/a.ts', first), file('src/b.ts', 'b'.repeat(60_000))]),
      subject,
    );
    expect(result.cuts.map((c) => c.file)).toEqual(['src/b.ts']);
    expect(stateOf(result)).toContain(entry('src/a.ts', first));
  });

  it('cuts a test patch only after every other patch is empty, and records isTest', () => {
    const result = buildAssessmentRequest(
      context([file('src/a.ts', 'a'.repeat(1_000)), file('src/a.test.ts', 'T'.repeat(100_000))]),
      subject,
    );
    expect(result.cuts).toEqual([
      { file: 'src/a.ts', reason: 'dropped', isTest: false },
      { file: 'src/a.test.ts', reason: 'truncated', isTest: true },
    ]);
    expect(stateOf(result)).toContain(entry('src/a.ts', ''));
    expect(estimateTokens(stateOf(result))).toBeLessThanOrEqual(STATE_BUDGET_TOKENS);
  });

  it('throws when the state is still over budget with all patches empty', () => {
    expect(() =>
      buildAssessmentRequest(context([file('src/a.ts', 'a'), file('src/a.test.ts', 'b')]), {
        id: 'c1',
        text: 'x'.repeat(100_000),
      }),
    ).toThrow(/all patches empty/);
  });

  // Feature: claims-assessment-eval, Property 8: Test_File patch-cutting protection
  // **Validates: Requirements 4.5, 4.6, 4.7, 4.8**
  it('Feature: claims-assessment-eval, Property 8: Test_File patch-cutting protection', () => {
    const entryArb = fc.oneof(
      fc.record({ test: fc.constant(false), len: fc.integer({ min: 50_000, max: 70_000 }) }),
      fc.record({ test: fc.constant(true), len: fc.integer({ min: 0, max: 500 }) }),
    );
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 2, maxLength: 6 }),
        fc.array(fc.integer({ min: 50_000, max: 70_000 }), { minLength: 2, maxLength: 3 }),
        (entries, bigLens) => {
          const specs = [
            ...entries,
            ...bigLens.map((len) => ({ test: false, len })),
          ];
          const files = specs.map((s, i) =>
            file(
              s.test ? `src/f${i}.test.ts` : `src/f${i}.ts`,
              `${i}:` + (s.test ? 'T' : 'n').repeat(s.len),
            ),
          );
          const testFiles = files.filter((f) => isTestFile(f.path));
          const result = buildAssessmentRequest(context(files), subject);
          const state = stateOf(result);

          for (const f of testFiles) expect(state).toContain(entry(f.path, f.patch));
          expect(estimateTokens(state)).toBeLessThanOrEqual(STATE_BUDGET_TOKENS);

          const cutFiles = result.cuts.map((c) => c.file);
          expect(new Set(cutFiles).size).toBe(cutFiles.length);
          expect(cutFiles.length).toBeGreaterThan(0);
          for (const c of result.cuts) expect(c.isTest).toBe(isTestFile(c.file));
          for (const c of result.cuts) expect(c.isTest).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
