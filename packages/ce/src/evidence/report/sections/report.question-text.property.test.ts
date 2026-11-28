// Feature: report-html-evidence-page, Property 6: question text is always resolved or safely defaulted
// **Validates: Requirements 5.3, 5.4, 7.8**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runRecordArb } from '../../arbitraries.js';
import { escapeHtml } from '../escape.js';
import { renderAssessment } from './assessment.js';
import { renderFinal } from './final.js';

const UNAVAILABLE = 'question text unavailable for this version';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Returns text for roughly half of all idVersions (decided by seed), undefined for the rest. */
function makeLookup(seed: number) {
  const text = (id: string): string | undefined =>
    (hash(id) + seed) % 2 === 0 ? `Catalog <text> & "${id}" #${seed}` : undefined;
  return text;
}

describe('Feature: report-html-evidence-page, Property 6: question text resolved or safely defaulted', () => {
  it('renderAssessment shows catalog text when found, idVersion + fallback otherwise, never throws', () => {
    fc.assert(
      fc.property(runRecordArb, fc.nat(), (record, seed) => {
        const lookup = makeLookup(seed);
        const html = renderAssessment(record, lookup);
        for (const q of record.assessment?.questions ?? []) {
          const text = lookup(q.idVersion);
          if (text !== undefined) {
            expect(html).toContain(escapeHtml(text));
          } else {
            expect(html).toContain(escapeHtml(q.idVersion));
            expect(html).toContain(UNAVAILABLE);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('renderFinal shows catalog text when found, idVersion + fallback otherwise, never throws', () => {
    fc.assert(
      fc.property(runRecordArb, fc.nat(), (record, seed) => {
        const lookup = makeLookup(seed);
        const html = renderFinal(record, lookup);
        const signals = record.finalImage?.signals;
        const checks: [string, number | null | undefined][] = [
          ['runtime.state_reached@1', signals?.stateReached],
          ['runtime.state_reached_dom@1', signals?.stateReachedDom],
        ];
        for (const [id, value] of checks) {
          if (value === null || value === undefined) continue;
          const text = lookup(id);
          if (text !== undefined) {
            expect(html).toContain(escapeHtml(text));
          } else {
            expect(html).toContain(escapeHtml(id));
            expect(html).toContain(UNAVAILABLE);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('never throws when the lookup finds nothing at all', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        const none = (): undefined => undefined;
        expect(() => renderAssessment(record, none)).not.toThrow();
        expect(() => renderFinal(record, none)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
