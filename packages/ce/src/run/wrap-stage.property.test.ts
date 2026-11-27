import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StageError, type Stage } from '../errors.js';
import { wrapStage } from './resolve.js';

const MARKER = 'CAUSE_MARKER_7f3a9c';

const stageArb = fc.constantFrom<Stage>('context', 'assessment', 'runtime', 'evidence');

const noiseArb = fc.string({ maxLength: 12 }).filter((s) => !s.includes(MARKER));

const markedStringArb = fc
  .tuple(noiseArb, noiseArb)
  .map(([a, b]) => `${a}${MARKER}${b}`);

const thrownArb: fc.Arbitrary<unknown> = fc.oneof(
  markedStringArb.map((m) => new Error(m)),
  markedStringArb.map((m) => new TypeError(m)),
  markedStringArb,
  fc.double(),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
  markedStringArb.map((m) => ({ message: m, detail: m })),
  fc.dictionary(fc.string({ maxLength: 6 }), fc.integer()),
);

describe('wrapStage properties', () => {
  // Feature: run-vertical-slice, Property 6: Stage wrapping preserves stage and hides the cause message
  // **Validates: Requirements 6.3, 6.6, 8.6**
  it('wraps any thrown value into a StageError with the given stage and no cause message', () => {
    fc.assert(
      fc.property(stageArb, thrownArb, (stage, thrown) => {
        const wrapped = wrapStage(stage, thrown);
        expect(wrapped).toBeInstanceOf(StageError);
        expect(wrapped.stage).toBe(stage);
        expect(wrapped.message).not.toContain(MARKER);
        expect(wrapped.cause).toBe(thrown);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: run-vertical-slice, Property 6: Stage wrapping preserves stage and hides the cause message
  // **Validates: Requirements 6.3, 6.6, 8.6**
  it('returns the same instance for a StageError input', () => {
    fc.assert(
      fc.property(stageArb, stageArb, thrownArb, (original, requested, cause) => {
        const err = new StageError(original, cause);
        const wrapped = wrapStage(requested, err);
        expect(wrapped).toBe(err);
        expect(wrapped.stage).toBe(original);
      }),
      { numRuns: 100 },
    );
  });
});
