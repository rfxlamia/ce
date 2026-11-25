export interface LatencyStats {
  p50: number;
  p95: number;
  min: number;
  max: number;
  count: number;
  failures: number;
}

/** Nearest-rank percentile over an ascending-sorted, non-empty array. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/**
 * Latency statistics over successful samples only. `failureCount` is reported
 * unchanged and never enters the percentile math (Req 3.5). An empty sample
 * array yields NaN for p50/p95/min/max and count 0, without throwing.
 */
export function computeStats(samples: number[], failureCount: number): LatencyStats {
  if (samples.length === 0) {
    return { p50: NaN, p95: NaN, min: NaN, max: NaN, count: 0, failures: failureCount };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: sorted.length,
    failures: failureCount,
  };
}
