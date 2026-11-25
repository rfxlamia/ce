import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeLatencyStats } from '../probe.js';

// Feature: jev-gateway, Property 20: Latency statistics are order-independent and internally consistent
// **Validates: Requirements 15.3, 15.4, 15.7**

const samplesArb = fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), {
  minLength: 1,
  maxLength: 100,
});
const failuresArb = fc.nat({ max: 1000 });

describe('Property 20: latency statistics', () => {
  it('is order-independent, nearest-rank and internally consistent', () => {
    fc.assert(
      fc.property(samplesArb, failuresArb, fc.infiniteStream(fc.nat()), (samples, failures, _s) => {
        const stats = computeLatencyStats(samples, failures);
        const sorted = [...samples].sort((a, b) => a - b);
        const n = sorted.length;
        const nearest = (p: number): number =>
          sorted[Math.min(n - 1, Math.max(0, Math.ceil((p * n) / 100) - 1))] as number;

        expect(stats.count).toBe(n);
        expect(stats.failures).toBe(failures);
        expect(stats.min).toBe(sorted[0]);
        expect(stats.max).toBe(sorted[n - 1]);
        expect(stats.p50).toBe(nearest(50));
        expect(stats.p95).toBe(nearest(95));
        expect(stats.min).toBeLessThanOrEqual(stats.p50);
        expect(stats.p50).toBeLessThanOrEqual(stats.p95);
        expect(stats.p95).toBeLessThanOrEqual(stats.max);
        expect(samples).toContain(stats.p50);
        expect(samples).toContain(stats.p95);
      }),
      { numRuns: 100 },
    );
  });

  it('gives the same result for any permutation and does not mutate the input', () => {
    fc.assert(
      fc.property(
        samplesArb.chain((arr) => fc.tuple(fc.constant(arr), fc.shuffledSubarray(arr, { minLength: arr.length }))),
        failuresArb,
        ([samples, shuffled], failures) => {
          const copy = [...samples];
          const a = computeLatencyStats(samples, failures);
          const b = computeLatencyStats(shuffled, failures);
          expect(a).toEqual(b);
          expect(samples).toEqual(copy);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns NaN statistics and count 0 for an empty list without throwing', () => {
    fc.assert(
      fc.property(failuresArb, (failures) => {
        const stats = computeLatencyStats([], failures);
        expect(stats.count).toBe(0);
        expect(stats.failures).toBe(failures);
        for (const key of ['p50', 'p95', 'min', 'max'] as const) {
          expect(Number.isNaN(stats[key])).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
