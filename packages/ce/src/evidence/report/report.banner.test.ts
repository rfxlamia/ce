import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  errorRunRecordArb,
  evidencedRunRecordArb,
  skippedRunRecordArb,
  unsupportedRunRecordArb,
} from '../arbitraries.js';
import type { RunRecord } from '../schema.js';
import { PALETTE } from './palette.js';
import { BANNER_CSS, renderBanner } from './sections/banner.js';

type Outcome = RunRecord['outcome'];

const ARBS: Record<Outcome, fc.Arbitrary<RunRecord>> = {
  SKIPPED: skippedRunRecordArb,
  EVIDENCED: evidencedRunRecordArb,
  UNSUPPORTED: unsupportedRunRecordArb,
  ERROR: errorRunRecordArb,
};
const OUTCOMES = Object.keys(ARBS) as Outcome[];

function sample(outcome: Outcome, n = 25): RunRecord[] {
  return fc.sample(ARBS[outcome], { numRuns: n, seed: 14 });
}

function iconOf(html: string): string {
  const m = /<svg[^>]*>.*?<\/svg>/s.exec(html);
  expect(m).not.toBeNull();
  return m![0];
}

describe.each(OUTCOMES)('renderBanner %s', (outcome) => {
  const records = sample(outcome);

  it('carries the outcome on data-outcome (3.10)', () => {
    for (const r of records) {
      const html = renderBanner(r);
      expect(html).toMatch(new RegExp(`<section[^>]* data-outcome="${outcome}"`));
      expect(html).toContain(`<span class="outcome">${outcome}</span>`);
      expect(Object.keys(PALETTE.outcomeTones)).toContain(outcome);
      expect(BANNER_CSS).toContain(`.banner[data-outcome="${outcome}"]`);
    }
  });

  it('has one aria-hidden inline SVG icon, no glyph or emoji (3.12)', () => {
    for (const r of records) {
      const html = renderBanner(r);
      expect(html.match(/<svg/g)).toHaveLength(1);
      expect(iconOf(html)).toContain('aria-hidden="true"');
      expect(html.match(/<svg[^>]*stroke="currentColor"/)).not.toBeNull();
      expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('has no eyebrow, kicker or label above the outcome word (3.13)', () => {
    for (const r of records) {
      const html = renderBanner(r);
      expect(html).not.toMatch(/eyebrow|kicker/i);
      const head = html.indexOf('<div class="head">');
      const before = html.slice(0, head);
      // only the section tag and the hidden h2 may precede the head
      const stripped = before
        .replace(/<section[^>]*>/, '')
        .replace(/<h2 [^>]*class="sr-only"[^>]*>.*?<\/h2>/s, '');
      expect(stripped).toBe('');
    }
  });

  it('has a visually hidden level 2 heading labelling the section (3.13)', () => {
    for (const r of records) {
      const html = renderBanner(r);
      expect(html.match(/<h2[ >]/g)).toHaveLength(1);
      expect(html).toMatch(/<h2 id="h-banner" class="sr-only">[^<]+<\/h2>/);
      expect(html).toContain('aria-labelledby="h-banner"');
    }
  });

  it('orders word+icon, explanation, reason, lead facts, meta row (3.14)', () => {
    for (const r of records) {
      const html = renderBanner(r);
      const marks = [
        html.indexOf('<svg'),
        html.indexOf('class="outcome"'),
        html.indexOf('class="what"'),
        html.indexOf('class="why"'),
        html.indexOf('class="lead-facts"'),
        html.indexOf('class="meta"'),
      ];
      expect(marks.every((i) => i >= 0)).toBe(true);
      expect([...marks].sort((a, b) => a - b)).toEqual(marks);
    }
  });
});

describe('renderBanner shared properties', () => {
  it('uses a distinct icon shape per outcome (3.12)', () => {
    const icons = OUTCOMES.map((o) => iconOf(renderBanner(sample(o, 1)[0]!)));
    expect(new Set(icons).size).toBe(4);
  });

  it('differs in text and tone between SKIPPED and UNSUPPORTED (3.3)', () => {
    const skipped = renderBanner(sample('SKIPPED', 1)[0]!);
    const unsupported = renderBanner(sample('UNSUPPORTED', 1)[0]!);
    const what = (h: string) => /<p class="what">([^<]*)<\/p>/.exec(h)![1];
    expect(what(skipped)).not.toBe(what(unsupported));
    expect(skipped).toContain('data-outcome="SKIPPED"');
    expect(unsupported).toContain('data-outcome="UNSUPPORTED"');
    expect(PALETTE.outcomeTones.SKIPPED).not.toBe(PALETTE.outcomeTones.UNSUPPORTED);
    expect(BANNER_CSS).toMatch(
      new RegExp(`data-outcome="SKIPPED"\\]\\{--tone:${PALETTE.outcomeTones.SKIPPED}`),
    );
    expect(BANNER_CSS).toMatch(
      new RegExp(`data-outcome="UNSUPPORTED"\\]\\{--tone:${PALETTE.outcomeTones.UNSUPPORTED}`),
    );
  });

  it('uses no one-sided border as an accent (3.17)', () => {
    for (const o of OUTCOMES) {
      expect(renderBanner(sample(o, 1)[0]!)).not.toMatch(/border-(left|right|top|bottom|inline|block)/i);
    }
    // The card border is on all four sides. The only one-sided rule allowed is the hr divider.
    const rules = BANNER_CSS.split('\n').filter((l) => /border-(left|right|top|bottom|inline|block)/i.test(l));
    for (const rule of rules) expect(rule.startsWith('.banner hr')).toBe(true);
    expect(BANNER_CSS).toMatch(/\.banner\{[^}]*\bborder:1px solid var\(--banner-border\)/);
  });
});
