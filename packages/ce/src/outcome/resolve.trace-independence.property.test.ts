import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RuntimeTrace } from '../evidence/trace.js';
import { arbResolveInput, arbRuntimeResult } from './arbitraries.js';
import { resolveOutcome } from './resolve.js';
import type { ResolveInput, RuntimeResult } from './types.js';

const arbText = fc.string({ maxLength: 20 });

const arbStep = fc.record({
  step: fc.nat({ max: 50 }),
  url: arbText,
  title: arbText,
  screenshot: arbText,
  action: fc.record({ kind: arbText, description: arbText }),
  executed: fc.boolean(),
  probabilities: fc.dictionary(
    arbText,
    fc.double({ min: 0, max: 1, noNaN: true }),
    { maxKeys: 3 },
  ),
});

const arbEvent = fc.record({
  step: fc.nat({ max: 50 }),
  kind: fc.constantFrom('dialog', 'download', 'popup', 'settle', 'refusal' as const),
  detail: arbText,
});

/** RuntimeTrace-shaped plain object built inline. */
const arbTrace: fc.Arbitrary<RuntimeTrace> = fc
  .record(
    {
      steps: fc.array(arbStep, { maxLength: 4 }),
      eventLog: fc.array(arbEvent, { maxLength: 4 }),
      finalScreenshot: arbText,
      finalImageModel: arbText,
      finalImageError: arbText,
      stopReason: fc.constantFrom(
        'done',
        'reached',
        'give_up',
        'max-steps',
        'time-budget',
        'aborted' as const,
      ),
      modelIds: fc.array(arbText, { maxLength: 3 }),
    },
    { requiredKeys: ['steps', 'eventLog', 'stopReason', 'modelIds'] },
  )
  .map((t) => t as RuntimeTrace);

function withTrace(runtime: RuntimeResult, trace: RuntimeTrace | undefined): RuntimeResult {
  return { ...runtime, trace };
}

describe('outcome-resolver: trace independence', () => {
  // Feature: evidence-bundle, Property 20: resolveOutcome is unaffected by the presence of a trace
  // **Validates: Requirements 10.5**
  it('Property 20: resolveOutcome is unaffected by the presence of a trace', () => {
    fc.assert(
      fc.property(arbResolveInput, arbTrace, (base, trace) => {
        fc.pre(base.runtime !== undefined);
        const runtime = base.runtime as RuntimeResult;

        const withoutTrace: ResolveInput = { ...base, runtime: withTrace(runtime, undefined) };
        const withATrace: ResolveInput = { ...base, runtime: withTrace(runtime, trace) };
        const noKey: ResolveInput = { ...base, runtime: { ...runtime } };
        delete noKey.runtime?.trace;

        const expected = resolveOutcome(withoutTrace);
        expect(resolveOutcome(withATrace)).toEqual(expected);
        expect(resolveOutcome(noKey)).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: evidence-bundle, Property 20: resolveOutcome is unaffected by the presence of a trace
  // **Validates: Requirements 10.5**
  it('Property 20: a different trace on the same runtime gives the same Resolution', () => {
    fc.assert(
      fc.property(arbRuntimeResult, arbTrace, arbTrace, (runtime, a, b) => {
        const input = (trace: RuntimeTrace): ResolveInput => ({
          assessment: { required: true, surface: 'browser_ui' },
          runtime: withTrace(runtime, trace),
        });
        expect(resolveOutcome(input(a))).toEqual(resolveOutcome(input(b)));
      }),
      { numRuns: 200 },
    );
  });
});
