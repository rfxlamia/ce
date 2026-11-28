/**
 * Timeline_Section: one list item per runtime step, in ascending step order.
 * Pure and total. Reads the Outcome-related text as data; decides nothing.
 */
import type { RunRecord } from '../../schema.js';
import { escapeAttr, escapeHtml, hrefFor } from '../escape.js';
import { signalBar, signalLabel } from '../signal.js';

type Step = RunRecord['steps'][number];
type Alternative = Step['alternatives'][number];

/** Above this many steps, each step's Alternatives start collapsed. */
const COLLAPSE_ABOVE_STEPS = 12;

function probabilityOf(alternative: Alternative): number {
  return Number.isFinite(alternative.probability) ? alternative.probability : Number.NEGATIVE_INFINITY;
}

/** Descending probability; ties keep recorded order. */
function sortAlternatives(alternatives: readonly Alternative[]): Alternative[] {
  return alternatives
    .map((alternative, index) => ({ alternative, index }))
    .sort((a, b) => {
      const diff = probabilityOf(b.alternative) - probabilityOf(a.alternative);
      if (diff !== 0 && !Number.isNaN(diff)) return diff;
      return a.index - b.index;
    })
    .map((entry) => entry.alternative);
}

/**
 * The Alternative that corresponds to the action taken, or undefined when none can be named.
 * `done` and `give_up` match by key. Other actions match by identical description, else the
 * most probable Option (the runtime picks the highest-probability Option).
 */
function takenAlternative(step: Step, sorted: readonly Alternative[]): Alternative | undefined {
  const kind = step.action.kind;
  if (kind === 'done' || kind === 'give_up') {
    const byKey = sorted.find((a) => a.key === kind);
    if (byKey !== undefined) return byKey;
  } else {
    const byDescription = sorted.find(
      (a) => a.key !== 'done' && a.key !== 'give_up' && a.description === step.action.description,
    );
    if (byDescription !== undefined) return byDescription;
    const firstAction = sorted.find((a) => a.key !== 'done' && a.key !== 'give_up');
    if (firstAction !== undefined) return firstAction;
  }
  // Alternatives exist, so one must be marked: fall back to the most probable.
  return sorted[0];
}

function alternativeLabel(alternative: Alternative): string {
  return alternative.description === '' ? alternative.key : `${alternative.key} · ${alternative.description}`;
}

function renderAlternatives(step: Step, collapsed: boolean): string {
  if (step.alternatives.length === 0) {
    return `<p class="no-alternatives">no alternatives recorded</p>`;
  }
  const sorted = sortAlternatives(step.alternatives);
  const taken = takenAlternative(step, sorted);
  const bars = sorted
    .map((alternative) => {
      const isTaken = alternative === taken;
      const bar = signalBar(`${alternativeLabel(alternative)} (${signalLabel()})`, alternative.probability, {
        chosen: isTaken,
      });
      return isTaken ? `<div class="alt taken">${bar}<span class="taken-mark">taken</span></div>` : `<div class="alt">${bar}</div>`;
    })
    .join('');
  return (
    `<details class="alternatives"${collapsed ? '' : ' open'}>` +
    `<summary>Alternatives considered <span class="tag-signal">${signalLabel()}</span></summary>` +
    bars +
    `</details>`
  );
}

function renderStep(step: Step, record: RunRecord, collapsed: boolean): string {
  const n = String(step.step);
  const path = step.screenshot;
  const alt = `${path}, screenshot of step ${n}`;
  const refusals = record.eventLog.filter((e) => e.kind === 'refusal' && e.step === step.step);

  const shot =
    `<a class="shot" href="${escapeAttr(hrefFor(path))}" aria-label="${escapeAttr(`Open full-size screenshot of step ${n}: ${path}`)}">` +
    `<img src="${escapeAttr(hrefFor(path))}" alt="${escapeAttr(alt)}" loading="lazy">` +
    `</a>`;

  const description = step.action.description === '' ? '' : ` ${escapeHtml(step.action.description)}`;
  const executed = step.executed
    ? `<span class="exec-yes">· executed</span>`
    : `<span class="exec-no">· not executed</span>`;
  const refusalHtml = step.executed
    ? ''
    : refusals
        .map((e) => `<p class="refusal">Refusal: <span class="mono">${escapeHtml(e.detail)}</span></p>`)
        .join('');

  return (
    `<li class="step" id="step-${escapeAttr(n)}">` +
    shot +
    `<div class="step-body">` +
    `<h3><span class="stepno">${escapeHtml(n)}</span> ${escapeHtml(step.title)} · <span class="mono">${escapeHtml(step.url)}</span></h3>` +
    `<p class="action">Action: <strong>${escapeHtml(step.action.kind)}</strong>${description} ${executed}</p>` +
    refusalHtml +
    renderAlternatives(step, collapsed) +
    `</div></li>`
  );
}

export function renderTimeline(record: RunRecord): string {
  const heading = `<h2 id="h-time">Step timeline</h2>`;
  if (record.steps.length === 0) {
    const reason: string = record.outcomeReason;
    return (
      `<section id="timeline" aria-labelledby="h-time">${heading}` +
      `<p class="empty">No runtime steps were recorded: ${escapeHtml(reason)}</p></section>`
    );
  }
  const steps = record.steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.step - b.step.step || a.index - b.index)
    .map((entry) => entry.step);
  const collapsed = steps.length > COLLAPSE_ABOVE_STEPS;
  return (
    `<section id="timeline" aria-labelledby="h-time">${heading}` +
    `<ol class="steps">${steps.map((s) => renderStep(s, record, collapsed)).join('')}</ol></section>`
  );
}
