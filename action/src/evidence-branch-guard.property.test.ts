// Feature: inline-screenshot-in-pr, Property 7: The evidence-branch guard matches the branch name exactly, never a substring
// **Validates: Requirements 12.1, 12.4, 12.7**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isEvidenceBranchRef, isEvidenceBranchRun } from './evidence-branch-guard.js';

const NUM_RUNS = 100;

const EXACT = ['ce-evidence', 'refs/heads/ce-evidence'];

// Values that embed the branch name without equalling it, plus arbitrary strings and undefined.
const nearMiss = fc
  .tuple(fc.string({ maxLength: 8 }), fc.constantFrom(...EXACT), fc.string({ maxLength: 8 }))
  .map(([pre, mid, post]) => `${pre}${mid}${post}`);

const valueArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom(...EXACT),
  fc.string({ maxLength: 24 }),
  nearMiss,
);

const isExact = (v: string | undefined): boolean => v !== undefined && EXACT.includes(v);

describe('Property 7: isEvidenceBranchRun exact matching', () => {
  it('is true iff at least one variable is exactly the branch name or its full ref', () => {
    fc.assert(
      fc.property(valueArb, valueArb, valueArb, (ref, head, base) => {
        const env = { GITHUB_REF: ref, GITHUB_HEAD_REF: head, GITHUB_BASE_REF: base };
        const expected = isExact(ref) || isExact(head) || isExact(base);
        expect(isEvidenceBranchRun(env)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('isEvidenceBranchRef agrees with exact equality', () => {
    fc.assert(
      fc.property(valueArb, (v) => {
        expect(isEvidenceBranchRef(v)).toBe(isExact(v));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not match substring look-alikes', () => {
    for (const v of [
      'feature/ce-evidence-docs',
      'refs/heads/ce-evidence-old',
      'refs/pull/1/merge',
      'xce-evidence',
      'ce-evidence/',
      'CE-EVIDENCE',
      '',
    ]) {
      expect(isEvidenceBranchRef(v)).toBe(false);
      expect(isEvidenceBranchRun({ GITHUB_REF: v })).toBe(false);
    }
  });

  it('matches the exact name on any of the three variables', () => {
    for (const key of ['GITHUB_REF', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF']) {
      expect(isEvidenceBranchRun({ [key]: 'ce-evidence' })).toBe(true);
      expect(isEvidenceBranchRun({ [key]: 'refs/heads/ce-evidence' })).toBe(true);
    }
    expect(isEvidenceBranchRun({})).toBe(false);
  });
});
