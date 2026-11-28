/**
 * Document shell of report.html, asserted on render output
 * (Requirements 1, 2, 10, 17). No browser or DOM library.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  errorRunRecordArb,
  evidencedRunRecordArb,
  skippedRunRecordArb,
  unsupportedRunRecordArb,
} from '../arbitraries.js';
import type { RunRecord } from '../schema.js';
import { CSP } from './document.js';
import { LOGO_ALT, LOGO_DATA_URI, LOGO_HEIGHT, LOGO_WIDTH } from './logo.js';
import { render } from './render.js';

const ARBS: Record<RunRecord['outcome'], fc.Arbitrary<RunRecord>> = {
  SKIPPED: skippedRunRecordArb,
  EVIDENCED: evidencedRunRecordArb,
  UNSUPPORTED: unsupportedRunRecordArb,
  ERROR: errorRunRecordArb,
};

const records: RunRecord[] = Object.values(ARBS).flatMap((arb) => fc.sample(arb, { numRuns: 10, seed: 13 }));
const docs = records.map((record) => ({ record, html: render(record) }));

const EXPECTED_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:";

function count(html: string, re: RegExp): number {
  return [...html.matchAll(re)].length;
}

describe('report document shell', () => {
  it('has documents for all four outcomes', () => {
    expect(new Set(records.map((r) => r.outcome)).size).toBe(4);
  });

  it('declares lang="en" and UTF-8 (17.3)', () => {
    for (const { html } of docs) {
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<meta charset="utf-8">');
    }
  });

  it('carries the exact CSP meta once (17.4)', () => {
    expect(CSP).toBe(EXPECTED_CSP);
    for (const { html } of docs) {
      expect(count(html, /http-equiv="Content-Security-Policy"/g)).toBe(1);
      expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${EXPECTED_CSP}">`);
    }
  });

  it('has a <title> with the Outcome and start time (17.5)', () => {
    for (const { record, html } of docs) {
      expect(count(html, /<title>/g)).toBe(1);
      const m = /<title>([\s\S]*?)<\/title>/.exec(html);
      expect(m).not.toBeNull();
      expect(m![1]).toContain(record.outcome);
      expect(m![1]).toContain(record.timings.startedAt);
    }
  });

  it('has exactly one Logo_Image in the header with fixed alt, width, height and data URI (1.4, 1.7)', () => {
    const logos = new Set<string>();
    for (const { html } of docs) {
      expect(count(html, /<img\b[^>]*alt="Continuous Evidence/g)).toBeLessThanOrEqual(1);
      const header = /<header\b[\s\S]*?<\/header>/.exec(html);
      expect(header).not.toBeNull();
      const imgs = [...header![0].matchAll(/<img\b[^>]*>/g)];
      expect(imgs).toHaveLength(1);
      const tag = imgs[0]![0];
      expect(tag).toContain(`width="${LOGO_WIDTH}"`);
      expect(tag).toContain(`height="${LOGO_HEIGHT}"`);
      expect(tag).toContain(`alt="${LOGO_ALT}"`);
      expect(LOGO_ALT.length).toBeGreaterThan(0);
      const src = /src="(data:[^"]*)"/.exec(tag);
      expect(src?.[1]).toBe(LOGO_DATA_URI);
      logos.add(src![1]!);
      // the only data: URI in the whole document
      expect(count(html, /data:/g)).toBe(count(html, /src="data:image\/webp;base64,/g) + count(html, /img-src 'self' data:/g));
      expect(count(html, new RegExp(LOGO_DATA_URI.slice(0, 40).replace(/[+/]/g, '\\$&'), 'g'))).toBe(1);
    }
    expect(logos.size).toBe(1);
  });

  it('puts the skip link first in the body (2.4, 10.5)', () => {
    for (const { html } of docs) {
      const body = html.slice(html.indexOf('<body>') + '<body>'.length);
      expect(body.trimStart().startsWith('<a class="skip" href="#main">')).toBe(true);
      expect(html).toContain('<main id="main">');
    }
  });

  it('has the seven nav links in section order (2.1)', () => {
    const hrefs = ['banner', 'claims', 'assessment', 'timeline', 'final', 'logs', 'raw'];
    for (const { html } of docs) {
      const nav = /<nav\b[\s\S]*?<\/nav>/.exec(html);
      expect(nav).not.toBeNull();
      const found = [...nav![0].matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
      expect(found).toEqual(hrefs);
    }
  });

  it('has exactly one h1 (10.1)', () => {
    for (const { html } of docs) {
      expect(count(html, /<h1[\s>]/g)).toBe(1);
    }
  });

  it('has exactly one inline script, for Copy JSON only (10, 17)', () => {
    for (const { html } of docs) {
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      expect(scripts).toHaveLength(1);
      expect(scripts[0]![1]).not.toMatch(/\bsrc\s*=/i);
      expect(scripts[0]![2]).toContain("getElementById('copy')");
      expect(scripts[0]![2]).not.toMatch(/fetch|XMLHttpRequest|import\s|WebSocket/);
    }
  });

  it('has no <link> and no external resources (17.9, 16.11)', () => {
    for (const { html } of docs) {
      const markup = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
      expect(html).not.toMatch(/<link\b/i);
      expect(markup).not.toMatch(/\b(?:src|href|action|poster|data)\s*=\s*["']?\s*(?:https?:)?\/\//i);
      // every src is the logo data URI or a relative path (no scheme, no protocol-relative)
      for (const m of markup.matchAll(/\bsrc\s*=\s*"([^"]*)"/gi)) {
        const v = m[1]!;
        expect(v === LOGO_DATA_URI || !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(v)).toBe(true);
      }
      expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
    }
  });
});
