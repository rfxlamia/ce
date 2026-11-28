// Feature: report-html-evidence-page, Property 8: The Box_Highlight is always clamped but the recorded value is always shown verbatim
// **Validates: Requirements 7.10, 7.3**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../schema.js";
import { renderFinal } from "./final.js";

// FractionBox is z.number() with no 0..1 constraint, so generate inside and outside.
// zod rejects NaN and Infinity, so only finite values are schema-accepted.
const coordArb = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(0, 1, -0, -0.001, 1.0001, 2, -5, 0.123456789, 1e21, 1e-7),
);

const boxArb = fc.record({ x: coordArb, y: coordArb, width: coordArb, height: coordArb });

function record(box: { x: number; y: number; width: number; height: number }): RunRecord {
  return {
    steps: [],
    finalImage: {
      model: "m",
      error: null,
      screenshot: "screenshots/final.png",
      box,
      signals: { stateReachedDom: null, stateReached: null },
    },
  } as unknown as RunRecord;
}

describe("Feature: report-html-evidence-page, Property 8", () => {
  it("positions the highlight within 0..100 percent with no opaque fill, and shows recorded values verbatim", () => {
    fc.assert(
      fc.property(boxArb, (box) => {
        const html = renderFinal(record(box), () => undefined);

        const style = /<div class="box" style="([^"]*)"/.exec(html)?.[1];
        expect(style).toBeDefined();
        const get = (prop: string): number => {
          const m = new RegExp(`(?:^|;)${prop}:(-?[0-9.]+)%`).exec(style!);
          expect(m).not.toBeNull();
          return Number(m![1]);
        };
        for (const prop of ["left", "top", "width", "height"]) {
          const v = get(prop);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
        const clamp = (n: number): number => Math.min(100, Math.max(0, n * 100));
        expect(get("left")).toBeCloseTo(clamp(box.x), 1);
        expect(get("top")).toBeCloseTo(clamp(box.y), 1);
        expect(get("width")).toBeCloseTo(clamp(box.width), 1);
        expect(get("height")).toBeCloseTo(clamp(box.height), 1);

        // No opaque fill.
        expect(style).toMatch(/background:none/);
        expect(style).not.toMatch(/background(-color)?:\s*(?!none)/);

        // Coordinate text carries the recorded, unclamped values.
        const text = /<p class="muted box-coords">([\s\S]*?)<\/p>/.exec(html)?.[1];
        expect(text).toBeDefined();
        expect(text).toContain("signal");
        expect(text).toContain(`x ${String(box.x)},`);
        expect(text).toContain(`y ${String(box.y)},`);
        expect(text).toContain(`width ${String(box.width)},`);
        expect(text).toContain(`height ${String(box.height)} of`);
      }),
      { numRuns: 100 },
    );
  });
});
