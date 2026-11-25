import { describe, it } from "vitest";
import fc from "fast-check";
import { computeStats } from "./stats.js";

describe("stats property", () => {
  // Feature: ce-testing-spike, Property 1: Latency statistics separate successes from failures and are internally consistent
  it("Feature: ce-testing-spike, Property 1: Latency statistics separate successes from failures and are internally consistent", () => {
    // **Validates: Requirements 3.3, 3.5**
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 60000, noNaN: true })),
        fc.nat(),
        (samples, failures) => {
          const s = computeStats(samples, failures);
          if (s.count !== samples.length) return false;
          if (s.failures !== failures) return false;
          if (samples.length === 0) return true;
          return (
            s.min <= s.p50 &&
            s.p50 <= s.p95 &&
            s.p95 <= s.max &&
            s.min === Math.min(...samples) &&
            s.max === Math.max(...samples)
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
