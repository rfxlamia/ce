/**
 * Logs_Section: runtime events, stop reason, log artifacts, stage durations,
 * returned Jev models and the effective Jev provider and model alias.
 * Pure and total. Reads the record as data; decides no Outcome.
 */
import type { RunRecord } from '../../schema.js';
import { escapeAttr, escapeHtml, hrefFor } from '../escape.js';

type StopReason = NonNullable<RunRecord['runtime']>['stopReason'];

const STOP_REASON_MEANING: Readonly<Record<StopReason, string>> = {
  done: 'The classifier judged the task complete and the loop stopped on its own.',
  reached: 'The classifier judged that the state described by the Claim was reached, so the loop stopped.',
  give_up: 'The classifier chose to give up because no available action moved the page toward the Claim.',
  'max-steps': 'The step budget ended the loop before the state was reached.',
  'time-budget': 'The time budget ended the loop before the state was reached.',
  aborted: 'The run was aborted before the loop could finish.',
};

/** One-sentence meaning of a stop reason. Unknown values get a neutral sentence. */
export function stopReasonMeaning(stopReason: string): string {
  return Object.prototype.hasOwnProperty.call(STOP_REASON_MEANING, stopReason)
    ? STOP_REASON_MEANING[stopReason as StopReason]
    : 'The loop ended for a reason this report does not recognize.';
}

const STAGE_ORDER = ['config', 'context', 'assessment', 'runtime'] as const;

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return 'unknown';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function renderEvents(record: RunRecord): string {
  if (record.eventLog.length === 0) {
    return `<p class="no-events">No runtime events</p>`;
  }
  const rows = record.eventLog
    .map(
      (e) =>
        `<tr><td>${escapeHtml(String(e.step))}</td><td>${escapeHtml(e.kind)}</td><td>${escapeHtml(e.detail)}</td></tr>`,
    )
    .join('');
  return (
    `<table class="event-log"><thead><tr><th scope="col">Step</th><th scope="col">Event</th>` +
    `<th scope="col">Detail</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

function renderStopReason(record: RunRecord): string {
  if (record.runtime === null) {
    return `<p class="stop-reason">The runtime did not start, so there is no stop reason.</p>`;
  }
  const reason = record.runtime.stopReason;
  return (
    `<p class="stop-reason">Stop reason: <span class="mono">${escapeHtml(reason)}</span>. ` +
    `${escapeHtml(stopReasonMeaning(reason))}</p>`
  );
}

function renderArtifacts(record: RunRecord): string {
  const items = record.artifacts
    .filter((a) => a.kind === 'log' || a.kind === 'jev-calls')
    .map((a) => {
      const note =
        a.kind === 'jev-calls'
          ? 'per-call Jev log with state hashes, no state text'
          : 'log file written during the run';
      return (
        `<li><a href="${escapeAttr(hrefFor(a.path))}" class="mono">${escapeHtml(a.path)}</a> ` +
        `<span class="artifact-note">${escapeHtml(note)}</span></li>`
      );
    })
    .join('');
  const note =
    `<p class="muted jev-calls-note">jev-calls.jsonl holds the per-call Jev log with state hashes ` +
    `and no state text.</p>`;
  const list = items === '' ? `<p class="no-log-artifacts">No log files were recorded.</p>` : `<ul class="log-artifacts">${items}</ul>`;
  return list + note;
}

function renderStageDurations(record: RunRecord): string {
  const parts = STAGE_ORDER.map((stage) => {
    const ms = record.timings.stages[stage];
    return `${stage} ${ms === null ? 'not started' : formatDuration(ms)}`;
  });
  return `<p class="stage-durations muted">Stage durations: ${escapeHtml(parts.join(' · '))}.</p>`;
}

function renderModels(record: RunRecord): string {
  if (record.jevModels.length === 0) {
    return `<p class="jev-models muted">No Jev call returned a model id.</p>`;
  }
  const items = record.jevModels.map((m) => `<li class="mono">${escapeHtml(m)}</li>`).join('');
  return `<div class="jev-models"><p class="muted">Jev models returned:</p><ul>${items}</ul></div>`;
}

function renderEffectiveJev(record: RunRecord): string {
  if (record.config === null) {
    return `<p class="jev-config muted">Effective Jev provider and model alias: not available, the config stage did not complete.</p>`;
  }
  const provider = record.config.jev?.provider;
  const model = record.config.jev?.model;
  const show = (v: string | undefined): string =>
    v === undefined ? 'not recorded' : `<span class="mono">${escapeHtml(v)}</span>`;
  return (
    `<p class="jev-config muted">Effective Jev provider: ${show(provider)}. ` +
    `Model alias: ${show(model)}.</p>`
  );
}

export function renderLogs(record: RunRecord): string {
  return (
    `<section id="logs" aria-labelledby="h-logs">` +
    `<h2 id="h-logs">Logs</h2>` +
    renderEvents(record) +
    renderStopReason(record) +
    renderArtifacts(record) +
    renderStageDurations(record) +
    renderModels(record) +
    renderEffectiveJev(record) +
    `</section>`
  );
}
