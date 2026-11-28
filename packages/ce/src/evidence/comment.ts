// PR_Comment renderer: a pure function from a run record (or an unavailable
// marker), an artifact link and a list of secret values to the comment body.
// It performs no I/O, reads no process.env and decides no Outcome: it only
// reads `record.outcome` as data (Requirements 8, 9, 10).
import { redactSecretValues } from '../config/secrets.js';
import { OUTCOMES } from '../outcome/types.js';
import { parseImageUrl } from './image-url.js';
import { fallbackNote } from './publish-types.js';
import type { PublishResult } from './publish-types.js';
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
  /** Outcome of the publish step. Absent means `not-attempted` (publish: none). */
  publishResult?: PublishResult;
  /** `<owner>/<repo>` from GITHUB_REPOSITORY, used to re-validate Image_URLs. */
  repository?: string;
  /** From GITHUB_SERVER_URL; defaults to https://github.com. */
  serverUrl?: string;
  prNumber?: number | undefined;
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

const THUMB_WIDTH = 160;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ImagePlan {
  /** Re-validated final screenshot URL, or undefined when absent or dropped. */
  finalUrl: string | undefined;
  /** Re-validated step thumbnails with their 1-based step label. */
  thumbs: { k: number; url: string }[];
  /** skippedCount plus URLs dropped by re-validation. */
  baseMore: number;
  /** Fixed note for a `fallback` result. */
  note: string | undefined;
}

/**
 * Plans the image section. Image_URLs are accepted only when they match the
 * canonical URL for this repository and PR (Requirement 9.5); the first URL of
 * a `published` result is the final screenshot only when `finalIncluded`; the
 * other URLs are steps, labeled by `stepNumbers`.
 */
function planImages(input: CommentInput): ImagePlan {
  const result = input.publishResult ?? { kind: 'not-attempted' as const };
  const empty: ImagePlan = { finalUrl: undefined, thumbs: [], baseMore: 0, note: undefined };
  if (result.kind === 'not-attempted') return empty;
  if (result.kind === 'fallback') return { ...empty, note: fallbackNote(result.reason) };

  const [owner, repo, ...rest] = (input.repository ?? '').split('/');
  const prNumber = input.prNumber;
  const context =
    owner !== undefined && owner !== '' && repo !== undefined && repo !== '' && rest.length === 0 && prNumber !== undefined
      ? { serverUrl: input.serverUrl ?? 'https://github.com', owner, repo, prNumber }
      : undefined;
  const valid = (url: string): boolean => context !== undefined && parseImageUrl(url, context) !== undefined;

  let dropped = 0;
  let finalUrl: string | undefined;
  const thumbs: { k: number; url: string }[] = [];
  let stepIndex = 0;
  result.imageUrls.forEach((url, i) => {
    const isFinal = result.finalIncluded && i === 0;
    const k = isFinal ? 0 : (result.stepNumbers[stepIndex++] ?? stepIndex);
    if (!valid(url)) {
      dropped += 1;
    } else if (isFinal) {
      finalUrl = url;
    } else {
      thumbs.push({ k, url });
    }
  });
  return { finalUrl, thumbs, baseMore: Math.max(0, result.skippedCount) + dropped, note: undefined };
}

function imageSection(plan: ImagePlan, shownThumbs: number): string[] {
  const lines: string[] = [];
  if (plan.note !== undefined) return [plan.note];
  if (plan.finalUrl !== undefined) {
    lines.push('Final screenshot (an observation of the final state):', `![final screenshot](${plan.finalUrl})`);
  }
  const shown = plan.thumbs.slice(0, shownThumbs);
  if (shown.length > 0) {
    lines.push(
      '',
      '<details>',
      '<summary>Step screenshots (observations)</summary>',
      '',
      ...shown.map(
        (t) =>
          `<img src="${escapeAttr(t.url)}" alt="${escapeAttr(`step ${t.k} screenshot`)}" width="${THUMB_WIDTH}">`,
      ),
      '',
    );
  }
  const more = plan.baseMore + (plan.thumbs.length - shown.length);
  if (more > 0) lines.push(`(+${more} more screenshots in the artifact)`);
  if (shown.length > 0) lines.push('</details>');
  return lines;
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
  const plan = planImages(input);
  const artifact = ['', artifactLine(input.artifactLink, secrets)];

  const listed = totalClaims === 0 ? 0 : claims.length - 1;
  let shown = listed;
  let thumbsShown = plan.thumbs.length;
  const build = (): string => {
    const images = imageSection(plan, thumbsShown);
    const fullTail = [...tail, ...(images.length > 0 ? ['', ...images] : []), ...artifact];
    return assemble(
      [outcomeLine],
      claims.slice(0, totalClaims === 0 ? claims.length : shown + 1),
      totalClaims - shown,
      fullTail,
    );
  };
  // The marker line counts against the ceiling (Requirements 9.9, 9.10).
  const prefix = `${COMMENT_MARKER}\n`;
  // Redact the part after the marker only, so a secret can never split the marker.
  const render = (): string => redactSecretValues(build(), secrets);
  const fits = (body: string): boolean => prefix.length + body.length <= MAX_BODY;

  // Largest count in [0, max] for which the body fits, by bisection (length
  // does not grow as items are dropped); `set` applies a candidate count.
  const shed = (max: number, set: (n: number) => void): string => {
    set(max);
    let body = render();
    if (fits(body) || max === 0) return body;
    let lo = 0;
    let hi = max; // hi does not fit
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      set(mid);
      if (fits(render())) lo = mid;
      else hi = mid;
    }
    set(lo);
    body = render();
    return body;
  };

  // Thumbnails go first (Requirement 9.10), then Claims.
  let body = shed(thumbsShown, (n) => {
    thumbsShown = n;
  });
  if (!fits(body)) {
    body = shed(shown, (n) => {
      shown = n;
    });
  }
  return `${prefix}${body}`;
}

/** Job summary text: the body without the marker line (Requirement 10.6). */
export function stripCommentMarker(body: string): string {
  const lines = body.split('\n');
  if (lines[0] === COMMENT_MARKER) lines.shift();
  return lines.join('\n');
}
