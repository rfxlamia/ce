import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { combine, type SubjectProbabilities } from './combine.js';
import type { AssessmentSettings, Surface } from './types.js';

const base: AssessmentSettings = {
  claimThreshold: 0.6,
  observableThreshold: 0.6,
  adequateThreshold: 0.7,
  uncertaintyBand: 0.1,
  onUncertain: 'evidence',
};

function subj(
  claimId: string,
  runtimeObservable: number,
  checksAdequate: number,
  surface: Surface = 'browser_ui',
  surfaceConfidence = 0.9,
): SubjectProbabilities {
  return { claimId, runtimeObservable, checksAdequate, surface, surfaceConfidence };
}

describe('combine', () => {
  it('empty input: not required, classifier, non_runtime', () => {
    const r = combine([], base);
    expect(r.required).toBe(false);
    expect(r.decidedBy).toBe('classifier');
    expect(r.surface).toBe('non_runtime');
    expect(r.policyDecision).toBeUndefined();
  });

  it('needed subject: required, decided by classifier', () => {
    const r = combine([subj('a', 0.95, 0.1)], base);
    expect(r.perClaim[0]).toMatchObject({ needed: true, uncertain: false });
    expect(r.required).toBe(true);
    expect(r.decidedBy).toBe('classifier');
  });

  it('threshold equality: observable == threshold is needed; adequate == threshold is not', () => {
    expect(combine([subj('a', 0.6, 0.1)], base).perClaim[0]!.needed).toBe(true);
    expect(combine([subj('a', 0.95, 0.7)], base).perClaim[0]!.needed).toBe(false);
  });

  it('uncertain without needed: policy decides, and is recorded', () => {
    const s = subj('a', 0.5, 0.1); // 0.5 is within 0.1 of 0.6, but below it
    const ev = combine([s], base);
    expect(ev).toMatchObject({ required: true, decidedBy: 'policy' });
    expect(ev.policyDecision).toEqual({
      policy: 'evidence',
      inBand: [{ subjectId: 'a', probability: 'runtimeObservable' }],
    });
    const sk = combine([s], { ...base, onUncertain: 'skip' });
    expect(sk).toMatchObject({ required: false, decidedBy: 'policy' });
    expect(sk.policyDecision?.policy).toBe('skip');
  });

  it('needed and uncertain together: classifier decides, no policy record', () => {
    // needed (0.95, 0.1) plus a second subject inside the band
    const r = combine([subj('a', 0.95, 0.1), subj('b', 0.55, 0.9)], base);
    expect(r.perClaim[1]!.uncertain).toBe(true);
    expect(r).toMatchObject({ required: true, decidedBy: 'classifier' });
    expect(r.policyDecision).toBeUndefined();
  });

  it.each(['evidence', 'skip'] as const)(
    'subject far from both thresholds: decidedBy classifier with policy %s',
    (onUncertain) => {
      const settings = { ...base, onUncertain };
      const notNeeded = combine([subj('a', 0.1, 0.95)], settings);
      expect(notNeeded.perClaim[0]).toMatchObject({ needed: false, uncertain: false });
      expect(notNeeded).toMatchObject({ required: false, decidedBy: 'classifier' });
      expect(notNeeded.policyDecision).toBeUndefined();

      const needed = combine([subj('a', 0.95, 0.1)], settings);
      expect(needed).toMatchObject({ required: true, decidedBy: 'classifier' });
      expect(needed.policyDecision).toBeUndefined();
    },
  );

  it('dominant surface tie goes to the earliest subject', () => {
    const r = combine(
      [subj('a', 0.9, 0.1, 'cli', 0.8), subj('b', 0.9, 0.1, 'http_api', 0.8)],
      base,
    );
    expect(r.surface).toBe('cli');
    const r2 = combine(
      [subj('a', 0.9, 0.1, 'http_api', 0.8), subj('b', 0.9, 0.1, 'cli', 0.8)],
      base,
    );
    expect(r2.surface).toBe('http_api');
  });

  it('band is closed', () => {
    const r = combine([subj('a', 0.5, 0.1)], { ...base, uncertaintyBand: 0.1 });
    expect(r.perClaim[0]!.uncertain).toBe(true);
    const r2 = combine([subj('a', 0.4, 0.1)], { ...base, uncertaintyBand: 0.1 });
    expect(r2.perClaim[0]!.uncertain).toBe(false);
  });

  it('dominant surface: driving subjects only, highest confidence, ties to first', () => {
    const r = combine(
      [
        subj('a', 0.1, 0.9, 'cli', 0.99), // not driving
        subj('b', 0.9, 0.1, 'http_api', 0.7),
        subj('c', 0.9, 0.1, 'browser_ui', 0.7),
        subj('d', 0.9, 0.1, 'native_app', 0.6),
      ],
      base,
    );
    expect(r.surface).toBe('http_api');
  });

  it('dominant surface over all subjects when none drives', () => {
    const r = combine([subj('a', 0.1, 0.9, 'cli', 0.5), subj('b', 0.1, 0.9, 'http_api', 0.8)], base);
    expect(r.surface).toBe('http_api');
  });
});

describe('combine properties', () => {
  const p = fc.double({ min: 0, max: 1, noNaN: true });
  const subjects = fc.array(
    fc.record({
      claimId: fc.string(),
      runtimeObservable: p,
      checksAdequate: p,
      surface: fc.constantFrom<Surface>('browser_ui', 'http_api', 'cli', 'backend_internal', 'native_app', 'non_runtime'),
      surfaceConfidence: p,
    }),
    { maxLength: 6 },
  );
  const settings = fc.record({
    claimThreshold: p,
    observableThreshold: p,
    adequateThreshold: p,
    uncertaintyBand: fc.constantFrom(0, 0.05, 0.1, 0.3),
    onUncertain: fc.constantFrom<'evidence' | 'skip'>('evidence', 'skip'),
  });

  it('required and decidedBy equations; policy irrelevance when classifier decides', () => {
    // **Validates: Requirements 6.9, 6.10, 7.5, 7.6**
    fc.assert(
      fc.property(subjects, settings, (subs, st) => {
        const r = combine(subs, st);
        const anyNeeded = r.perClaim.some((c) => c.needed);
        const anyUncertain = r.perClaim.some((c) => c.uncertain);
        expect(r.required).toBe(anyNeeded || (anyUncertain && st.onUncertain === 'evidence'));
        expect(r.decidedBy === 'policy').toBe(!anyNeeded && anyUncertain);
        expect(r.policyDecision !== undefined).toBe(r.decidedBy === 'policy');
        if (r.decidedBy === 'classifier') {
          const other = combine(subs, { ...st, onUncertain: st.onUncertain === 'skip' ? 'evidence' : 'skip' });
          expect(other.required).toBe(r.required);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('band 0: uncertain only on exact equality', () => {
    // **Validates: Requirements 6.11**
    fc.assert(
      fc.property(subjects, settings, (subs, st) => {
        const r = combine(subs, { ...st, uncertaintyBand: 0 });
        r.perClaim.forEach((c) => {
          if (c.uncertain) {
            expect(c.runtimeObservable === st.observableThreshold || c.checksAdequate === st.adequateThreshold).toBe(true);
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});
