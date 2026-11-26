import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { combine, type SubjectProbabilities } from './combine.js';
import type { AssessmentSettings } from './types.js';

// Feature: claims-assessment-eval, Property 11: Combiner totality and output cardinality
// **Validates: Requirements 5.6, 6.9**

const prob = fc.double({ min: 0, max: 1, noNaN: true });

const subjectArb: fc.Arbitrary<SubjectProbabilities> = fc.record({
  claimId: fc.string({ maxLength: 12 }),
  runtimeObservable: prob,
  checksAdequate: prob,
  surface: fc.constantFrom(...SURFACE_LABELS),
  surfaceConfidence: prob,
});

const settingsArb: fc.Arbitrary<AssessmentSettings> = fc.record({
  claimThreshold: prob,
  observableThreshold: prob,
  adequateThreshold: prob,
  uncertaintyBand: prob,
  onUncertain: fc.constantFrom('evidence', 'skip'),
});

describe('Feature: claims-assessment-eval, Property 11: Combiner totality and output cardinality', () => {
  it('returns a complete result with one perClaim entry per subject and never throws', () => {
    fc.assert(
      fc.property(fc.array(subjectArb, { maxLength: 10 }), settingsArb, (subjects, settings) => {
        const r = combine(subjects, settings);
        expect(typeof r.required).toBe('boolean');
        expect(['classifier', 'policy']).toContain(r.decidedBy);
        expect(SURFACE_LABELS as readonly string[]).toContain(r.surface);
        expect(r.perClaim).toHaveLength(subjects.length);
      }),
      { numRuns: 200 },
    );
  });

  it('handles the empty list explicitly', () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        const r = combine([], settings);
        expect(r.perClaim).toHaveLength(0);
        expect(r.required).toBe(false);
        expect(r.decidedBy).toBe('classifier');
        expect(r.surface).toBe('non_runtime');
      }),
      { numRuns: 100 },
    );
  });
});
