/**
 * Feature: report-html-evidence-page, Property 1: The document never omits a required section.
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 13.5**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runRecordArb } from '../arbitraries.js';
import { render } from './render.js';

const SECTION_IDS = ['banner', 'claims', 'assessment', 'timeline', 'final', 'logs', 'raw'] as const;

/** Text with the contents of <style>, <script> and <pre> removed so only markup structure remains. */
function structure(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<pre[\s\S]*?<\/pre>/g, '<pre></pre>');
}

function sectionOpenings(html: string): string[] {
  return [...html.matchAll(/<section\b[^>]*\sid="([^"]*)"/g)].map((m) => m[1]!);
}

describe('Feature: report-html-evidence-page, Property 1', () => {
  it('has the seven sections exactly once, in order, each with a level 2 heading', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        const html = structure(render(record));

        expect(sectionOpenings(html)).toEqual([...SECTION_IDS]);

        for (const id of SECTION_IDS) {
          const re = new RegExp(`<section\\b[^>]*\\sid="${id}"[^>]*>\\s*<h2\\b`);
          expect(re.test(html), `section ${id} starts with an h2`).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('has a nav with an in-page link to every section, and every target exists', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        const html = structure(render(record));
        const nav = /<nav\b[\s\S]*?<\/nav>/.exec(html);
        expect(nav).not.toBeNull();
        const hrefs = [...nav![0].matchAll(/<a\b[^>]*\shref="#([^"]*)"/g)].map((m) => m[1]);
        for (const id of SECTION_IDS) {
          expect(hrefs).toContain(id);
          expect(html).toContain(`id="${id}"`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('has exactly one h1 and never skips a heading level', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        const html = structure(render(record));
        const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
        expect(levels.filter((l) => l === 1)).toHaveLength(1);
        expect(levels[0]).toBe(1);
        for (let i = 1; i < levels.length; i++) {
          expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});
