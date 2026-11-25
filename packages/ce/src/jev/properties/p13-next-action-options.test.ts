import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATALOG, MAX_NEXT_ACTION_OPTIONS, NEXT_ACTION_FIXED_OPTIONS } from "../catalog.js";

// Feature: jev-gateway, Property 13: runtime.next_action option construction preserves labels exactly up to its limit
// **Validates: Requirements 9.6, 9.11**

const label = fc.oneof(fc.string({ unit: "grapheme", maxLength: 60 }), fc.string({ unit: "grapheme-ascii", maxLength: 60 }));

describe("Property 13: runtime.next_action option construction preserves labels exactly up to its limit", () => {
  it("holds exactly the given labels plus done and give_up for 1..240 labels", () => {
    fc.assert(
      fc.property(fc.array(label, { minLength: 1, maxLength: MAX_NEXT_ACTION_OPTIONS }), (labels) => {
        const question = CATALOG.runtimeNextAction.build(labels);
        expect(question.type).toBe("choice");
        const criteria = question.criteria as Record<string, string>;

        // Labels are keyed by their zero-based index, in order, and unchanged.
        expect(Object.keys(criteria).sort()).toEqual(
          [...Array.from(labels.keys(), String), ...NEXT_ACTION_FIXED_OPTIONS].sort(),
        );
        labels.forEach((l, i) => expect(criteria[String(i)]).toBe(l));
        for (const fixed of NEXT_ACTION_FIXED_OPTIONS) {
          expect(typeof criteria[fixed]).toBe("string");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("throws a RangeError naming 240 for more than 240 labels", () => {
    expect(MAX_NEXT_ACTION_OPTIONS).toBe(240);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.string({ maxLength: 20 }), (extra, l) => {
        const labels = Array.from({ length: MAX_NEXT_ACTION_OPTIONS + extra }, () => l);
        expect(() => CATALOG.runtimeNextAction.build(labels)).toThrow(RangeError);
        expect(() => CATALOG.runtimeNextAction.build(labels)).toThrow(/240/);
      }),
      { numRuns: 100 },
    );
  });
});
