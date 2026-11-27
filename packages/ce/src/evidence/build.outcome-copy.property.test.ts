import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { OUTCOMES } from '../outcome/types.js';
import { buildRunRecordInputArb, resolutionArb } from './arbitraries.js';
import { buildMinimalRunRecord, buildRunRecord, buildValidationFailureRunRecord } from './build.js';

const EVIDENCED = OUTCOMES.find((o) => o === 'EVIDENCED');

describe('Run_Record outcome copy', () => {
  // **Validates: Requirements 2.2, 2.3, 2.4, 6.6, 9.1**
  it('Feature: evidence-bundle, Property 2: Outcome and reason are copied, never computed', () => {
    fc.assert(
      fc.property(buildRunRecordInputArb, (input) => {
        for (const record of [buildRunRecord(input), buildMinimalRunRecord(input)]) {
          expect(record.outcome).toBe(input.resolution.outcome);
          expect(record.outcomeReason).toBe(input.resolution.reason);
          if (input.resolution.outcome === EVIDENCED) {
            expect(record.finalState).toBe(input.resolution.finalState ?? null);
          } else {
            expect(record.finalState).toBeNull();
          }
          expect(record.finalState !== null).toBe(
            input.resolution.outcome === EVIDENCED && input.resolution.finalState !== undefined,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Feature: evidence-bundle, Property 2: Outcome and reason are copied, never computed (Validation_Failure shape)', () => {
    fc.assert(
      fc.property(resolutionArb, buildRunRecordInputArb, (resolution, base) => {
        const record = buildValidationFailureRunRecord({
          resolution,
          timings: base.timings,
          fields: base.validationFields ?? [],
        });
        expect(record.outcome).toBe(resolution.outcome);
        expect(record.outcomeReason).toBe(resolution.reason);
        expect(record.finalState).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});
