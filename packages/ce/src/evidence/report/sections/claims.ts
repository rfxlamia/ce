/**
 * Claim_Section: Claims with Provenance_Chips, candidates, changed files,
 * existing Checks and context reduction counts. Pure and total. Shows no patch
 * text and no commit message (the record holds only a commit count).
 */
import type { RunRecord } from '../../schema.js';
import { escapeHtml } from '../escape.js';
import { signalBar, signalLabel } from '../signal.js';

type Provenance = RunRecord['claims'][number]['provenance'];

/** Provenance_Chip: provider, then ref and location when present. */
function chip(p: Provenance): string {
  const detail = [p.ref, p.location]
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .map(escapeHtml)
    .join(' · ');
  return `<span class="chip"><b>${escapeHtml(p.provider)}</b>${detail === '' ? '' : ` ${detail}`}</span>`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function claimList(record: RunRecord): string {
  if (record.assessment?.claimStatus === 'not_identified') {
    return '<p class="no-claim">No claim identified.</p>';
  }
  if (record.claims.length === 0) {
    return '<p class="muted no-claim">No claims recorded for this run.</p>';
  }
  const items = record.claims.map((c) => {
    const probability =
      c.probability === null
        ? '<span class="muted claim-declared">declared, no classifier signal</span>'
        : `<span class="tag-signal">${signalLabel()}</span> ${signalBar('Claim signal', c.probability)}`;
    return (
      `<div class="claim" data-claim-id="${escapeHtml(c.id)}">` +
      `<h3>${escapeHtml(c.id)}</h3>` +
      `<p class="claim-text">${escapeHtml(c.text)}</p>` +
      `${chip(c.provenance)} ${probability}</div>`
    );
  });
  return items.join('');
}

function candidateList(record: RunRecord): string {
  const candidates = record.context?.candidates ?? [];
  if (candidates.length === 0) return '';
  const n = candidates.length;
  const items = candidates
    .map(
      (c) =>
        `<div class="claim candidate" data-candidate-id="${escapeHtml(c.id)}">` +
        `<p class="claim-text">${escapeHtml(c.text)}</p>${chip(c.provenance)}</div>`,
    )
    .join('');
  return (
    `<details class="candidates"><summary>${n} ${plural(n, 'candidate', 'candidates')} ` +
    `(candidates, not Claims)</summary>${items}</details>`
  );
}

function filesTable(record: RunRecord): string {
  const files = record.context?.change.files ?? [];
  if (files.length === 0) return '<p class="muted">No changed files recorded.</p>';
  const rows = files
    .map((f) => {
      const old = f.oldPath === undefined ? '' : ` <span class="muted">(from ${escapeHtml(f.oldPath)})</span>`;
      return `<tr><td class="mono">${escapeHtml(f.path)}${old}</td><td>${escapeHtml(f.status)}</td><td>${escapeHtml(f.provenance.provider)}</td></tr>`;
    })
    .join('');
  return (
    '<table class="files"><thead><tr><th>File</th><th>Status</th><th>Reported by</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>`
  );
}

function checksTable(record: RunRecord): string {
  const checks = record.context?.checks ?? [];
  if (checks.length === 0) return '<p class="muted">No existing Checks recorded.</p>';
  const rows = checks
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.status)}</td>` +
        `<td>${escapeHtml(c.provenance.provider)}</td></tr>`,
    )
    .join('');
  return (
    '<table class="checks"><thead><tr><th>Check</th><th>Check status</th><th>Reported by</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>`
  );
}

function reduction(record: RunRecord): string {
  const ctx = record.context;
  if (ctx === null) return '';
  const truncated = ctx.truncated.length;
  const redacted = ctx.redactions.reduce((sum, r) => sum + r.count, 0);
  return (
    `<p class="muted context-reduction">Context was reduced: ${truncated} ${plural(truncated, 'file', 'files')} ` +
    `truncated or dropped, ${redacted} ${plural(redacted, 'value', 'values')} redacted.</p>`
  );
}

export function renderClaims(record: RunRecord): string {
  const head = '<section id="claims" aria-labelledby="h-claims"><h2 id="h-claims">Claims</h2>';
  const ctx = record.context;
  const context =
    ctx === null
      ? '<p class="muted context-null">No context was gathered for this run, so changed files and Checks are not available.</p>'
      : `<h3>Changed files and existing Checks</h3>${filesTable(record)}${checksTable(record)}${reduction(record)}`;
  return `${head}${claimList(record)}${candidateList(record)}${context}</section>`;
}
