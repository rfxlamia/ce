// Feature: evidence-bundle, Property 15: jevModels is the ordered de-duplication of every model source
// **Validates: Requirements 2.12**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildRunRecord } from './build.js';
import type { BuildRunRecordInput } from './build.js';
import { buildRunRecordInputArb } from './arbitraries.js';

/** A small pool, so the three sources overlap often. */
const POOL = ['m-a', 'm-b', 'm-c', 'm-d'] as const;
const poolId = fc.constantFrom(...POOL);
const poolList = fc.array(poolId, { maxLength: 5 });

/** Inputs whose outcome carries a runtime part (EVIDENCED or ERROR), with the three sources drawn from the pool. */
const inputArb = fc
  .tuple(
    buildRunRecordInputArb.filter(
      (i) => i.resolution.outcome === 'EVIDENCED' || i.resolution.outcome === 'ERROR',
    ),
    poolList,
    poolList,
    fc.option(poolId, { nil: undefined }),
    fc.boolean(),
  )
  .map(([base, assessmentIds, traceIds, finalModel, withAssessment]) => {
    const assessment =
      withAssessment && base.assessment !== null
        ? { ...base.assessment, record: { ...base.assessment.record, modelIds: assessmentIds } }
        : null;
    const trace = base.runtime?.trace;
    const runtime =
      base.runtime && trace
        ? {
            ...base.runtime,
            trace: { ...trace, modelIds: traceIds, finalImageModel: finalModel },
          }
        : base.runtime;
    if (runtime?.trace && finalModel === undefined) delete (runtime.trace as { finalImageModel?: string }).finalImageModel;
    return { ...base, assessment, runtime } as BuildRunRecordInput;
  });

function expectedModels(input: BuildRunRecordInput): string[] {
  const sources = [
    ...(input.assessment?.record.modelIds ?? []),
    ...(input.runtime?.trace?.modelIds ?? []),
    ...(input.runtime?.trace?.finalImageModel !== undefined ? [input.runtime.trace.finalImageModel] : []),
  ];
  const out: string[] = [];
  for (const id of sources) if (!out.includes(id)) out.push(id);
  return out;
}

describe('Property 15: jevModels is the ordered de-duplication of every model source', () => {
  it('equals assessment ids, then trace ids, then finalImageModel, first occurrence only', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const record = buildRunRecord(input);
        expect(record.jevModels).toEqual(expectedModels(input));
        expect(new Set(record.jevModels).size).toBe(record.jevModels.length);
      }),
      { numRuns: 200 },
    );
  });

  it('is empty when all three sources are empty', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const empty: BuildRunRecordInput = {
          ...input,
          assessment: input.assessment
            ? { ...input.assessment, record: { ...input.assessment.record, modelIds: [] } }
            : null,
          runtime: input.runtime?.trace
            ? {
                ...input.runtime,
                trace: { ...input.runtime.trace, modelIds: [], finalImageModel: undefined },
              }
            : input.runtime,
        };
        expect(buildRunRecord(empty).jevModels).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
