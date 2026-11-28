/**
 * Static style checks on the emitted report (Requirements 10.1, 10.9, 10.12, 10.13, 10.14, 16.13).
 * Reads the one <style> element and the markup; helpers are local to this file.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evidencedRunRecordArb, runRecordArb } from '../arbitraries.js';
import { PALETTE } from './palette.js';
import { render } from './render.js';

const RECORDS = fc.sample(runRecordArb, { numRuns: 12, seed: 1611 });
const HTML = render(fc.sample(evidencedRunRecordArb, { numRuns: 1, seed: 7 })[0]!);

function styleOf(html: string): string {
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  expect(m).not.toBeNull();
  return m![1]!;
}

const CSS = styleOf(HTML);

interface Rule {
  selector: string;
  body: string;
}

/** Every `selector{declarations}` block, including those nested inside @media. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push({ selector: m[1]!.trim(), body: m[2]!.trim() });
  return out;
}

const RULES = rules(CSS);

function decl(body: string, prop: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m?.[1]?.trim();
}

function ruleFor(selector: string): Rule {
  const r = RULES.find((x) => x.selector === selector);
  expect(r, `rule ${selector}`).toBeDefined();
  return r!;
}

function fontSizeRem(selector: string): number {
  const v = decl(ruleFor(selector).body, 'font-size');
  expect(v, `${selector} font-size`).toMatch(/^[\d.]+rem$/);
  return parseFloat(v!);
}

describe('report style: type scale (10.12, 10.13)', () => {
  // No listed exceptions: both adjacent ratios reach 1.25.
  it('h1 > h2 > h3 > body, with ratios of at least 1.25', () => {
    const [h1, h2, h3] = [fontSizeRem('h1'), fontSizeRem('h2'), fontSizeRem('h3')] as [number, number, number];
    expect(h1 / h2).toBeGreaterThanOrEqual(1.25 - 1e-9);
    expect(h2 / h3).toBeGreaterThanOrEqual(1.25 - 1e-9);
    expect(h3).toBeGreaterThan(1);
  });

  it('body text is at least 16px', () => {
    const font = decl(ruleFor('body').body, 'font')!;
    const px = /(?:^|\s)(\d+(?:\.\d+)?)px(?:\/|\s)/.exec(font);
    expect(px, 'body font shorthand has a px size').not.toBeNull();
    expect(parseFloat(px![1]!)).toBeGreaterThanOrEqual(16);
  });

  it('h3 weight is at least 600', () => {
    expect(parseInt(decl(ruleFor('h3').body, 'font-weight')!, 10)).toBeGreaterThanOrEqual(600);
  });

  it('the Banner Outcome word is the largest size on the page', () => {
    const outcome = fontSizeRem('.banner .outcome');
    expect(outcome).toBeGreaterThan(fontSizeRem('h1'));
  });
});

describe('report style: no one-sided accents (10.14)', () => {
  it('uses no border-left or border-right anywhere', () => {
    for (const r of RULES) {
      expect(r.body, r.selector).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:/);
    }
  });

  it('allows border-top and border-bottom only as 1px hairlines', () => {
    for (const r of RULES) {
      for (const m of r.body.matchAll(/border-(top|bottom|block-start|block-end)\s*:\s*([^;]+)/g)) {
        expect(m[2], `${r.selector} ${m[1]}`).toMatch(/^(0|1px\s+solid\s.*)$/);
      }
    }
  });

  it('has no ::before or ::after rule except the reduced-motion reset', () => {
    for (const r of RULES) {
      if (!/::?(before|after)/.test(r.selector)) continue;
      expect(r.selector).toBe('*,*::before,*::after');
      expect(r.body).toMatch(/animation:none!important/);
    }
  });

  it('uses no inset or one-sided box-shadow stripe', () => {
    for (const r of RULES) {
      const shadow = decl(r.body, 'box-shadow');
      if (shadow === undefined) continue;
      expect(shadow, r.selector).not.toMatch(/inset/);
      expect(shadow, r.selector).toMatch(/^0 0 /);
    }
  });
});

describe('report style: no decorative effects', () => {
  it('has no gradient (so no gradient text)', () => {
    expect(CSS).not.toMatch(/gradient\(/);
    expect(CSS).not.toMatch(/background-clip\s*:\s*text/);
    expect(CSS).not.toMatch(/-webkit-text-fill-color/);
  });

  it('has no glassmorphism', () => {
    expect(CSS).not.toMatch(/backdrop-filter/);
    expect(CSS).not.toMatch(/-webkit-backdrop-filter/);
  });

  it('does not lay the sections out as a grid of identical cards', () => {
    const sectionRules = RULES.filter((r) => /(^|[\s>,])(main>section|section|\.card)\b/.test(r.selector));
    for (const r of sectionRules) {
      expect(decl(r.body, 'display') ?? '', r.selector).not.toMatch(/grid|flex/);
      expect(decl(r.body, 'grid-template-columns'), r.selector).toBeUndefined();
    }
    for (const html of RECORDS.map((rec) => render(rec))) {
      const classes = [...html.matchAll(/<section\b[^>]*\bclass="([^"]*)"/g)].map((m) => m[1]);
      const ids = [...html.matchAll(/<section\b[^>]*\bid="([^"]*)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      // The Banner is a distinct component, not one more card of the same kind.
      expect(classes.some((c) => c!.split(/\s+/).includes('banner'))).toBe(true);
      expect(html).not.toMatch(/class="[^"]*\bcard\b/);
    }
  });
});

describe('report style: dark theme and motion (10.1, 10.9)', () => {
  it('is dark by default and never depends on prefers-color-scheme', () => {
    expect(CSS).not.toMatch(/prefers-color-scheme/);
    expect(decl(ruleFor('html').body, 'color-scheme')).toBe('dark');
    for (const html of RECORDS.map((rec) => render(rec))) expect(html).not.toMatch(/prefers-color-scheme/);
  });

  it('has a prefers-reduced-motion rule that removes animation and transition', () => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\}\s*)\}/.exec(CSS);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/animation:none/);
    expect(m![1]).toMatch(/transition:none/);
  });

  it(':root tokens equal PALETTE', () => {
    const root = decl(ruleFor(':root').body, '--bg');
    expect(root).toBe(PALETTE.bg);
    const body = ruleFor(':root').body;
    const tokens: [string, string][] = [
      ['--bg', PALETTE.bg],
      ['--surface', PALETTE.surface],
      ['--surface-2', PALETTE.surface2],
      ['--border', PALETTE.border],
      ['--text', PALETTE.text],
      ['--muted', PALETTE.muted],
      ['--link', PALETTE.link],
      ['--focus', PALETTE.focus],
      ['--bar', PALETTE.bar],
      ['--bar-track', PALETTE.barTrack],
      ['--box', PALETTE.box],
      ...Object.entries(PALETTE.outcomeTones).map(([k, v]) => [`--tone-${k.toLowerCase()}`, v] as [string, string]),
    ];
    for (const [name, value] of tokens) expect(decl(body, name), name).toBe(value);
  });
});

describe('report style: prose line length', () => {
  const ch = (v: string | undefined): number => {
    expect(v).toMatch(/^\d+(\.\d+)?ch$/);
    return parseFloat(v!);
  };

  it('limits the Banner reason to 65 characters or fewer', () => {
    expect(ch(decl(ruleFor('.banner .why').body, 'max-width'))).toBeLessThanOrEqual(65);
  });

  it('limits running prose blocks to 80 characters or fewer', () => {
    for (const sel of ['.note', '.claim-text']) {
      expect(ch(decl(ruleFor(sel).body, 'max-width')), sel).toBeLessThanOrEqual(80);
    }
  });
});
