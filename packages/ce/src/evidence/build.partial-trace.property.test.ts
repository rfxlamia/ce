// Feature: evidence-bundle, Property 9: A partial runtime trace is carried into the Minimal_Bundle unchanged
// **Validates: Requirements 5.8, 5.9**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OUTCOMES } from '../outcome/types.js';
import { buildMinimalRunRecord } from './build.js';
import type { BuildRunRecordInput } from './build.js';
import { buildRunRecordInputArb } from './arbitraries.js';

const ERROR_OUTCOME = OUTCOMES[3];

type WithPartial = BuildRunRecordInput & { partialTrace: NonNullable<BuildRunRecordInput['partialTrace']> };

/** An ERROR input with a partial trace and no RuntimeResult (the LoopStageError case). */
const partialInputArb: fc.Arbitrary<WithPartial> = buildRunRecordInputArb
  .filter((i) => i.partialTrace !== undefined && i.resolution.outcome === ERROR_OUTCOME)
  .map((i) => ({ ...i, runtime: null }) as WithPartial);

describe('Property 9: a partial runtime trace is carried into the Minimal_Bundle unchanged', () => {
  it('copies steps and eventLog from the partial trace and leaves finalImage null', () => {
    fc.assert(
      fc.property(partialInputArb, (input) => {
        const record = buildMinimalRunRecord(input);
        const partial = input.partialTrace;

        // Expected steps: one per partial step entry, then one `none` step per
        // observation whose step number has no entry, ordered by step number.
        const expected = partial.steps.map((s) => ({
          step: s.observation.step,
          url: s.observation.url,
          title: s.observation.title,
          kind: s.action.kind as string,
          executed: s.executed === true,
          screenshot: s.observation.screenshot,
          probabilities: s.probabilities,
        }));
        const covered = new Set(expected.map((e) => e.step));
        for (const o of partial.observations) {
          if (covered.has(o.step)) continue;
          covered.add(o.step);
          expected.push({
            step: o.step,
            url: o.url,
            title: o.title,
            kind: 'none',
            executed: false,
            screenshot: o.screenshot,
            probabilities: {},
          });
        }
        expected.sort((a, b) => a.step - b.step);

        expect(
          record.steps.map((s) => ({
            step: s.step,
            url: s.url,
            title: s.title,
            kind: s.action.kind,
            executed: s.executed,
            screenshot: s.screenshot,
            probabilities: s.probabilities,
          })),
        ).toEqual(expected);

        expect(record.eventLog).toEqual(
          partial.eventLog.map((e) => ({ step: e.step, kind: e.kind, detail: e.detail })),
        );
        expect(record.finalImage).toBeNull();
        expect(record.runtime).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
