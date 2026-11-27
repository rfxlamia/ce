// PR_Comment renderer: a pure function from a run record (or an unavailable
// marker), an artifact link and a list of secret values to the comment body.
// It performs no I/O, reads no process.env and decides no Outcome: it only
// reads `record.outcome` as data (Requirements 8, 9, 10).
import { redactSecretValues } from '../config/secrets.js';
import { OUTCOMES } from '../outcome/types.js';
import type { RunRecord } from './schema.js';
import { clamp, oneLine, rationaleLine } from './summary.js';

const [SKIPPED_O, EVIDENCED_O, UNSUPPORTED_O, ERROR_O] = OUTCOMES;

export const COMMENT_MARKER = '<!-- ce:report -->';

/** Stands in for a run record that could not be read (Requirement 8.8). */
export interface UnavailableRecord {
  kind: 'unavailable';
  exitCode: number;
}

export interface CommentInput {
  record: RunRecord | UnavailableRecord;
  /** '' means the artifact is unavailable. */
  artifactLink: string;
  /** Secret values to replace with `[REDACTED]`. */
  secrets: readonly string[];
}

const MAX_BODY = 60000;
const MAX_CLAIMS = 10;
const MAX_CLAIM_CP = 200;
const MAX_LINK_CP = 2000;
const ELLIPSIS = '…';
/** Private placeholder for `[REDACTED]`, so the redaction text escapes as itself. */
const SENTINEL = '\u0000';
const REDACTED = '[REDACTED]';

function cpLength(text: string): number {
  return Array.from(text).length;
}

function cutCodePoints(text: string, max: number): string {
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  return `${cps.slice(0, Math.max(0, max - 1)).join('')}${ELLIPSIS}`;
}

/** Remove the marker and every `<!--`, repeating until nothing is left to remove. */
function stripComments(text: string): string {
  let current = text;
  for (;;) {
    const next = current.split(COMMENT_MARKER).join('').split('<!--').join('');
    if (next === current) return current;
    current = next;
  }
}

const MENTION_OR_ISSUE = /@[A-Za-z0-9_][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_-]+)?|#\d+/g;

function escapeSegment(segment: string): string {
  return segment
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]()#!|~]/g, '\\$&')
    .replace(/(https?|ftp):\/\//gi, '$1:\\/\\/')
    .replace(/www\./gi, 'www\\.');
}

/**
 * Untrusted text to one line of inert Markdown: secrets redacted, comments
 * removed, control characters escaped, mentions and issue references in code.
 */
function inert(raw: string, secrets: readonly string[]): string {
  const redacted = redactSecretValues(raw.split(SENTINEL).join(''), secrets)
    .split(REDACTED)
    .join(SENTINEL);
  const text = oneLine(stripComments(redacted));
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MENTION_OR_ISSUE)) {
    const at = m.index ?? 0;
    out += escapeSegment(text.slice(last, at)) + `\`${m[0]}\``;
    last = at + m[0].length;
  }
  out += escapeSegment(text.slice(last));
  return out.split(SENTINEL).join(REDACTED);
}

/** Inert text cut so the escaped result has at most `max` code points. */
function inertFit(raw: string, secrets: readonly string[], max: number): string {
  let keep = Math.min(cpLength(raw), max);
  let rendered = inert(cutCodePoints(raw, keep), secrets);
  while (cpLength(rendered) > max && keep > 1) {
    keep = Math.max(1, keep - Math.max(1, cpLength(rendered) - max));
    rendered = inert(cutCodePoints(raw, keep), secrets);
  }
  return rendered;
}

const SAFE_LINE = /^[A-Za-z0-9 _.:,()-]*$/;
const SAFE_URL = /^https?:\/\/[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]+$/;

function isRunRecord(record: CommentInput['record']): record is RunRecord {
  return !('kind' in record);
}

function claimLines(record: RunRecord, secrets: readonly string[]): string[] {
  const total = record.claims.length;
  if (total === 0) return ['No claim was identified.'];
  const lines = ['Claims:'];
  for (const c of record.claims.slice(0, MAX_CLAIMS)) {
    const label = c.probability === null ? '' : ` (signal: ${c.probability.toFixed(2)})`;
    lines.push(`- ${inertFit(c.text, secrets, MAX_CLAIM_CP)}${label}`);
  }
  return lines;
}

function detailLine(record: RunRecord, secrets: readonly string[]): string {
  const t = (v: unknown): string => inert(String(v ?? 'unknown'), secrets);
  switch (record.outcome) {
    case SKIPPED_O:
      return `Evidence was not required: decided by ${t(record.assessment?.decidedBy)}, reason ${t(record.outcomeReason)}.`;
    case UNSUPPORTED_O:
      return `No capability exists for the surface ${t(record.assessment?.surface)}.`;
    case ERROR_O:
      return `Stage ${t(record.error?.stage)}, reason ${t(record.outcomeReason)}.`;
    case EVIDENCED_O:
      return `Final state ${t(record.finalState)} after ${record.steps.length} steps. This evidence is for inspection and is not a verdict.`;
    default:
      return '';
  }
}

function rationale(record: RunRecord, secrets: readonly string[]): string {
  const line = rationaleLine({
    outcome: record.outcome,
    reason: record.outcomeReason,
    stage: record.error?.stage,
    surface: record.assessment?.surface,
    decidedBy: record.assessment?.decidedBy,
    finalState: record.finalState,
    stepCount: record.steps.length,
  });
  return SAFE_LINE.test(line) ? line : clamp(inert(line, secrets));
}

function artifactLine(link: string, secrets: readonly string[]): string {
  const url = link.trim();
  if (url === '' || cpLength(url) > MAX_LINK_CP) return 'Artifact: the evidence artifact is unavailable.';
  if (SAFE_URL.test(url) && redactSecretValues(url, secrets) === url) return `Artifact: ${url}`;
  return `Artifact: ${inert(url, secrets)}`;
}

function assemble(head: string[], claims: string[], more: number, tail: string[]): string {
  const claimBlock = more > 0 ? [...claims, `(+${more} more claims)`] : claims;
  return [...head, '', ...claimBlock, '', ...tail].join('\n');
}

export function renderPrComment(input: CommentInput): string {
  const { record, secrets } = input;
  let outcomeLine: string;
  let claims: string[];
  let totalClaims = 0;
  let tail: string[];
  if (isRunRecord(record)) {
    outcomeLine = `Outcome: ${record.outcome}`;
    claims = claimLines(record, secrets);
    totalClaims = record.claims.length;
    tail = [rationale(record, secrets), '', detailLine(record, secrets)];
  } else {
    const code = Number.isFinite(record.exitCode) ? String(Math.trunc(record.exitCode)) : 'unknown';
    outcomeLine = 'Outcome: unknown (no run record)';
    claims = ['No claim was identified.'];
    tail = ['Why: no run record was available', '', `CE exit code: ${code}`];
  }
  tail = [...tail, '', artifactLine(input.artifactLink, secrets)];

  const listed = totalClaims === 0 ? 0 : claims.length - 1;
  let shown = listed;
  const build = (): string =>
    assemble([outcomeLine], claims.slice(0, totalClaims === 0 ? claims.length : shown + 1), totalClaims - shown, tail);
  let body = build();
  while (body.length > MAX_BODY && shown > 0) {
    shown -= 1;
    body = build();
  }
  // Redact the part after the marker only, so a secret can never split the marker.
  const rest = redactSecretValues(body, secrets);
  return `${COMMENT_MARKER}\n${rest}`;
}

/** Job summary text: the body without the marker line (Requirement 10.6). */
export function stripCommentMarker(body: string): string {
  const lines = body.split('\n');
  if (lines[0] === COMMENT_MARKER) lines.shift();
  return lines.join('\n');
}
