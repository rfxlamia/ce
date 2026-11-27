// Feature: evidence-bundle, Property 18: error.fields is non-empty only for an evidence-stage validation failure
// **Validates: Requirements 2.19, 5.5**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Resolution } from '../outcome/types.js';
import { buildRunRecordInputArb, stageErrorArb } from './arbitraries.js';
import { buildRunRecord, buildValidationFailureRunRecord } from './build.js';

const fieldPathsArb = fc.array(
  fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,8}(\.[a-z][a-zA-Z0-9]{0,8}){0,2}$/),
  { maxLength: 5 },
);

describe('Feature: evidence-bundle, Property 18: error.fields is non-empty only for an evidence-stage validation failure', () => {
  it('error.fields is [] unless error.stage is evidence, and then equals the failing paths', () => {
    fc.assert(
      fc.property(buildRunRecordInputArb, fieldPathsArb, (input, validationFields) => {
        const record = buildRunRecord({ ...input, validationFields });
        if (record.error === null) return;
        if (record.error.stage === 'evidence') {
          expect(record.error.fields).toEqual(validationFields);
        } else {
          expect(record.error.fields).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('error.fields is [] when no validation failure is reported, for any StageError', () => {
    fc.assert(
      fc.property(buildRunRecordInputArb, stageErrorArb, (input, error) => {
        const resolution: Resolution = { outcome: 'ERROR', reason: 'stage-error', errorStage: error.stage };
        const { validationFields: _omit, ...rest } = input;
        const record = buildRunRecord({ ...rest, resolution, error });
        expect(record.error).not.toBeNull();
        expect(record.error!.fields).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('a Validation_Failure record carries exactly the failing paths at the evidence stage', () => {
    fc.assert(
      fc.property(buildRunRecordInputArb, fieldPathsArb, (input, fields) => {
        const resolution: Resolution = { outcome: 'ERROR', reason: 'stage-error', errorStage: 'evidence' };
        const record = buildValidationFailureRunRecord({ resolution, timings: input.timings, fields });
        expect(record.error?.stage).toBe('evidence');
        expect(record.error?.fields).toEqual(fields);
      }),
      { numRuns: 100 },
    );
  });
});
