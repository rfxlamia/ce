// Feature: report-html-evidence-page, Property 4
// The Raw_Section round-trips the record.
// **Validates: Requirements 9.1, 9.3, 9.4**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runRecordArb } from '../../arbitraries.js';
import type { RunRecord } from '../../schema.js';
import { decodeEscapedRawSection } from '../escape.testing.js';
import { renderRaw } from './raw.js';

const HOSTILE = [
  '</script><script>alert(1)</script>',
  '<!-- comment -->',
  '</pre><img src=x onerror=alert(1)>',
  '&lt;b&gt; &amp;amp; &#39; &quot;',
  '<\\/script> <\\/ </',
  "'\"<>&\u2028\u2029",
  '-->',
];

/** Append a hostile string to every string leaf of the record. */
function infect(value: unknown, hostile: string): unknown {
  if (typeof value === 'string') return value + hostile;
  if (Array.isArray(value)) return value.map((v) => infect(v, hostile));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, infect(v, hostile)]),
    );
  }
  return value;
}

const caseArb = fc
  .tuple(runRecordArb, fc.constantFrom(...HOSTILE), fc.boolean())
  .map(([rec, h, hostile]) => (hostile ? (infect(rec, h) as RunRecord) : rec));

function preText(html: string): string {
  const open = '<pre id="rawjson">';
  const start = html.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = html.indexOf('</pre>', start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start + open.length, end);
}

describe('Feature: report-html-evidence-page, Property 4', () => {
  it('decoding the rawjson text yields JSON equal to JSON.stringify(record, null, 2)', () => {
    fc.assert(
      fc.property(caseArb, (record) => {
        const html = renderRaw(record);
        const text = preText(html);
        expect(decodeEscapedRawSection(text)).toBe(JSON.stringify(record, null, 2));
        expect(JSON.parse(decodeEscapedRawSection(text))).toEqual(JSON.parse(JSON.stringify(record)));
      }),
      { numRuns: 100 },
    );
  });

  it('never emits </script or <!-- raw inside the section', () => {
    fc.assert(
      fc.property(caseArb, (record) => {
        const html = renderRaw(record).toLowerCase();
        expect(html).not.toContain('</script');
        expect(html).not.toContain('<!--');
      }),
      { numRuns: 100 },
    );
  });
});
