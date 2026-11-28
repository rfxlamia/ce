// Feature: report-html-evidence-page, Property 5: Rendering is deterministic
// **Validates: Requirements 16.1, 17.9**
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  errorRunRecordArb,
  evidencedRunRecordArb,
  runRecordArb,
  skippedRunRecordArb,
  unsupportedRunRecordArb,
} from '../arbitraries.js';
import type { RunRecord } from '../schema.js';
import { LOGO_DATA_URI } from './logo.js';
import { render } from './render.js';

const RUNS = { numRuns: 100 };

function dataUris(html: string): string[] {
  return html.match(/data:[a-z/+-]+;base64,[A-Za-z0-9+/=]+/g) ?? [];
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Feature: report-html-evidence-page, Property 5: rendering is deterministic', () => {
  it('render twice and on a structuredClone gives byte-identical text', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        const first = render(record);
        expect(render(record)).toBe(first);
        expect(render(structuredClone(record))).toBe(first);
      }),
      RUNS,
    );
  });

  it('does not depend on the clock or on randomness', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        const baseline = render(record);

        vi.useFakeTimers();
        vi.setSystemTime(new Date('2001-02-03T04:05:06.000Z'));
        const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
          throw new Error('Math.random must not be called by render');
        });
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
          throw new Error('Date.now must not be called by render');
        });
        let early: string;
        try {
          early = render(record);
          vi.setSystemTime(new Date('2090-12-31T23:59:59.000Z'));
          const late = render(record);
          expect(late).toBe(early);
          expect(randomSpy).not.toHaveBeenCalled();
          expect(nowSpy).not.toHaveBeenCalled();
        } finally {
          randomSpy.mockRestore();
          nowSpy.mockRestore();
          vi.useRealTimers();
        }
        expect(early).toBe(baseline);
      }),
      RUNS,
    );
  });

  it('carries the same logo bytes for every Outcome', () => {
    const arbs: fc.Arbitrary<RunRecord>[] = [
      skippedRunRecordArb,
      evidencedRunRecordArb,
      unsupportedRunRecordArb,
      errorRunRecordArb,
    ];
    fc.assert(
      fc.property(fc.tuple(...(arbs as [fc.Arbitrary<RunRecord>, ...fc.Arbitrary<RunRecord>[]])), (records) => {
        expect(new Set(records.map((r) => r.outcome)).size).toBe(4);
        for (const record of records) {
          const html = render(record);
          const logos = dataUris(html).filter((u) => u.startsWith('data:image/webp'));
          expect(logos).toEqual([LOGO_DATA_URI]);
        }
      }),
      RUNS,
    );
  });
});
