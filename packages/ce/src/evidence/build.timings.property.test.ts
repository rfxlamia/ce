// Feature: evidence-bundle, Property 17: Stage timings reflect exactly how far the run got
// **Validates: Requirements 2.14, 9.13**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMinimalRunRecord, buildRunRecord, buildValidationFailureRunRecord } from './build.js';
import type { StageTimings } from './build.js';
import { buildRunRecordInputArb } from './arbitraries.js';

const STAGE_KEYS = ['config', 'context', 'assessment', 'runtime'] as const;

function expectTimingsReflect(actual: StageTimings, given: StageTimings): void {
  expect(actual.startedAt).toBe(given.startedAt);
  expect(actual.durationMs).toBe(given.durationMs);
  expect(actual.durationMs).toBeGreaterThanOrEqual(0);
  expect(Object.keys(actual.stages).sort()).toEqual([...STAGE_KEYS].sort());
  for (const key of STAGE_KEYS) {
    const expected = given.stages[key];
    const value = actual.stages[key];
    if (expected === null) {
      // A stage that never started stays null; the builder invents no duration.
      expect(value).toBeNull();
    } else {
      // A stage that completed or threw keeps its non-negative duration.
      expect(value).toBe(expected);
      expect(value as number).toBeGreaterThanOrEqual(0);
    }
  }
}

describe('Property 17: stage timings reflect exactly how far the run got', () => {
  it('buildRunRecord and buildMinimalRunRecord copy timings: null for unstarted stages, durations otherwise', () => {
    fc.assert(
      fc.property(buildRunRecordInputArb, (input) => {
        const before = structuredClone(input.timings);
        for (const record of [buildRunRecord(input), buildMinimalRunRecord(input)]) {
          expectTimingsReflect(record.timings, before);
          // The record owns its timings: it does not alias the caller's object.
          expect(record.timings).not.toBe(input.timings);
          expect(record.timings.stages).not.toBe(input.timings.stages);
        }
        // The input is left untouched.
        expect(input.timings).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  it('buildValidationFailureRunRecord keeps the same timings', () => {
    fc.assert(
      fc.property(buildRunRecordInputArb, (input) => {
        const record = buildValidationFailureRunRecord({
          resolution: input.resolution,
          timings: input.timings,
          fields: input.validationFields ?? [],
        });
        expectTimingsReflect(record.timings, input.timings);
      }),
      { numRuns: 100 },
    );
  });
});
