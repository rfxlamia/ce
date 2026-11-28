/**
 * Assessment_Section: what CE asked the classifier and what it answered.
 * Pure. Question text comes only from the injected lookup; this file defines none.
 */
import type { RunRecord } from '../../schema.js';
import { escapeHtml } from '../escape.js';
import { signalBar, signalLabel } from '../signal.js';

type Assessment = NonNullable<RunRecord['assessment']>;
type Question = Assessment['questions'][number];

const UNAVAILABLE = 'question text unavailable for this version';

function two(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const s = n.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

function subjectText(record: RunRecord, subjectId: string): string {
  const claim = record.claims.find((c) => c.id === subjectId);
  if (claim !== undefined) return claim.text;
  const candidate = record.context?.candidates.find((c) => c.id === subjectId);
  if (candidate !== undefined) return candidate.text;
  return subjectId;
}

function renderQuestion(
  record: RunRecord,
  q: Question,
  questionText: (idVersion: string) => string | undefined,
): string {
  const text = questionText(q.idVersion);
  const subject = subjectText(record, q.subjectId);
  const subjectLine =
    subject === q.subjectId
      ? `<span class="mono">${escapeHtml(q.subjectId)}</span>`
      : `<span class="mono">${escapeHtml(q.subjectId)}</span> ${escapeHtml(subject)}`;

  let answer: string;
  if (q.probabilities !== null) {
    const entries = Object.entries(q.probabilities).sort((a, b) => b[1] - a[1]);
    answer = entries.length === 0 ? '<p class="muted q-noanswer">This question returned no answer.</p>' : entries.map(([label, p]) => signalBar(label, p)).join('');
  } else if (q.probability !== null) {
    answer = signalBar('probability', q.probability);
  } else {
    answer = '<p class="muted q-noanswer">This question returned no answer.</p>';
  }

  return (
    `<div class="q">` +
    `<h3>${subjectLine} <span class="tag-signal">${escapeHtml(signalLabel())}</span></h3>` +
    `<p class="muted q-id" style="margin:.1rem 0">Question asked <span class="mono">(${escapeHtml(q.idVersion)})</span></p>` +
    `<blockquote class="q-text">${text === undefined ? escapeHtml(UNAVAILABLE) : escapeHtml(text)}</blockquote>` +
    answer +
    `</div>`
  );
}

function renderPerClaim(a: Assessment): string {
  if (a.perClaimProbabilities.length === 0) return '';
  const rows = a.perClaimProbabilities
    .map(
      (p) =>
        `<tr><td class="mono">${escapeHtml(p.claimId)}</td>` +
        `<td>${escapeHtml(two(p.runtimeObservable))}</td>` +
        `<td>${escapeHtml(two(p.checksAdequate))}</td></tr>`,
    )
    .join('');
  return (
    `<table class="per-claim"><thead><tr><th>Claim</th><th>Runtime observable</th><th>Checks adequate</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

export function renderAssessment(
  record: RunRecord,
  questionText: (idVersion: string) => string | undefined,
): string {
  const head = `<section id="assessment" aria-labelledby="h-assess"><h2 id="h-assess">Assessment</h2>`;
  const a = record.assessment;
  if (a === null) {
    return `${head}<p class="muted">The assessment stage did not complete, so there is no Assessment to show.</p></section>`;
  }

  const decidedBy =
    a.decidedBy === 'policy'
      ? 'policy. A configured policy decided this Assessment, not a classifier.'
      : 'classifier signals + thresholds';
  const summary =
    `<table class="assessment-summary"><tbody>` +
    `<tr><th>Evidence required</th><td>${a.required ? 'yes' : 'no'}</td>` +
    `<th>Decided by</th><td>${escapeHtml(decidedBy)}</td></tr>` +
    `<tr><th>Surface</th><td>${escapeHtml(a.surface)}</td>` +
    `<th>Claim status</th><td>${escapeHtml(a.claimStatus)}</td></tr>` +
    `</tbody></table>`;

  const questions =
    a.questions.length === 0
      ? '<p class="muted">No questions were asked.</p>'
      : a.questions.map((q) => renderQuestion(record, q, questionText)).join('');

  const s = a.settings;
  const settings =
    `<p class="muted settings" style="margin-bottom:0">Thresholds: claim ≥ ${escapeHtml(two(s.claimThreshold))}` +
    ` · observable ≥ ${escapeHtml(two(s.observableThreshold))}` +
    ` · adequate ≥ ${escapeHtml(two(s.adequateThreshold))}` +
    ` · uncertainty band ±${escapeHtml(two(s.uncertaintyBand))}` +
    ` · on uncertain: ${escapeHtml(s.onUncertain)}.</p>`;

  return `${head}${summary}${questions}${renderPerClaim(a)}${settings}</section>`;
}
