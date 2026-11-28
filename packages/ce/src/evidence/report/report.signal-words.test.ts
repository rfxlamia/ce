/**
 * Signal wording of report.html (Requirements 11.1, 11.2, 11.3, 11.5, 16.5).
 * One hand-written record with every classifier field populated. The generic
 * Property 11 lives in report.signal-wording.property.test.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evidencedRunRecordArb } from '../arbitraries.js';
import type { RunRecord } from '../schema.js';
import { render } from './render.js';

type Evidenced = Extract<RunRecord, { outcome: 'EVIDENCED' }>;

const base = fc.sample(evidencedRunRecordArb, { numRuns: 1, seed: 11 })[0]!;

const prov = { provider: 'cli' as const };

const record: Evidenced = {
  ...base,
  claims: [
    { id: 'c1', text: 'The cart total updates.', probability: 0.83, provenance: prov },
    { id: 'c2', text: 'The badge is visible.', probability: null, provenance: prov },
  ],
  context: {
    ...base.context,
    candidates: [{ id: 'k1', text: 'Maybe the header changed.', provenance: prov }],
    checks: [
      { name: 'unit', status: 'passed', provenance: { provider: 'junit' } },
      { name: 'lint', status: 'failed', provenance: { provider: 'junit' } },
      { name: 'e2e', status: 'skipped', provenance: { provider: 'junit' } },
    ],
  },
  assessment: {
    required: true,
    decidedBy: 'classifier',
    surface: 'browser_ui',
    claimStatus: 'identified',
    perClaimProbabilities: [{ claimId: 'c1', runtimeObservable: 0.91, checksAdequate: 0.12 }],
    questions: [
      { idVersion: 'assessment.claim_identified@1', subjectId: 'c1', probability: 0.77, probabilities: null },
      {
        idVersion: 'assessment.surface@1',
        subjectId: 'change',
        probability: null,
        probabilities: { browser_ui: 0.88, cli: 0.07 },
      },
    ],
    settings: base.assessment.settings,
  },
  steps: [
    {
      step: 0,
      url: 'http://localhost/',
      title: 'Home',
      action: { kind: 'click', description: 'Click Add' },
      executed: true,
      screenshot: 'step-0.png',
      probabilities: { '0': 0.6 },
      alternatives: [
        { key: '0', description: 'Click Add', probability: 0.6 },
        { key: 'done', description: 'done', probability: 0.21 },
      ],
    },
  ],
  eventLog: [],
  finalImage: {
    model: 'typesafe/jev-1.14',
    error: null,
    screenshot: 'final.png',
    box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    signals: { stateReachedDom: 0.71, stateReachedImage: undefined, stateReached: 0.69 } as never,
  },
};

const html = render(record);

/** Visible text: style, script, pre (raw JSON) and tags removed, entities decoded. */
function visibleText(doc: string): string {
  return doc
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const FORBIDDEN = /\b(verdict|correct|incorrect|pass|fail|proves|verified)\b/gi;

function noteOf(doc: string): string {
  const m = /<p class="note"[\s\S]*?<\/p>/.exec(doc);
  expect(m).not.toBeNull();
  return m![0];
}

describe('signal note (11.2)', () => {
  it('appears exactly once, after the Banner and before the Claims section', () => {
    expect(html.match(/<p class="note"/g)).toHaveLength(1);
    const banner = html.indexOf('id="banner"');
    const bannerEnd = html.indexOf('</section>', banner);
    const note = html.indexOf('<p class="note"');
    expect(banner).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(bannerEnd);
    expect(note).toBeLessThan(html.indexOf('id="claims"'));
  });

  it('says values are signals, not a verdict, and the Assessment decides if Evidence is needed', () => {
    const text = visibleText(noteOf(html)).replace(/\s+/g, ' ');
    expect(text).toMatch(/signal/i);
    expect(text).toMatch(/not a verdict/i);
    expect(text).toMatch(/correct/i);
    expect(text).toMatch(/Assessment decides whether runtime Evidence is needed/i);
  });
});

describe('every classifier value is labelled "signal" (11.1)', () => {
  const bars = [...html.matchAll(/<div class="bar[^"]*"><span class="lbl">[\s\S]*?<\/div>(?:<\/div>)?/g)];

  it('finds the bars of the record', () => {
    // claim 1, 1 per-claim table is not a bar; 2 question bars, 2 alternatives, 2 final, 1 question probability
    expect(bars.length).toBeGreaterThanOrEqual(7);
  });

  it('gives every meter an accessible name that contains "signal"', () => {
    const meters = [...html.matchAll(/role="meter" aria-label="([^"]*)"/g)].map((m) => m[1]!);
    expect(meters.length).toBeGreaterThanOrEqual(7);
    for (const name of meters) expect(name.toLowerCase()).toContain('signal');
  });

  it('labels the claim probability, question groups, alternatives and Box with the word signal', () => {
    expect(html).toMatch(/<span class="tag-signal">signal<\/span> <div class="bar"><span class="lbl">Claim signal/);
    expect(html).toContain('Alternatives considered <span class="tag-signal">signal</span>');
    expect(html).toMatch(/Box <span class="tag-signal">signal<\/span>/);
    const questionHeadings = [...html.matchAll(/<div class="q"><h3>[\s\S]*?<\/h3>/g)].map((m) => m[0]);
    expect(questionHeadings).toHaveLength(2);
    for (const h of questionHeadings) expect(h).toContain('<span class="tag-signal">signal</span>');
  });

  it('states that a Claim without probability carries no classifier signal', () => {
    expect(html).toContain('declared, no classifier signal');
  });
});

describe('forbidden words (11.3)', () => {
  const text = visibleText(html);
  const note = visibleText(noteOf(html));
  const outside = text.replace(note, ' ');

  it('uses "verdict" and "correct" only inside the note', () => {
    expect(outside).not.toMatch(/\b(verdict|correct|incorrect)\b/i);
    expect(note).toMatch(/\bverdict\b/i);
    expect(note).toMatch(/\bcorrect\b/i);
  });

  it('uses none of pass, fail, proves, verified outside the check status cells', () => {
    const withoutChecks = outside.replace(/\bpassed\b|\bfailed\b|\bskipped\b/g, ' ');
    expect(withoutChecks.match(FORBIDDEN) ?? []).toEqual([]);
  });

  it('flags the forbidden-word scan if a classifier label used one', () => {
    const tainted = render({
      ...record,
      claims: [{ ...record.claims[0]!, text: 'Claim' }, record.claims[1]!],
    });
    expect(visibleText(tainted).replace(visibleText(noteOf(tainted)), ' ')).not.toMatch(FORBIDDEN);
  });
});

describe('Check status is not a classifier result (11.5)', () => {
  const table = /<table class="checks">[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';

  it('shows passed, failed and skipped in the checks table, labelled "Check status" with the provider', () => {
    expect(table).toContain('<th>Check status</th>');
    expect(table).toContain('<th>Reported by</th>');
    for (const s of ['passed', 'failed', 'skipped']) expect(table).toContain(s);
    expect(table.match(/junit/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('does not label check statuses as signals and shows them nowhere else', () => {
    expect(table).not.toMatch(/signal/i);
    const rest = visibleText(html.replace(table, ' '));
    expect(rest).not.toMatch(/\b(passed|failed|skipped)\b/);
  });
});
