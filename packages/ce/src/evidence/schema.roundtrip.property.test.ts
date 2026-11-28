import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { RunRecordSchema } from './schema.js';
import { runRecordArb } from './arbitraries.js';

describe('Run_Schema round trip', () => {
  // Feature: evidence-bundle, Property 4: Round-trip through the Run_Schema is lossless
  // **Validates: Requirements 3.8**
  it('Feature: evidence-bundle, Property 4: Round-trip through the Run_Schema is lossless', () => {
    fc.assert(
      fc.property(runRecordArb, (r) => {
        const first = RunRecordSchema.parse(r);
        const again = RunRecordSchema.parse(JSON.parse(JSON.stringify(first)));
        expect(again).toEqual(r);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: report-html-evidence-page, Property 13: The extended Run_Record shape round-trips and agrees with its JSON Schema
  // **Validates: Requirements 12.5, 12.8**
  it('Feature: report-html-evidence-page, Property 13: alternatives, finalImage.box and finalImage.signals survive the round trip', () => {
    let withAlternatives = 0;
    let withBox = 0;
    let withSignals = 0;
    fc.assert(
      fc.property(runRecordArb, (r) => {
        const viaJson = RunRecordSchema.parse(JSON.parse(JSON.stringify(RunRecordSchema.parse(r))));
        expect(viaJson).toEqual(r);

        for (let i = 0; i < r.steps.length; i++) {
          const before = r.steps[i]!.alternatives;
          expect(Array.isArray(before)).toBe(true);
          expect(viaJson.steps[i]!.alternatives).toEqual(before);
          if (before.length > 0) withAlternatives++;
        }

        if (r.finalImage !== null) {
          expect(viaJson.finalImage).not.toBeNull();
          expect(viaJson.finalImage!.box).toEqual(r.finalImage.box);
          expect(viaJson.finalImage!.signals).toEqual(r.finalImage.signals);
          // signals is always an object, never null.
          expect(viaJson.finalImage!.signals).not.toBeNull();
          if (r.finalImage.box !== null) withBox++;
          if (
            r.finalImage.signals.stateReached !== null ||
            r.finalImage.signals.stateReachedDom !== null
          ) {
            withSignals++;
          }
        }
      }),
      { numRuns: 300 },
    );
    // The generators must actually exercise the new fields.
    expect(withAlternatives).toBeGreaterThan(0);
    expect(withBox).toBeGreaterThan(0);
    expect(withSignals).toBeGreaterThan(0);
  });
});
