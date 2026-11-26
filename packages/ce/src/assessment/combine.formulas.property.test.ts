import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { combine, type SubjectProbabilities } from './combine.js';
import type { AssessmentSettings, Surface } from './types.js';

// Mix continuous values with a coarse grid so exact equality with a threshold occurs often.
const grid = fc.constantFrom(0, 0.1, 0.2, 0.3, 0.5, 0.6, 0.7, 0.9, 1);
const p = fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), grid);
const surfaces: Surface[] = ['browser_ui', 'http_api', 'cli', 'backend_internal', 'native_app', 'non_runtime'];

const subjects = fc.array(
  fc.record({
    claimId: fc.string(),
    runtimeObservable: p,
    checksAdequate: p,
    surface: fc.constantFrom<Surface>(...surfaces),
    surfaceConfidence: p,
  }),
  { maxLength: 8 },
);

const settingsWith = (band: fc.Arbitrary<number>) =>
  fc.record({
    claimThreshold: p,
    observableThreshold: p,
    adequateThreshold: p,
    uncertaintyBand: band,
    onUncertain: fc.constantFrom<'evidence' | 'skip'>('evidence', 'skip'),
  });

const anyBand = fc.oneof(fc.constant(0), grid, fc.double({ min: 0, max: 1, noNaN: true }));

function check(subs: SubjectProbabilities[], st: AssessmentSettings): void {
  const r = combine(subs, st);
  const band = st.uncertaintyBand;
  expect(r.perClaim).toHaveLength(subs.length);
  subs.forEach((s, i) => {
    const c = r.perClaim[i]!;
    expect(c.needed).toBe(s.runtimeObservable >= st.observableThreshold && s.checksAdequate < st.adequateThreshold);
    expect(c.uncertain).toBe(
      Math.abs(s.runtimeObservable - st.observableThreshold) <= band ||
        Math.abs(s.checksAdequate - st.adequateThreshold) <= band,
    );
  });
  const anyNeeded = r.perClaim.some((c) => c.needed);
  const anyUncertain = r.perClaim.some((c) => c.uncertain);
  expect(r.required).toBe(anyNeeded || (anyUncertain && st.onUncertain === 'evidence'));
}

describe('Combiner decision formulas', () => {
  it('Feature: claims-assessment-eval, Property 10: Combiner decision formulas', () => {
    // **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.10, 6.11**
    fc.assert(
      fc.property(subjects, settingsWith(anyBand), (subs, st) => check(subs, st)),
      { numRuns: 200 },
    );
  });

  it('Feature: claims-assessment-eval, Property 10: Combiner decision formulas (band = 0)', () => {
    // **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.10, 6.11**
    fc.assert(
      fc.property(subjects, settingsWith(fc.constant(0)), (subs, st) => {
        check(subs, st);
        // band = 0: uncertain only on exact equality.
        combine(subs, st).perClaim.forEach((c) => {
          expect(c.uncertain).toBe(
            c.runtimeObservable === st.observableThreshold || c.checksAdequate === st.adequateThreshold,
          );
        });
      }),
      { numRuns: 200 },
    );
  });
});
