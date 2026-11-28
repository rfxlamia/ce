// Feature: report-html-evidence-page, Property 3
// Hostile text is always escaped.
// **Validates: Requirements 15.1, 15.3**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runRecordArb } from '../arbitraries.js';
import type { RunRecord } from '../schema.js';
import { render } from './render.js';

const MARK = 'ZZINJ';

const PAYLOADS = [
  `<script>${MARK}(1)</script>`,
  `"><img ${MARK} src=x onerror=${MARK}(1)>`,
  `' onmouseover=${MARK}(1) x='`,
  `" onmouseover=${MARK}(1) x="`,
  `</script><script>${MARK}</script>`,
  `<!-- ${MARK} -->`,
  `javascript:${MARK}(1)`,
  `</pre><svg ${MARK} onload=${MARK}(1)>`,
  `</style><style>${MARK}{}</style>`,
];

/** Keys whose values are closed enums the renderer reads as data, not Untrusted_Text. */
const STRUCTURAL_KEYS = new Set(['outcome', 'schemaVersion']);

/** Append a payload to every Untrusted_Text string leaf. */
function infect(value: unknown, payload: string, key = ''): unknown {
  if (typeof value === 'string') return STRUCTURAL_KEYS.has(key) ? value : value + payload;
  if (Array.isArray(value)) return value.map((v) => infect(v, payload, key));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, infect(v, payload, k)]),
    );
  }
  return value;
}

/** Remove the one inline script, the one inline style, and the escaped raw JSON block. */
function stripTrusted(html: string): string {
  return html
    .replace(/<script>[\s\S]*?<\/script>/, '')
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/(<pre id="rawjson">)[\s\S]*?(<\/pre>)/, '$1$2');
}

const caseArb = fc.tuple(runRecordArb, fc.constantFrom(...PAYLOADS)).map(
  ([rec, p]) => infect(rec, p) as RunRecord,
);

describe('Feature: report-html-evidence-page, Property 3', () => {
  it('no injected tag, attribute or comment becomes live markup', () => {
    fc.assert(
      fc.property(caseArb, (record) => {
        const html = render(record);
        const rest = stripTrusted(html);
        // Tags with their quoted attribute values blanked: the marker may sit inside a value, never outside one.
        const tagsOnly = rest.replace(/"[^"]*"/g, '""');

        // Exactly one script element and one style element survive in the whole document.
        expect((html.match(/<script\b/gi) ?? []).length).toBe(1);
        expect((html.match(/<style\b/gi) ?? []).length).toBe(1);
        expect(html.match(/<\/script/gi)?.length).toBe(1);

        // The injected marker never appears right after a tag opener or inside a raw tag.
        expect(tagsOnly).not.toMatch(new RegExp(`<[^>]*${MARK}`));
        expect(tagsOnly).not.toMatch(new RegExp(`<\\/?(script|style|svg|img)[^>]*${MARK}`, 'i'));
        // Attribute-breaking quotes never close an attribute and start a new one.
        expect(rest).not.toMatch(new RegExp(`["']\\s+on\\w+=\\s*${MARK}`, 'i'));
        // Inside real tags (attribute values blanked) no injected handler attribute exists.
        for (const tag of tagsOnly.match(/<[^>]*>/g) ?? []) expect(tag).not.toMatch(/\bon\w+\s*=|ZZINJ/i);
        // No injected comment opener.
        expect(rest).not.toContain(`<!-- ${MARK}`);
        // No live javascript: URL in a href or src.
        expect(rest).not.toMatch(/(?:href|src)\s*=\s*["']?\s*javascript:/i);

        // Raw JSON block contains no raw `<` at all.
        const raw = /<pre id="rawjson">([\s\S]*?)<\/pre>/.exec(html);
        expect(raw).not.toBeNull();
        expect(raw![1]).not.toContain('<');
      }),
      { numRuns: 100 },
    );
  });
});
