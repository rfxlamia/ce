// Feature: report-html-evidence-page, Property 11
// Classifier values are always labelled "signal" and forbidden words never leak.
// **Validates: Requirements 11.1, 11.2, 11.3, 11.4**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runRecordArb } from '../arbitraries.js';
import { render } from './render.js';

const FORBIDDEN = /verdict|correct|incorrect|\bpass|\bfail|proves|verified/i;

/** True when no string anywhere in the record contains a forbidden word (record text is exempt by Requirement 11). */
function hasNoForbiddenText(value: unknown): boolean {
  if (typeof value === 'string') return !FORBIDDEN.test(value);
  if (Array.isArray(value)) return value.every(hasNoForbiddenText);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(hasNoForbiddenText);
  }
  return true;
}

/** Remove script, style, escaped raw JSON, the one explanatory note, and Check status cells. */
function visible(html: string): string {
  return html
    .replace(/<script>[\s\S]*?<\/script>/, '')
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<pre id="rawjson">[\s\S]*?<\/pre>/, '')
    .replace(/<p class="note"[\s\S]*?<\/p>/, '')
    .replace(/<p class="final-error">[\s\S]*?<\/p>/g, '')
    .replace(/<[^>]*>/g, ' ')
    // Fixed ERROR-banner label about the CE stage, not a classifier value.
    .replace(/Failed stage/g, '')
    .replace(/Failing fields/g, '');
}

describe('Feature: report-html-evidence-page, Property 11', () => {
  it('every meter is labelled signal, one note exists, forbidden words never appear outside it', () => {
    fc.assert(
      fc.property(runRecordArb.filter(hasNoForbiddenText), (record) => {
        const html = render(record);

        for (const m of html.matchAll(/<div class="track" role="meter" aria-label="([^"]*)"/g)) {
          expect(m[1]).toMatch(/signal/i);
        }
        // Each bar's visible label or the section heading carries the word signal.
        const hasBars = /role="meter"/.test(html);
        if (hasBars) expect(html.match(/signal/gi)!.length).toBeGreaterThan(1);

        expect(html.match(/<p class="note"/g)?.length).toBe(1);
        const note = /<p class="note"[\s\S]*?<\/p>/.exec(html)![0];
        expect(note).toMatch(/signal/);
        expect(note).toMatch(/verdict/);

        const text = visible(html);
        expect(text).not.toMatch(FORBIDDEN);
      }),
      { numRuns: 200 },
    );
  });
});
