/**
 * Keyboard operability of report.html, asserted statically on render output
 * (Requirements 2.4, 10.5, 10.6, 10.7, 16.4). No browser or DOM library.
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
import { render } from './render.js';

const ARBS: Record<RunRecord['outcome'], fc.Arbitrary<RunRecord>> = {
  SKIPPED: skippedRunRecordArb,
  EVIDENCED: evidencedRunRecordArb,
  UNSUPPORTED: unsupportedRunRecordArb,
  ERROR: errorRunRecordArb,
};

const docs: { outcome: string; html: string }[] = Object.entries(ARBS).flatMap(([outcome, arb]) =>
  fc.sample(arb, { numRuns: 15, seed: 7 }).map((r) => ({ outcome, html: render(r) })),
);

/** Same document with <style>, <script> and comments removed: markup only. */
function markup(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function styleOf(html: string): string {
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  expect(m).not.toBeNull();
  return m![1]!;
}

/** Every start tag as [name, attribute text]. <pre> text is escaped, so no stray tags. */
function startTags(html: string): { name: string; attrs: string }[] {
  const out: { name: string; attrs: string }[] = [];
  for (const m of markup(html).matchAll(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*\/?>/g)) {
    out.push({ name: m[1]!.toLowerCase(), attrs: m[2] ?? '' });
  }
  return out;
}

const NATIVE_INTERACTIVE = new Set(['a', 'button', 'summary']);
const FOREIGN_INTERACTIVE = ['input', 'select', 'textarea', 'iframe', 'object', 'embed', 'audio', 'video'];

describe('report keyboard operability', () => {
  it('has documents for all four outcomes', () => {
    expect(new Set(docs.map((d) => d.outcome)).size).toBe(4);
  });

  it('skip link is the first focusable element and targets main (2.4, 10.5)', () => {
    for (const { html } of docs) {
      const first = startTags(html).find(
        (t) => NATIVE_INTERACTIVE.has(t.name) || /\btabindex\s*=/i.test(t.attrs) || FOREIGN_INTERACTIVE.includes(t.name),
      );
      expect(first?.name).toBe('a');
      expect(first?.attrs).toMatch(/class="skip"/);
      expect(first?.attrs).toMatch(/href="#main"/);
      expect(html).toContain('<main id="main">');
    }
  });

  it('uses no tabindex above 0 and none that removes an element from tab order (10.6)', () => {
    for (const { html } of docs) {
      for (const m of markup(html).matchAll(/\btabindex\s*=\s*"?(-?\d+)/gi)) {
        expect(Number(m[1])).toBeLessThanOrEqual(0);
        expect(Number(m[1])).not.toBeLessThan(0);
      }
    }
  });

  it('every interactive element is a native a, button or summary (10.6)', () => {
    for (const { html } of docs) {
      const tags = startTags(html);
      for (const t of tags) {
        expect(FOREIGN_INTERACTIVE).not.toContain(t.name);
        expect(t.attrs).not.toMatch(/\bon[a-z]+\s*=/i);
        expect(t.attrs).not.toMatch(/\brole\s*=\s*"?(button|link|tab|menuitem|checkbox|switch)/i);
        expect(t.attrs).not.toMatch(/contenteditable/i);
        if (t.name === 'a') expect(t.attrs).toMatch(/\bhref\s*=/i);
        if (t.name === 'button') expect(t.attrs).not.toMatch(/\bdisabled\b/i);
      }
      // every summary sits inside a details
      const opens = tags.filter((t) => t.name === 'details').length;
      const summaries = tags.filter((t) => t.name === 'summary').length;
      expect(summaries).toBeLessThanOrEqual(opens);
    }
  });

  it('screenshot links are native anchors with href and an accessible name (10.6)', () => {
    const evidenced = docs.filter((d) => /class="shot"/.test(d.html));
    expect(evidenced.length).toBeGreaterThan(0);
    for (const { html } of evidenced) {
      const shots = startTags(html).filter((t) => t.name === 'a' && /class="shot"/.test(t.attrs));
      for (const s of shots) {
        expect(s.attrs).toMatch(/href="[^"]+"/);
        expect(s.attrs).toMatch(/aria-label="[^"]+"/);
        expect(s.attrs).not.toMatch(/tabindex/i);
      }
    }
  });

  it('Copy JSON is a reachable native button with the script wired to it (10.6)', () => {
    for (const { html } of docs) {
      const buttons = startTags(html).filter((t) => t.name === 'button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.attrs).toMatch(/type="button"/);
      expect(buttons[0]!.attrs).toMatch(/id="copy"/);
      expect(buttons[0]!.attrs).not.toMatch(/tabindex|disabled|hidden/i);
      expect(html).toContain('Copy JSON</button>');
      expect(html).toContain("getElementById('copy')");
    }
  });

  it('details summaries are native, unhidden and not removed from tab order (10.6)', () => {
    for (const { html } of docs) {
      const m = markup(html);
      expect(m.match(/<summary[^>]*>/g)?.length ?? 0).toBeGreaterThan(0);
      for (const s of m.match(/<summary[^>]*>/g) ?? []) {
        expect(s).not.toMatch(/tabindex|hidden|aria-hidden/i);
      }
      // summary is the first child of its details
      expect(m).not.toMatch(/<details[^>]*>(?!<summary)/);
    }
  });

  it('landmarks exist and h1 appears once with no skipped level (10.7, 16.4)', () => {
    for (const { html } of docs) {
      const m = markup(html);
      for (const tag of ['header', 'nav', 'main']) expect(m).toMatch(new RegExp(`<${tag}[\\s>]`));
      const levels = [...m.matchAll(/<h([1-6])[\s>]/g)].map((x) => Number(x[1]));
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      let max = 0;
      for (const l of levels) {
        expect(l).toBeLessThanOrEqual(max + 1);
        max = Math.max(max, l);
      }
    }
  });

  it('CSS gives focus a visible outline of at least 2px and never removes it (10.5)', () => {
    const css = styleOf(docs[0]!.html);
    for (const sel of ['a', 'summary', 'button']) {
      const rule = new RegExp(`${sel}:focus-visible[^{]*\\{([^}]*)\\}`).exec(css);
      expect(rule, `${sel}:focus-visible rule`).not.toBeNull();
      const w = /outline:\s*(\d+(?:\.\d+)?)px\s+solid/.exec(rule![1]!);
      expect(w, `${sel} outline width`).not.toBeNull();
      expect(Number(w![1])).toBeGreaterThanOrEqual(2);
    }
    expect(css).not.toMatch(/outline\s*:\s*(none|0)\b/);
    expect(css).not.toMatch(/outline-width\s*:\s*[01](px)?\s*[;}]/);
    // the skip link becomes visible on focus
    expect(css).toMatch(/\.skip:focus\{left:0\}/);
  });

  it('honours prefers-reduced-motion (10.5)', () => {
    const css = styleOf(docs[0]!.html);
    const m = /@media \(prefers-reduced-motion:\s*reduce\)\{([\s\S]*)\}/.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/animation:none/);
    expect(m![1]).toMatch(/transition:none/);
    expect(m![1]).toMatch(/scroll-behavior:auto/);
  });
});
