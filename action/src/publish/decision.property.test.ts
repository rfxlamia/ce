// Feature: inline-screenshot-in-pr, Property 6: The pre-Publisher decision table is total and respects its fixed priority order
// **Validates: Requirements 2.3, 2.8, 2.9, 2.10, 10.1**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  decidePrePublisher,
  type PrePublisherContext,
  type PrePublisherDecision,
} from './decision.js';

const NUM_RUNS = 100;

const outcomeArb = fc.constantFrom<PrePublisherContext['outcome']>(
  'SKIPPED',
  'EVIDENCED',
  'UNSUPPORTED',
  'ERROR',
  undefined,
);

const ctxArb: fc.Arbitrary<PrePublisherContext> = fc.record({
  publishMode: fc.constant<'branch'>('branch'),
  commentEnabled: fc.boolean(),
  outcome: outcomeArb,
  isPullRequestEvent: fc.boolean(),
  isForkPr: fc.boolean(),
  isEvidenceBranchRef: fc.boolean(),
});

const base: PrePublisherContext = {
  publishMode: 'branch',
  commentEnabled: true,
  outcome: 'EVIDENCED',
  isPullRequestEvent: true,
  isForkPr: false,
  isEvidenceBranchRef: false,
};

/** Independent reference: the first applicable check of Requirement 2.10 wins. */
function expected(ctx: PrePublisherContext): PrePublisherDecision {
  const checks: Array<[boolean, PrePublisherDecision]> = [
    [!ctx.commentEnabled, { kind: 'not-attempted' }],
    [ctx.outcome === 'SKIPPED' || ctx.outcome === 'UNSUPPORTED', { kind: 'not-attempted' }],
    [!ctx.isPullRequestEvent, { kind: 'fallback', reason: 'no-pr-number' }],
    [ctx.isForkPr, { kind: 'fallback', reason: 'fork-pr' }],
    [ctx.isEvidenceBranchRef, { kind: 'fallback', reason: 'ref-guard' }],
  ];
  for (const [applies, decision] of checks) if (applies) return decision;
  return { kind: 'proceed' };
}

describe('Property 6: decidePrePublisher', () => {
  it('is total and returns the first applicable check in the fixed order', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        expect(decidePrePublisher(ctx)).toEqual(expected(ctx));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('proceeds only when no check applies', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const anyApplies =
          !ctx.commentEnabled ||
          ctx.outcome === 'SKIPPED' ||
          ctx.outcome === 'UNSUPPORTED' ||
          !ctx.isPullRequestEvent ||
          ctx.isForkPr ||
          ctx.isEvidenceBranchRef;
        expect(decidePrePublisher(ctx).kind === 'proceed').toBe(!anyApplies);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('comment disabled wins over every later check', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        expect(decidePrePublisher({ ...ctx, commentEnabled: false })).toEqual({
          kind: 'not-attempted',
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a SKIPPED or UNSUPPORTED outcome wins over the PR, fork and ref checks', () => {
    fc.assert(
      fc.property(
        ctxArb,
        fc.constantFrom<'SKIPPED' | 'UNSUPPORTED'>('SKIPPED', 'UNSUPPORTED'),
        (ctx, outcome) => {
          expect(decidePrePublisher({ ...ctx, commentEnabled: true, outcome })).toEqual({
            kind: 'not-attempted',
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('an unavailable Run_Record continues to the later checks', () => {
    expect(decidePrePublisher({ ...base, outcome: undefined })).toEqual({ kind: 'proceed' });
    expect(decidePrePublisher({ ...base, outcome: undefined, isForkPr: true })).toEqual({
      kind: 'fallback',
      reason: 'fork-pr',
    });
  });

  describe('one example per check', () => {
    it('comment disabled gives not-attempted', () => {
      expect(decidePrePublisher({ ...base, commentEnabled: false })).toEqual({ kind: 'not-attempted' });
    });
    it('SKIPPED gives not-attempted', () => {
      expect(decidePrePublisher({ ...base, outcome: 'SKIPPED' })).toEqual({ kind: 'not-attempted' });
    });
    it('UNSUPPORTED gives not-attempted', () => {
      expect(decidePrePublisher({ ...base, outcome: 'UNSUPPORTED' })).toEqual({ kind: 'not-attempted' });
    });
    it('non-PR event gives no-pr-number', () => {
      expect(decidePrePublisher({ ...base, isPullRequestEvent: false })).toEqual({
        kind: 'fallback',
        reason: 'no-pr-number',
      });
    });
    it('fork PR gives fork-pr', () => {
      expect(decidePrePublisher({ ...base, isForkPr: true })).toEqual({ kind: 'fallback', reason: 'fork-pr' });
    });
    it('evidence-branch ref gives ref-guard', () => {
      expect(decidePrePublisher({ ...base, isEvidenceBranchRef: true })).toEqual({
        kind: 'fallback',
        reason: 'ref-guard',
      });
    });
    it('EVIDENCED and ERROR proceed when nothing else applies', () => {
      expect(decidePrePublisher({ ...base, outcome: 'EVIDENCED' })).toEqual({ kind: 'proceed' });
      expect(decidePrePublisher({ ...base, outcome: 'ERROR' })).toEqual({ kind: 'proceed' });
    });
  });

  describe('earlier check wins when two apply', () => {
    it('comment disabled beats SKIPPED outcome and fork PR', () => {
      expect(
        decidePrePublisher({ ...base, commentEnabled: false, outcome: 'SKIPPED', isForkPr: true }),
      ).toEqual({ kind: 'not-attempted' });
    });
    it('non-PR event beats fork PR and ref guard', () => {
      expect(
        decidePrePublisher({ ...base, isPullRequestEvent: false, isForkPr: true, isEvidenceBranchRef: true }),
      ).toEqual({ kind: 'fallback', reason: 'no-pr-number' });
    });
    it('fork PR beats ref guard', () => {
      expect(decidePrePublisher({ ...base, isForkPr: true, isEvidenceBranchRef: true })).toEqual({
        kind: 'fallback',
        reason: 'fork-pr',
      });
    });
    it('UNSUPPORTED beats non-PR event', () => {
      expect(decidePrePublisher({ ...base, outcome: 'UNSUPPORTED', isPullRequestEvent: false })).toEqual({
        kind: 'not-attempted',
      });
    });
  });
});
