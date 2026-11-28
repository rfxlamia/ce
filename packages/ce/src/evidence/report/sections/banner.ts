/**
 * Banner section: Outcome word and icon, one-sentence explanation, outcomeReason,
 * Lead_Facts, Meta_Row. Reads the Outcome, reason and final state from the
 * Run_Record and decides nothing. Pure and total.
 *
 * Stable class names (styled by `BANNER_CSS`, which document.ts emits):
 *   .banner[data-outcome]  the card; whole surface tinted, border on all four sides
 *   .banner .head          row holding the icon and the Outcome word
 *   .banner .outcome       the Outcome word (largest font of the page)
 *   .banner .what          one-sentence explanation
 *   .banner .why           outcomeReason (muted, max-width 60ch)
 *   .banner .lead-facts    <dl> of Lead_Facts (larger than the Meta_Row)
 *   .banner .meta          <dl> of Meta_Row (smallest font of the Banner)
 *   .banner .mono          monospace value (URLs, paths)
 *   .sr-only               visually hidden, defined by document.ts (used by the h2)
 */
import { escapeHtml } from '../escape.js';
import { BANNER_MIX, PALETTE, bannerColors } from '../palette.js';
import type { RunRecord } from '../../schema.js';

/** Inline SVG icon bodies, one distinct shape per Outcome. Keys are not Outcome values. */
const ICON_SHAPES: Record<RunRecord['outcome'], string> = {
  // circle with a bar: deliberately not run
  SKIPPED: '<circle cx="12" cy="12" r="10"/><path d="M7.5 12h9"/>',
  // circle with a check mark
  EVIDENCED: '<circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-7"/>',
  // triangle with an exclamation mark: required but not possible
  UNSUPPORTED: '<path d="M12 3 22 20H2Z"/><path d="M12 10v4.5"/><path d="M12 17.2h.01"/>',
  // octagon with a cross
  ERROR: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8Z"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>',
};

const EXPLANATIONS: Record<RunRecord['outcome'], string> = {
  SKIPPED: 'Additional Evidence was not required.',
  EVIDENCED: 'Runtime Evidence was collected.',
  UNSUPPORTED: 'Evidence was required, but the available capabilities were insufficient.',
  ERROR: 'CE did not complete.',
};

function icon(outcome: RunRecord['outcome']): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    ICON_SHAPES[outcome] +
    '</svg>'
  );
}

interface Fact {
  label: string;
  /** Already-escaped HTML for the <dd> content. */
  html: string;
  mono?: boolean;
}

function fact(label: string, value: string, mono = false): Fact {
  return { label, html: escapeHtml(value), mono };
}

function dl(cls: string, facts: readonly Fact[]): string {
  const items = facts
    .map(
      (f) =>
        `<div><dt>${escapeHtml(f.label)}</dt><dd${f.mono === true ? ' class="mono"' : ''}>${f.html}</dd></div>`,
    )
    .join('');
  return `<dl class="${cls}">${items}</dl>`;
}

/** `2026-11-28T09:12:44.000Z` -> `2026-11-28 09:12:44 UTC`; anything else is shown as recorded. */
function formatStarted(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|\+00:00)$/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return String(ms);
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function nonEmpty(text: string | null | undefined): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

export function renderBanner(record: RunRecord): string {
  const title = record.context?.change.title;
  const lead: Fact[] = [
    fact('Change', nonEmpty(title) ? title : 'No title'),
    fact('Subject', nonEmpty(record.subject) ? record.subject : 'No subject observed', nonEmpty(record.subject)),
  ];
  const meta: Fact[] = [];

  if (record.outcome === 'EVIDENCED') {
    meta.push(fact('Final state', record.finalState));
    if (record.runtime) meta.push(fact('Stop reason', record.runtime.stopReason));
  } else if (record.outcome === 'UNSUPPORTED') {
    lead.push(fact('Unsupported surface', record.assessment.surface));
  } else if (record.outcome === 'ERROR') {
    const e = record.error;
    lead.push(fact('Failed stage', e.stage));
    lead.push(fact('Error reason', e.reason));
    lead.push(fact('Cause', e.causeName ?? 'not recorded'));
    if (e.fields.length > 0) {
      const items = e.fields.map((p) => `<li class="mono">${escapeHtml(p)}</li>`).join('');
      lead.push({ label: 'Failing fields', html: `<ul class="fields">${items}</ul>` });
    }
  }

  meta.push(
    fact('Started', formatStarted(record.timings.startedAt)),
    fact('Duration', formatDuration(record.timings.durationMs)),
    fact('CE version', record.ceVersion),
  );

  const word = escapeHtml(record.outcome);
  return (
    `<section id="banner" class="banner" data-outcome="${word}" aria-labelledby="h-banner">` +
    `<h2 id="h-banner" class="sr-only">Outcome</h2>` +
    `<div class="head">${icon(record.outcome)}<span class="outcome">${word}</span></div>` +
    `<p class="what">${escapeHtml(EXPLANATIONS[record.outcome])}</p>` +
    `<p class="why">Reason: ${escapeHtml(record.outcomeReason)}</p>` +
    `<hr>` +
    dl('lead-facts', lead) +
    dl('meta', meta) +
    `</section>`
  );
}

/**
 * CSS for the Banner, for document.ts to emit. Colors come from `bannerColors`, so the
 * contrast test and the page share one recipe. No one-sided border anywhere.
 */
export const BANNER_CSS: string = (() => {
  const base = bannerColors(PALETTE.outcomeTones.EVIDENCED);
  const rules = Object.entries(PALETTE.outcomeTones).map(([name, tone]) => {
    const c = bannerColors(tone);
    return (
      `.banner[data-outcome="${name}"]{--tone:${tone};--banner-bg:${c.background};` +
      `--banner-border:${c.border};--on-tone-muted:${c.onToneMuted}}`
    );
  });
  void BANNER_MIX;
  return [
    `.banner{--tone:${PALETTE.outcomeTones.EVIDENCED};--banner-bg:${base.background};--banner-border:${base.border};--on-tone-muted:${base.onToneMuted};` +
      `background:var(--banner-bg);border:1px solid var(--banner-border);border-radius:10px;padding:1.5rem 1.6rem 1.3rem;color:var(--text);overflow-wrap:anywhere}`,
    ...rules,
    `.banner .head{display:flex;align-items:center;gap:.8rem}`,
    `.banner .head svg{flex:none;width:2.4rem;height:2.4rem;color:var(--tone)}`,
    `.banner .outcome{font-size:2.4rem;line-height:1;font-weight:800;letter-spacing:.03em;color:var(--tone)}`,
    `.banner .what{font-size:1.2rem;font-weight:600;margin:.55rem 0 0;color:var(--text)}`,
    `.banner .why{margin:.3rem 0 0;color:var(--on-tone-muted);max-width:60ch}`,
    `.banner hr{border:0;border-top:1px solid var(--banner-border);margin:1.2rem 0 1rem}`,
    `.banner .lead-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(16rem,100%),1fr));gap:.9rem 2rem;margin:0}`,
    `.banner .lead-facts dt,.banner .meta dt{color:var(--on-tone-muted);font-size:.82rem;font-weight:500}`,
    `.banner .lead-facts dd{margin:.1rem 0 0;font-size:1.05rem;font-weight:600;overflow-wrap:anywhere}`,
    `.banner .meta{display:flex;flex-wrap:wrap;gap:.6rem 2rem;margin:1.1rem 0 0;padding:0}`,
    `.banner .meta div{min-width:0}`,
    `.banner .meta dd{margin:0;font-size:.82rem;overflow-wrap:anywhere}`,
    `.banner .fields{margin:.1rem 0 0;padding-left:1.1rem}`,
  ].join('\n');
})();
