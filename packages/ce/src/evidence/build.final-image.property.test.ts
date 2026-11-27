import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Resolution, RuntimeResult } from '../outcome/types.js';
import { resolveOutcome } from '../outcome/resolve.js';
import { buildRunRecord } from './build.js';
import type { BuildRunRecordInput } from './build.js';
import { buildRunRecordInputArb, runtimeTraceArb } from './arbitraries.js';

type RuntimeInput = BuildRunRecordInput & { runtime: RuntimeResult };

// A RuntimeResult with or without a trace, in a run that reached the runtime stage.
const scenario = fc
  .tuple(
    buildRunRecordInputArb.filter((i): i is RuntimeInput => i.runtime !== null),
    fc.option(runtimeTraceArb, { nil: undefined }),
    fc.constantFrom('EVIDENCED', 'ERROR'),
  )
  .map(([input, trace, outcome]) => {
    const { trace: _drop, ...rest } = input.runtime;
    const runtime: RuntimeResult = trace === undefined ? rest : { ...rest, trace };
    const resolution: Resolution =
      outcome === 'EVIDENCED'
        ? { outcome: 'EVIDENCED', reason: 'evidence-collected', finalState: runtime.finalState }
        : { outcome: 'ERROR', reason: 'evidence-incomplete' };
    return { input: { ...input, runtime, resolution } as BuildRunRecordInput, runtime };
  });

describe('buildRunRecord finalImage', () => {
  // Feature: evidence-bundle, Property 16: finalImage is present only with a trace and mirrors it exactly
  // **Validates: Requirements 2.13**
  it('Feature: evidence-bundle, Property 16: finalImage is present only with a trace and mirrors it exactly', () => {
    fc.assert(
      fc.property(scenario, ({ input, runtime }) => {
        const record = buildRunRecord(input);
        const trace = runtime.trace;
        expect(record.finalImage === null).toBe(trace === undefined);
        if (trace !== undefined) {
          expect(record.finalImage).toEqual({
            model: trace.finalImageModel ?? null,
            error: trace.finalImageError ?? null,
            screenshot: trace.finalScreenshot ?? null,
          });
        }

        // The Resolution does not depend on finalImageError.
        if (trace !== undefined) {
          const base = {
            assessment: { required: true, surface: 'browser_ui' as const },
          };
          const withErr = resolveOutcome({
            ...base,
            runtime: { ...runtime, trace: { ...trace, finalImageError: 'boom' } },
          });
          const { finalImageError: _e, ...noErr } = trace;
          const withoutErr = resolveOutcome({ ...base, runtime: { ...runtime, trace: noErr } });
          expect(withErr).toEqual(withoutErr);
        }
      }),
      { numRuns: 200 },
    );
  });
});
