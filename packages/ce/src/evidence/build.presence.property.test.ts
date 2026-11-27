import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { RuntimeResult } from '../outcome/types.js';
import { buildRunRecord } from './build.js';
import type { BuildRunRecordInput } from './build.js';
import { buildRunRecordInputArb } from './arbitraries.js';
import { redactRunRecord } from './redact.js';
import { RunRecordSchema } from './schema.js';

/**
 * Shapes an arbitrary input into one a pipeline can really produce for the
 * resolved outcome (Requirement 2.16): SKIPPED, UNSUPPORTED and EVIDENCED only
 * happen after config, context and assessment completed, and EVIDENCED needs
 * at least one observed step. ERROR keeps any mix of reached stages.
 */
function coherent(input: BuildRunRecordInput, seed: BuildRunRecordInput): BuildRunRecordInput {
  const outcome = input.resolution.outcome;
  if (outcome === 'ERROR') return input;
  const base: BuildRunRecordInput = {
    ...input,
    config: input.config ?? seed.config,
    context: input.context ?? seed.context,
    assessment: input.assessment ?? seed.assessment,
  };
  if (outcome !== 'EVIDENCED') return base;
  const rt: RuntimeResult = input.runtime ?? (seed.runtime as RuntimeResult);
  const fixed: RuntimeResult =
    rt.trace !== undefined
      ? {
          ...rt,
          trace: {
            ...rt.trace,
            steps:
              rt.trace.steps.length > 0
                ? rt.trace.steps
                : [
                    {
                      step: 0,
                      url: 'u',
                      title: 't',
                      screenshot: 's.png',
                      action: { kind: 'done', description: '' },
                      executed: true,
                      probabilities: {},
                    },
                  ],
          },
        }
      : {
          ...rt,
          evidence: {
            ...rt.evidence,
            observations:
              rt.evidence.observations.length > 0
                ? rt.evidence.observations
                : [{ step: 0, screenshot: 's.png' }],
          },
        };
  return { ...base, runtime: fixed };
}

const withSeed = fc
  .tuple(buildRunRecordInputArb, buildRunRecordInputArb)
  .map(([a, b]) => {
    // Seeds need the fields coherent() falls back on.
    const seed: BuildRunRecordInput = {
      ...b,
      config: b.config ?? a.config,
      context: b.context ?? a.context,
      assessment: b.assessment ?? a.assessment,
      runtime: b.runtime ?? a.runtime,
    };
    return { input: a, seed };
  })
  .filter(
    ({ input, seed }) =>
      input.resolution.outcome === 'ERROR' ||
      (seed.config !== null &&
        seed.context !== null &&
        seed.assessment !== null &&
        (input.resolution.outcome !== 'EVIDENCED' || (input.runtime ?? seed.runtime) !== null)),
  );

describe('buildRunRecord field presence', () => {
  // Feature: evidence-bundle, Property 3: Field presence matches the outcome's schema variant
  // **Validates: Requirements 2.1, 2.8, 2.16, 5.10, 6.1, 6.2, 6.3, 6.4**
  it('Feature: evidence-bundle, Property 3: Field presence matches the outcome\'s schema variant', () => {
    fc.assert(
      fc.property(withSeed, ({ input: raw, seed }) => {
        const input = coherent(raw, seed);
        const built = redactRunRecord(buildRunRecord(input), []);

        const parsed = RunRecordSchema.safeParse(built);
        expect(parsed.success).toBe(true);

        const r = built;
        expect(r.outcome).toBe(input.resolution.outcome);
        expect(r.schemaVersion).toBe('1');
        expect(Array.isArray(r.jevModels)).toBe(true);
        expect(Array.isArray(r.artifacts)).toBe(true);
        expect(r.timings).toBeDefined();

        switch (r.outcome) {
          case 'SKIPPED':
          case 'UNSUPPORTED':
            expect(r.config).not.toBeNull();
            expect(r.context).not.toBeNull();
            expect(r.assessment).not.toBeNull();
            expect(r.subject).toBeNull();
            expect(r.steps).toEqual([]);
            expect(r.eventLog).toEqual([]);
            expect(r.finalImage).toBeNull();
            expect(r.runtime).toBeNull();
            expect(r.finalState).toBeNull();
            expect(r.error).toBeNull();
            break;
          case 'EVIDENCED':
            expect(r.config).not.toBeNull();
            expect(r.context).not.toBeNull();
            expect(r.assessment).not.toBeNull();
            expect(typeof r.subject).toBe('string');
            expect(r.steps.length).toBeGreaterThanOrEqual(1);
            expect(['reached', 'not_reached']).toContain(r.finalState);
            expect(r.error).toBeNull();
            break;
          case 'ERROR':
            expect(r.finalState).toBeNull();
            expect(r.error).not.toBeNull();
            if (r.assessment === null) expect(r.claims).toEqual([]);
            if (r.context === null) expect(input.context).toBeNull();
            if (r.config === null) expect(input.config).toBeNull();
            break;
        }
      }),
      { numRuns: 200 },
    );
   }, 30000);
});
