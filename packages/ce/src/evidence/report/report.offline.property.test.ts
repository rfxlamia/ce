// Feature: report-html-evidence-page, Property 2: No network URL ever appears
// **Validates: Requirements 1.2, 1.4, 15.2**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runRecordArb } from '../arbitraries.js';
import type { RunRecord } from '../schema.js';
import { LOGO_DATA_URI } from './logo.js';
import { render } from './render.js';

// ---- hostile generators (local helpers) ----

const HOSTILE_BASES = [
  'https://evil.example/x',
  'http://evil/x.png',
  '//evil/x.png',
  'javascript:alert(1)',
  ' \tjava\nscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  '"><img src=https://evil/x>',
  "' onerror='fetch(\"//evil\")",
  '" srcset="https://evil/a.png 1x',
  'url(https://evil/x)',
  "@import 'https://evil/x.css';",
  '</style><link rel=stylesheet href=https://evil/x.css>',
  '</script><script src=//evil/x.js></script>',
  '<a href="https://evil">x</a>',
  '<form action="https://evil"></form>',
  '&quot; src=&quot;https://evil',
];

const hostileText: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...HOSTILE_BASES),
  fc
    .tuple(fc.constantFrom(...HOSTILE_BASES), fc.string({ maxLength: 8 }), fc.string({ maxLength: 8 }))
    .map(([b, pre, post]) => pre + b + post),
);

const BUNDLE_PATH = /^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$))[^\n]+$/;
const hostilePath: fc.Arbitrary<string> = fc
  .oneof(
    hostileText,
    fc.constantFrom('https://evil/x.png', 'javascript:alert(1)', 'a/https://evil/b.png', 'x.png"onerror="//evil'),
  )
  .filter((s) => BUNDLE_PATH.test(s));

const TEXT_KEYS = new Set([
  'title', 'text', 'url', 'description', 'ref', 'location', 'detail', 'name', 'subject',
  'base', 'head', 'key', 'file', 'error', 'model', 'oldPath', 'kind', 'ceVersion', 'causeName',
]);
const PATH_KEYS = new Set(['path', 'screenshot']);
const LABEL_MAPS = new Set(['probabilities']);

function hostilize(value: unknown, key: string, pool: string[], paths: string[], counter: { n: number }): unknown {
  if (typeof value === 'string') {
    // `kind` is an enum in several places; only rewrite the free-text one (action.kind) via TEXT_KEYS guard below.
    if (PATH_KEYS.has(key)) return paths[counter.n++ % paths.length];
    if (TEXT_KEYS.has(key) && key !== 'kind') return pool[counter.n++ % pool.length];
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => hostilize(v, key, pool, paths, counter));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const outKey = LABEL_MAPS.has(key) ? pool[counter.n++ % pool.length] : k;
      out[outKey] = hostilize(v, k, pool, paths, counter);
    }
    return out;
  }
  return value;
}

const hostileRecordArb: fc.Arbitrary<RunRecord> = fc
  .tuple(
    runRecordArb,
    fc.array(hostileText, { minLength: 1, maxLength: 12 }),
    fc.array(hostilePath, { minLength: 1, maxLength: 6 }),
  )
  .map(([record, pool, paths]) => hostilize(record, '', pool, paths, { n: 0 }) as RunRecord);

// ---- local HTML inspection ----

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

interface Tag {
  name: string;
  attrs: [string, string][];
}

function stripBlocks(html: string, tag: string): { html: string; blocks: string[] } {
  const blocks: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const rest = html.replace(re, (_m, body: string) => {
    blocks.push(body);
    return `<${tag}></${tag}>`;
  });
  return { html: rest, blocks };
}

function tagsOf(html: string): Tag[] {
  const tags: Tag[] = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>"']+(?:="[^"]*")?)*)\s*\/?>/g)) {
    const attrs: [string, string][] = [];
    for (const a of (m[2] ?? '').matchAll(/\s+([^\s=>"']+)(?:="([^"]*)")?/g)) {
      attrs.push([(a[1] ?? '').toLowerCase(), decodeEntities(a[2] ?? '')]);
    }
    tags.push({ name: (m[1] ?? '').toLowerCase(), attrs });
  }
  return tags;
}

const URL_ATTRS = new Set([
  'src', 'href', 'srcset', 'action', 'formaction', 'poster', 'data', 'background', 'cite', 'ping', 'xlink:href',
]);
const NETWORK = /^[\s\u0000-\u0020]*(?:https?:|\/\/|\\\\|javascript:|vbscript:)/i;

describe('Feature: report-html-evidence-page, Property 2: No network URL ever appears', () => {
  it('has no network URL in any URL position, no <link>, one data: URI, and the exact CSP img-src', () => {
    fc.assert(
      fc.property(hostileRecordArb, (record) => {
        const html = render(record);

        const noScript = stripBlocks(html, 'script');
        const noStyle = stripBlocks(noScript.html, 'style');

        // Only the one stylesheet and the one copy script exist, and neither holds a network URL.
        expect(noStyle.blocks).toHaveLength(1);
        expect(noScript.blocks).toHaveLength(1);
        const style = noStyle.blocks[0] ?? '';
        expect(style).not.toMatch(/@import/i);
        expect(style).not.toMatch(/url\(/i);
        expect(style).not.toMatch(/https?:|\/\/(?!\*)/i);
        expect(noScript.blocks[0] ?? '').not.toMatch(/https?:|fetch\(|XMLHttpRequest|import\(/);

        const tags = tagsOf(noStyle.html);
        expect(tags.some((t) => t.name === 'link')).toBe(false);
        expect(tags.filter((t) => t.name === 'script' && t.attrs.length > 0)).toHaveLength(0);
        for (const t of tags) {
          for (const [name, value] of t.attrs) {
            if (URL_ATTRS.has(name)) {
              expect(value, `${t.name}[${name}]`).not.toMatch(NETWORK);
              if (name === 'srcset') expect(value).toBe('');
            }
            if (name === 'style') {
              expect(value).not.toMatch(/url\(|@import/i);
            }
            if (name === 'http-equiv') continue;
          }
        }

        // Exactly one data: URI in any attribute: the Logo_Image src.
        const dataAttrs = tags.flatMap((t) =>
          t.attrs.filter(([n, v]) => URL_ATTRS.has(n) && /^\s*data:/i.test(v)).map(([n, v]) => ({ tag: t.name, name: n, value: v })),
        );
        expect(dataAttrs).toHaveLength(1);
        expect(dataAttrs[0]).toEqual({ tag: 'img', name: 'src', value: LOGO_DATA_URI });
        expect(tags.filter((t) => t.name === 'img' && t.attrs.some(([n, v]) => n === 'src' && v === LOGO_DATA_URI))).toHaveLength(1);

        // CSP img-src is exactly 'self' and data:.
        const csp = tags
          .filter((t) => t.name === 'meta' && t.attrs.some(([n, v]) => n === 'http-equiv' && v === 'Content-Security-Policy'))
          .map((t) => t.attrs.find(([n]) => n === 'content')?.[1] ?? '');
        expect(csp).toHaveLength(1);
        const directives = Object.fromEntries(
          (csp[0] ?? '').split(';').map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map(([k, ...v]) => [k, v]),
        );
        expect(directives['img-src']).toEqual(["'self'", 'data:']);
        expect(JSON.stringify(directives)).not.toMatch(/https?:|\*/);
      }),
      { numRuns: 100 },
    );
  });
});
