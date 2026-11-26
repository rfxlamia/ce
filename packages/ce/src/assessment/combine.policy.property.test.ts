import { describe, it } from 'vitest';
import fc from 'fast-check';
import { combine, type SubjectProbabilities } from './combine.js';
import type { AssessmentSettings, Surface } from './types.js';

const surfaces: Surface[] = ['browser_ui', 'http_api', 'cli', 'backend_internal', 'native_app', 'non_runtime'];

const prob = fc.double({ min: 0, max: 1, noNaN: true });

const subjectArb: fc.Arbitrary<SubjectProbabilities> = fc.record({
  claimId: fc.string({ minLength: 1, maxLength: 8 }),
  runtimeObservable: prob,
  checksAdequate: prob,
  surface: fc.constantFrom(...surfaces),
  surfaceConfidence: prob,
});

const settingsArb = fc.record({
  claimThreshold: prob,
  observableThreshold: prob,
  adequateThreshold: prob,
  uncertaintyBand: fc.double({ min: 0, max: 0.5, noNaN: true }),
});

describe('combine policy irrelevance', () => {
  // Feature: claims-assessment-eval, Property 13: Policy-irrelevance under classifier decision
  // **Validates: Requirements 7.5**
  it('Feature: claims-assessment-eval, Property 13: Policy-irrelevance under classifier decision', () => {
    fc.assert(
      fc.property(fc.array(subjectArb, { maxLength: 8 }), settingsArb, (subjects, s) => {
        const ev = combine(subjects, { ...s, onUncertain: 'evidence' } as AssessmentSettings);
        const sk = combine(subjects, { ...s, onUncertain: 'skip' } as AssessmentSettings);
        if (ev.decidedBy !== 'classifier' || sk.decidedBy !== 'classifier') {
          // decidedBy does not depend on the policy, so both must agree.
          return ev.decidedBy === sk.decidedBy;
        }
        return (
          ev.required === sk.required &&
          JSON.stringify(ev) === JSON.stringify(sk)
        );
      }),
      { numRuns: 200 },
    );
  });
});
