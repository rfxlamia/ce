import { describe, it } from 'vitest';
import fc from 'fast-check';
import { combine, type SubjectProbabilities } from './combine.js';
import type { AssessmentSettings, Surface } from './types.js';

// Feature: claims-assessment-eval, Property 12: decidedBy iff and policy record
// **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

const SURFACES: Surface[] = [
  'browser_ui',
  'http_api',
  'cli',
  'backend_internal',
  'native_app',
  'non_runtime',
];

// Hundredths keep threshold arithmetic exact enough that the oracle and the
// implementation agree on closed-band boundaries.
const hundredth = fc.integer({ min: 0, max: 100 }).map((n) => n / 100);

const settingsArb: fc.Arbitrary<AssessmentSettings> = fc.record({
  claimThreshold: hundredth,
  observableThreshold: hundredth,
  adequateThreshold: hundredth,
  uncertaintyBand: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 30 }).map((n) => n / 100)),
  onUncertain: fc.constantFrom<'evidence' | 'skip'>('evidence', 'skip'),
});

const subjectArb = (i: number): fc.Arbitrary<SubjectProbabilities> =>
  fc.record({
    claimId: fc.constant(`c${i}`),
    runtimeObservable: hundredth,
    checksAdequate: hundredth,
    surface: fc.constantFrom(...SURFACES),
    surfaceConfidence: hundredth,
  });

const subjectsArb = fc
  .integer({ min: 0, max: 6 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => subjectArb(i))));

const near = (a: number, b: number, band: number): boolean => Math.abs(a - b) <= band + 1e-9;

describe('Property 12: decidedBy iff and policy record', () => {
  it('decidedBy is policy iff no subject is needed and some is uncertain; policyDecision only then', () => {
    fc.assert(
      fc.property(subjectsArb, settingsArb, (subjects, settings) => {
        const r = combine(subjects, settings);

        const anyNeeded = r.perClaim.some((p) => p.needed);
        const anyUncertain = r.perClaim.some((p) => p.uncertain);
        const expectPolicy = !anyNeeded && anyUncertain;

        if ((r.decidedBy === 'policy') !== expectPolicy) return false;
        if ((r.policyDecision !== undefined) !== expectPolicy) return false;

        if (r.policyDecision !== undefined) {
          if (r.policyDecision.policy !== settings.onUncertain) return false;
          if (r.policyDecision.inBand.length === 0) return false;
          for (const entry of r.policyDecision.inBand) {
            const s = subjects.find((x) => x.claimId === entry.subjectId);
            if (!s) return false;
            const ok =
              entry.probability === 'runtimeObservable'
                ? near(s.runtimeObservable, settings.observableThreshold, settings.uncertaintyBand)
                : near(s.checksAdequate, settings.adequateThreshold, settings.uncertaintyBand);
            if (!ok) return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('when decidedBy is policy, required follows onUncertain', () => {
    fc.assert(
      fc.property(subjectsArb, settingsArb, (subjects, settings) => {
        const r = combine(subjects, settings);
        return r.decidedBy !== 'policy' || r.required === (settings.onUncertain === 'evidence');
      }),
      { numRuns: 200 },
    );
  });
});
