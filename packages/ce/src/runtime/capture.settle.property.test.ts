import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SETTLE_DIGEST_GAP_MS,
  SETTLE_QUIET_MS,
  waitForSettle,
  type EventLogEntry,
} from './capture.js';
import { SETTLE_TIMEOUT_MS } from './constants.js';
import type { PlaywrightPage, PlaywrightRequestLike } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 17: Settle wait is bounded and correctly reports timeout

interface Timeline {
  /** In-flight intervals of requests, in virtual ms after the call starts. */
  requests: { start: number; end: number }[];
  /** Times at which the DOM digest changes. */
  digestChanges: number[];
  timeoutMs: number;
}

interface Harness {
  result: Promise<{ settled: boolean }>;
  events: EventLogEntry[];
  elapsed: () => number;
}

function run(timeline: Timeline): Harness {
  let clock = 0;
  const listeners = new Map<string, Set<(request: PlaywrightRequestLike) => void>>();
  const page = {
    on(event: string, listener: (request: PlaywrightRequestLike) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: string, listener: (request: PlaywrightRequestLike) => void) {
      listeners.get(event)?.delete(listener);
    },
  } as unknown as PlaywrightPage;

  // Virtual-time events that fire while sleeping.
  const pending = timeline.requests
    .flatMap((r) => {
      const request = { url: () => 'x', isNavigationRequest: () => false } as PlaywrightRequestLike;
      return [
        { at: r.start, order: 0, type: 'request', request },
        { at: r.end, order: 1, type: 'requestfinished', request },
      ];
    })
    .sort((a, b) => a.at - b.at || a.order - b.order);

  const fireUpTo = (target: number): void => {
    while (pending.length > 0 && pending[0]!.at <= target) {
      const event = pending.shift()!;
      clock = Math.max(clock, event.at);
      for (const listener of listeners.get(event.type) ?? []) listener(event.request);
    }
  };

  const events: EventLogEntry[] = [];
  const result = waitForSettle({
    page,
    computeDigest: async () => String(timeline.digestChanges.filter((t) => t <= clock).length),
    settleTimeoutMs: timeline.timeoutMs,
    now: () => clock,
    sleep: async (ms) => {
      const target = clock + ms;
      fireUpTo(target);
      clock = target;
    },
    onEvent: (entry) => events.push(entry),
    step: 4,
  });
  return { result, events, elapsed: () => clock };
}

const timelineArb: fc.Arbitrary<Timeline> = fc.record({
  requests: fc.array(
    fc
      .tuple(fc.integer({ min: 1, max: 3500 }), fc.integer({ min: 0, max: 1500 }))
      .map(([start, length]) => ({ start, end: start + length })),
    { maxLength: 6 },
  ),
  digestChanges: fc.array(fc.integer({ min: 1, max: 3500 }), { maxLength: 6 }),
  timeoutMs: fc.oneof(fc.constant(SETTLE_TIMEOUT_MS), fc.integer({ min: 1, max: 5000 })),
});

describe('Property 17: settle wait is bounded and correctly reports timeout', () => {
  it('never runs past the timeout, and reports timeout or quiet accurately', async () => {
    await fc.assert(
      fc.asyncProperty(timelineArb, async (timeline) => {
        const h = run(timeline);
        const { settled } = await h.result;
        const end = h.elapsed();

        // Bounded: never later than the Settle_Timeout.
        expect(end).toBeLessThanOrEqual(timeline.timeoutMs);

        if (settled) {
          expect(h.events).toEqual([]);
          // Quiet for the last 500 ms: no request in flight.
          const windowStart = end - SETTLE_QUIET_MS;
          for (const r of timeline.requests) {
            const overlaps = r.start <= end && r.end > windowStart;
            expect(overlaps).toBe(false);
          }
          // Digest unchanged across the two reads 100 ms apart.
          const readsAt = end - SETTLE_DIGEST_GAP_MS;
          const changed = timeline.digestChanges.some((t) => t > readsAt && t <= end);
          expect(changed).toBe(false);
        } else {
          // Timeout reported exactly at the Settle_Timeout, with one settle entry.
          expect(end).toBe(timeline.timeoutMs);
          expect(h.events).toHaveLength(1);
          expect(h.events[0]).toMatchObject({ kind: 'settle', step: 4 });
        }
      }),
      { numRuns: 200 },
    );
  });

  it('settles when the page is idle for long enough, and times out when it never is', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5000 }), async (timeoutMs) => {
        const idle = await run({ requests: [], digestChanges: [], timeoutMs }).result;
        const minimum = SETTLE_QUIET_MS + SETTLE_DIGEST_GAP_MS;
        if (timeoutMs >= minimum) expect(idle.settled).toBe(true);

        // A request that never finishes within the budget can never settle.
        const busy = await run({
          requests: [{ start: 1, end: timeoutMs + 1000 }],
          digestChanges: [],
          timeoutMs,
        }).result;
        expect(busy.settled).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
