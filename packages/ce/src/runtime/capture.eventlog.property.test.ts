import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registerPageHandlers, waitForSettle, type EventLogEntry } from './capture.js';
import type { PlaywrightPage } from './playwright-types.js';

type Handler = (...args: unknown[]) => void;

/** Minimal fake page: stores listeners so tests can emit events. */
function fakePage(): { page: PlaywrightPage; emit: (event: string, arg?: unknown) => void } {
  const handlers = new Map<string, Set<Handler>>();
  const page = {
    on(event: string, listener: Handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(listener);
    },
    off(event: string, listener: Handler) {
      handlers.get(event)?.delete(listener);
    },
    url: () => 'http://localhost/',
  } as unknown as PlaywrightPage;
  return {
    page,
    emit: (event, arg) => {
      for (const h of [...(handlers.get(event) ?? [])]) h(arg);
    },
  };
}

// Feature: observe-decide-execute-loop, Property 15: Event_Log entries carry the step number of their occurrence
describe('Property 15: Event_Log entries carry the step number of their occurrence', () => {
  /**
   * **Validates: Requirements 7.4**
   */
  it('dialog, download and popup entries carry the current step', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            step: fc.integer({ min: 0, max: 1000 }),
            kind: fc.constantFrom('dialog', 'download', 'popup'),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (events) => {
          const { page, emit } = fakePage();
          const log: EventLogEntry[] = [];
          let current = 0;
          const dispose = registerPageHandlers({
            page,
            onEvent: (e) => log.push(e),
            redact: (t) => t,
            getStep: () => current,
          });
          for (const { step, kind } of events) {
            current = step;
            const before = log.length;
            if (kind === 'dialog') {
              emit('dialog', { message: () => 'hi', dismiss: async () => undefined });
            } else if (kind === 'download') {
              emit('download', { suggestedFilename: () => 'f.txt', cancel: async () => undefined });
            } else {
              emit('popup', { url: () => 'http://x/', close: async () => undefined });
            }
            const added = log.slice(before);
            expect(added.length).toBeGreaterThan(0);
            for (const entry of added) expect(entry.step).toBe(step);
            expect(added[0]!.kind).toBe(kind);
          }
          dispose();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   */
  it('a settle-timeout entry carries the step it occurred at', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 1000 }), async (step) => {
        const { page } = fakePage();
        let t = 0;
        const log: EventLogEntry[] = [];
        let n = 0;
        const result = await waitForSettle({
          page,
          // Digest always changes, so the page never settles.
          computeDigest: async () => `d${n++}`,
          settleTimeoutMs: 3000,
          now: () => t,
          sleep: async (ms) => {
            t += ms;
          },
          onEvent: (e) => log.push(e),
          step,
        });
        expect(result.settled).toBe(false);
        expect(log).toHaveLength(1);
        expect(log[0]!.kind).toBe('settle');
        expect(log[0]!.step).toBe(step);
      }),
      { numRuns: 100 },
    );
  });
});
