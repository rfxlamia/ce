// Feature: evidence-bundle, Property 22: A trace-less RuntimeResult falls back to EvidenceSummary with safe placeholders
// **Validates: Requirements 10.6**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildRunRecord } from './build.js';
import type { BuildRunRecordInput } from './build.js';
import { buildRunRecordInputArb } from './arbitraries.js';

type WithRuntime = BuildRunRecordInput & { runtime: NonNullable<BuildRunRecordInput['runtime']> };

/** EVIDENCED or ERROR input whose RuntimeResult has no `trace`. */
const traceLessInputArb: fc.Arbitrary<WithRuntime> = buildRunRecordInputArb
  .filter(
    (i) =>
      i.runtime !== null && (i.resolution.outcome === 'EVIDENCED' || i.resolution.outcome === 'ERROR'),
  )
  .map((i) => {
    const { trace: _trace, ...rest } = i.runtime as NonNullable<typeof i.runtime>;
    return { ...i, runtime: rest as NonNullable<typeof i.runtime> } as WithRuntime;
  });

describe('Property 22: a trace-less RuntimeResult falls back to EvidenceSummary with safe placeholders', () => {
  it('builds subject, steps and finalImage from the EvidenceSummary', () => {
    fc.assert(
      fc.property(traceLessInputArb, (input) => {
        expect(input.runtime.trace).toBeUndefined();
        const record = buildRunRecord(input);
        const { subject, observations } = input.runtime.evidence;

        expect(record.subject).toBe(subject.url);
        expect(record.steps).toHaveLength(observations.length);
        observations.forEach((o, idx) => {
          const s = record.steps[idx]!;
          expect(s.step).toBe(o.step);
          expect(s.screenshot).toBe(o.screenshot);
          expect(s.url).toBe('');
          expect(s.title).toBe('');
          expect(s.action).toEqual({ kind: 'unknown', description: '' });
          expect(s.probabilities).toEqual({});
          expect(s.executed).toBe(false);
        });
        expect(record.finalImage).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
