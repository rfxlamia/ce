import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Assessment, Claim, PerClaimAssessment, Surface } from '../assessment/index.js';
import { selectClaim } from './capability.js';

// Feature: observe-decide-execute-loop, Property 23: Claim selection follows a total, deterministic precedence order
// **Validates: Requirements 13.6**

const surfaces: Surface[] = ['browser_ui', 'http_api', 'cli', 'backend_internal', 'native_app', 'non_runtime'];

interface Row {
  surface: Surface;
  needed: boolean;
  observable: number;
}

// Few distinct observable values so ties occur often.
const rowArb: fc.Arbitrary<Row> = fc.record({
  surface: fc.constantFrom(...surfaces),
  needed: fc.boolean(),
  observable: fc.constantFrom(0, 0.25, 0.5, 0.75, 1),
});

function build(rows: Row[], changeText: string): { claims: Claim[]; assessment: Assessment } {
  const claims = rows.map((_, i) => ({
    id: `c${i}`,
    text: `claim ${i}`,
    probability: 0.9,
    declared: false,
    provenance: { source: 'description' },
  })) as unknown as Claim[];
  const perClaim: PerClaimAssessment[] = rows.map((r, i) => ({
    claimId: `c${i}`,
    runtimeObservable: r.observable,
    checksAdequate: 0,
    surface: r.surface,
    surfaceConfidence: 1,
    needed: r.needed,
    uncertain: false,
  }));
  const assessment = {
    claimStatus: rows.length > 0 ? 'identified' : 'not_identified',
    subjects: [{ id: 'change', kind: 'change', text: changeText, provenance: { source: 'title' } }],
    perClaim,
    required: true,
    decidedBy: 'classifier',
    surface: 'browser_ui',
    record: {},
  } as unknown as Assessment;
  return { claims, assessment };
}

/** Reference model: first index of the maximum observable within the chosen pool. */
function expectedIndex(rows: Row[]): number {
  const all = rows.map((_, i) => i);
  const browser = all.filter((i) => rows[i]!.surface === 'browser_ui');
  const needed = browser.filter((i) => rows[i]!.needed);
  const pool = needed.length > 0 ? needed : browser.length > 0 ? browser : all;
  let best = pool[0]!;
  for (const i of pool) if (rows[i]!.observable > rows[best]!.observable) best = i;
  return best;
}

describe('Property 23: claim selection precedence', () => {
  it('returns the claim chosen by the precedence order, deterministically', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 12 }), (rows) => {
        const { claims, assessment } = build(rows, 'change text');
        const first = selectClaim(claims, assessment);
        const second = selectClaim(claims, assessment);
        expect(second).toEqual(first);
        expect(first.status).toBe('identified');
        if (first.status !== 'identified') return;
        const idx = expectedIndex(rows);
        expect(first.claim.id).toBe(`c${idx}`);
        expect(first.text).toBe(`claim ${idx}`);
      }),
      { numRuns: 200 },
    );
  });

  it('is invariant to reordering perClaim entries', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 12 }), (rows) => {
        const { claims, assessment } = build(rows, 't');
        const reversed = { ...assessment, perClaim: [...assessment.perClaim].reverse() };
        expect(selectClaim(claims, reversed)).toEqual(selectClaim(claims, assessment));
      }),
      { numRuns: 100 },
    );
  });

  it('with no claims returns the change subject text marked not_identified', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const { claims, assessment } = build([], text);
        expect(selectClaim(claims, assessment)).toEqual({ status: 'not_identified', text });
      }),
      { numRuns: 50 },
    );
  });
});
