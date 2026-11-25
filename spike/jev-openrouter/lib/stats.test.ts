import { describe, expect, it } from 'vitest';
import { computeStats } from './stats.js';

describe('computeStats', () => {
  it('handles an empty array without throwing', () => {
    const s = computeStats([], 0);
    expect(s.count).toBe(0);
    expect(s.failures).toBe(0);
    expect(s.p50).toBeNaN();
    expect(s.p95).toBeNaN();
    expect(s.min).toBeNaN();
    expect(s.max).toBeNaN();
  });

  it('handles a single sample', () => {
    expect(computeStats([42], 0)).toEqual({ p50: 42, p95: 42, min: 42, max: 42, count: 1, failures: 0 });
  });

  it('handles all-equal samples', () => {
    expect(computeStats([7, 7, 7, 7], 0)).toEqual({ p50: 7, p95: 7, min: 7, max: 7, count: 4, failures: 0 });
  });

  it('sorts reverse-sorted input and does not mutate it', () => {
    const input = [5, 4, 3, 2, 1];
    const s = computeStats(input, 0);
    expect(s).toEqual({ p50: 3, p95: 5, min: 1, max: 5, count: 5, failures: 0 });
    expect(input).toEqual([5, 4, 3, 2, 1]);
  });

  it('counts only successes and reports failures separately', () => {
    const s = computeStats([10, 20, 30], 4);
    expect(s.count).toBe(3);
    expect(s.failures).toBe(4);
    expect(s.max).toBe(30);
  });
});
