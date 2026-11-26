import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildRow } from './agreement.js';

const QUESTIONS = [
  'claim.is_behavior',
  'assess.runtime_observable',
  'assess.checks_adequate',
  'assess.surface',
  'assessment.required',
  'assessment.claimStatus',
] as const;

const valueArb = fc.oneof(
  fc.boolean(),
  fc.constantFrom('a', 'b', 'c', 'web', 'none'),
  fc.integer({ min: 0, max: 3 }),
) as fc.Arbitrary<number | string | boolean>;

const sampleArb = fc.record({
  fixtureId: fc.string({ minLength: 1, maxLength: 8 }),
  subject: fc.string({ maxLength: 20 }),
  predicted: valueArb,
  label: valueArb,
});

describe('eval agreement', () => {
  it('Feature: claims-assessment-eval, Property 19: Eval bounds and accounting', () => {
    // **Validates: Requirements 13.1, 13.2, 13.6, 13.7, 13.10, 13.11**
    fc.assert(
      fc.property(
        fc.constantFrom(...QUESTIONS),
        fc.array(sampleArb, { maxLength: 40 }),
        (question, samples) => {
          const { row, disagreements } = buildRow(question, samples, (p, l) => p === l);
          expect(row.question).toBe(question);
          expect(row.samples).toBe(samples.length);
          expect(row.agreeing).toBeGreaterThanOrEqual(0);
          expect(row.agreeing).toBeLessThanOrEqual(row.samples);
          if (row.samples === 0) {
            expect(row.agreement).toBeNull();
          } else {
            expect(row.agreement).not.toBeNull();
            expect(row.agreement!).toBeGreaterThanOrEqual(0);
            expect(row.agreement!).toBeLessThanOrEqual(1);
            expect(row.agreement).toBe(row.agreeing / row.samples);
          }
          expect(disagreements).toHaveLength(row.samples - row.agreeing);
          for (const d of disagreements) expect(d.question).toBe(question);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty sample list yields null agreement and no disagreements', () => {
    const { row, disagreements } = buildRow('assessment.required', [], (p, l) => p === l);
    expect(row).toEqual({ question: 'assessment.required', samples: 0, agreeing: 0, agreement: null });
    expect(disagreements).toEqual([]);
  });
});
