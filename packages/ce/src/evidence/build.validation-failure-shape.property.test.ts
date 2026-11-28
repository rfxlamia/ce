import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { OUTCOMES } from '../outcome/types.js';
import type { Resolution } from '../outcome/types.js';
import { buildValidationFailureRunRecord } from './build.js';
import { errorRunRecordArb, runRecordArb } from './arbitraries.js';
import { RunRecordSchema } from './schema.js';

const LEAK = 'LEAKED-MUTATION-VALUE-7f3a';

/** Dot-paths the mutations can hit. Each is replaced by an object holding LEAK, which no field accepts. */
const MUTABLE_PATHS = [
  'config',
  'context',
  'claims',
  'assessment',
  'subject',
  'steps',
  'eventLog',
  'finalImage',
  'runtime',
  'artifacts',
  'jevModels',
  'timings.durationMs',
  'timings.stages.config',
  'ceVersion',
] as const;

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let node = target;
  for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
  node[keys[keys.length - 1]!] = value;
}

const ERROR_OUTCOME = OUTCOMES[3];
const resolution: Resolution = {
  outcome: ERROR_OUTCOME,
  reason: 'stage-error',
  errorStage: 'evidence',
};

describe('Validation_Failure bundle shape', () => {
  // Feature: evidence-bundle, Property 10: A Validation_Failure bundle carries only top-level fields and path-only errors
  // **Validates: Requirements 5.13, 5.14**
  it('Feature: evidence-bundle, Property 10: A Validation_Failure bundle carries only top-level fields and path-only errors', () => {
    fc.assert(
      fc.property(
        fc.oneof(runRecordArb, errorRunRecordArb),
        fc.uniqueArray(fc.constantFrom(...MUTABLE_PATHS), { minLength: 1, maxLength: 5 }),
        (valid, paths) => {
          // Apply the mutations to a copy of an otherwise valid record.
          const mutated = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
          for (const p of paths) {
            const parent = p.split('.').slice(0, -1);
            let node: unknown = mutated;
            for (const k of parent) node = (node as Record<string, unknown>)[k];
            if (node === null || typeof node !== 'object') continue;
            setPath(mutated, p, { leak: LEAK });
          }
          const applied = paths.filter((p) => {
            let node: unknown = mutated;
            for (const k of p.split('.')) {
              if (node === null || typeof node !== 'object') return false;
              node = (node as Record<string, unknown>)[k];
            }
            return JSON.stringify(node) === JSON.stringify({ leak: LEAK });
          });
          fc.pre(applied.length > 0);
          expect(RunRecordSchema.safeParse(mutated).success).toBe(false);

          const record = buildValidationFailureRunRecord({
            resolution,
            timings: valid.timings,
            fields: applied,
          });

          // Only the allowed top-level keys carry content.
          expect(record.schemaVersion).toBe('2');
          expect(record.outcome).toBe(ERROR_OUTCOME);
          expect(record.outcomeReason).toBe(resolution.reason);
          expect(record.timings).toEqual(valid.timings);
          expect(record.jevModels).toEqual([]);
          expect(record.artifacts).toEqual([]);
          expect(record.config).toBeNull();
          expect(record.context).toBeNull();
          expect(record.claims).toEqual([]);
          expect(record.assessment).toBeNull();
          expect(record.subject).toBeNull();
          expect(record.steps).toEqual([]);
          expect(record.eventLog).toEqual([]);
          expect(record.finalImage).toBeNull();
          expect(record.runtime).toBeNull();
          expect(record.finalState).toBeNull();

          // error.fields equals exactly the mutated paths, and no value appears anywhere.
          expect(record.error).not.toBeNull();
          expect(record.error!.stage).toBe('evidence');
          expect([...record.error!.fields].sort()).toEqual([...applied].sort());
          expect(JSON.stringify(record)).not.toContain(LEAK);

          // The shape itself is a valid Run_Record.
          expect(RunRecordSchema.safeParse(record).success).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
