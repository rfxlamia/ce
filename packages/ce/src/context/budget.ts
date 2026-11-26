// Budgeter: fits the Change_Context text into the Context_Budget in a
// deterministic way (Requirement 7, Decisions D1, D2, D15, D17, D21).
// Pure functions, no I/O. Nothing here imports from jev/.

import type { RawChangeContext, TruncationReason, ChangedFile } from './types.ts';

/** Hard limit per Jev request, in estimated tokens (D1). */
export const STATE_BUDGET_TOKENS = 32_000;
/** Limit for the context text of the Change_Context (D1). */
export const CONTEXT_BUDGET_TOKENS = 24_000;
/** Space left for question text, Claim and Check_Results of a request (D1). */
export const REQUEST_HEADROOM_TOKENS = STATE_BUDGET_TOKENS - CONTEXT_BUDGET_TOKENS;

const CHARS_PER_TOKEN = 3;

/** Token_Estimate of one text: ceil(length / 3), length in UTF-16 code units (D2). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Token_Estimate of several texts: the sum of the per-text estimates (D2). */
export function estimateTokensOf(texts: readonly string[]): number {
  let sum = 0;
  for (const t of texts) sum += estimateTokens(t);
  return sum;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Cut at a line boundary: keep the longest run of whole lines that fits in
 * `maxTokens`. Returns undefined when not even one whole, non-blank line fits.
 * Precondition for a meaningful result: the text does not fit whole.
 */
function cutAtLine(text: string, maxTokens: number): string | undefined {
  if (maxTokens <= 0) return undefined;
  const limit = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= limit) return text;
  // A newline at index `limit` ends a line that fits without its newline.
  const idx = text.lastIndexOf('\n', limit);
  if (idx < 0) return undefined;
  const cut = idx === limit ? limit : idx + 1;
  const result = text.slice(0, cut);
  return result.trim().length > 0 ? result : undefined;
}

/**
 * Truncate a text to `maxTokens` estimated tokens, at a line boundary when at
 * least one full line fits, otherwise at a code point boundary. A UTF-16
 * surrogate pair is never split (7.13, 7.16).
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean } {
  if (estimateTokens(text) <= maxTokens) return { text, truncated: false };
  if (maxTokens <= 0) return { text: '', truncated: true };
  const byLine = cutAtLine(text, maxTokens);
  if (byLine !== undefined) return { text: byLine, truncated: true };
  let end = maxTokens * CHARS_PER_TOKEN;
  if (
    end > 0 &&
    end < text.length &&
    isHighSurrogate(text.charCodeAt(end - 1)) &&
    isLowSurrogate(text.charCodeAt(end))
  ) {
    end -= 1;
  }
  return { text: text.slice(0, end), truncated: true };
}

/**
 * Fit Check_Results to `maxTokens` (sum of the estimates of `name`). Priority
 * is failed, then skipped, then passed, stable within a status. Kept results
 * are returned in their original order (7.14, 7.15, D17).
 */
export function fitCheckResults<T extends { name: string; status: 'passed' | 'failed' | 'skipped' }>(
  checks: readonly T[],
  maxTokens: number,
): { kept: T[]; droppedCount: number } {
  const rank = (s: T['status']): number => (s === 'failed' ? 0 : s === 'skipped' ? 1 : 2);
  const order = checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.status) - rank(b.c.status) || a.i - b.i);
  const keep = new Set<number>();
  let used = 0;
  for (const { c, i } of order) {
    const cost = estimateTokens(c.name);
    if (used + cost > maxTokens) break;
    used += cost;
    keep.add(i);
  }
  const kept = checks.filter((_, i) => keep.has(i));
  return { kept, droppedCount: checks.length - kept.length };
}

// ---------------------------------------------------------------------------
// File ranking (7.2, 7.3, D21)

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'go.sum',
]);
const GENERATED_SUFFIXES = ['.min.js', '.min.css', '.map', '.snap'];
const GENERATED_DIRS = new Set(['dist', 'build', 'generated']);
const LOW_PRIORITY_PREFIXES = ['CHANGELOG', 'HISTORY', 'CHANGES'];
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'e2e']);
const USER_FACING_DIRS = new Set(['pages', 'views', 'routes', 'components', 'locales', 'i18n']);
const USER_FACING_EXTENSIONS = new Set(['.css', '.scss', '.html', '.hbs', '.vue', '.svelte', '.tsx', '.jsx']);

// Lower number ranks first.
const RANK_USER_FACING = 0;
const RANK_TEST = 1;
const RANK_OTHER = 2;
const RANK_LOW = 3;

function rankOf(file: ChangedFile, binaryPaths: ReadonlySet<string>): number {
  const segments = file.path.split('/');
  const base = segments[segments.length - 1] ?? '';
  const dirs = segments.slice(0, -1);

  if (
    file.status === 'deleted' ||
    binaryPaths.has(file.path) ||
    LOCKFILES.has(base) ||
    GENERATED_SUFFIXES.some((s) => base.endsWith(s)) ||
    dirs.some((d) => GENERATED_DIRS.has(d)) ||
    LOW_PRIORITY_PREFIXES.some((p) => base.startsWith(p))
  ) {
    return RANK_LOW;
  }

  if (dirs.some((d) => TEST_DIRS.has(d)) || base.includes('.test.') || base.includes('.spec.')) {
    return RANK_TEST;
  }

  const appIdx = dirs.indexOf('app');
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : '';
  if (
    dirs.some((d) => USER_FACING_DIRS.has(d)) ||
    (appIdx >= 0 && !dirs.slice(appIdx + 1).includes('api')) ||
    USER_FACING_EXTENSIONS.has(ext)
  ) {
    return RANK_USER_FACING;
  }
  return RANK_OTHER;
}

function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

// ---------------------------------------------------------------------------
// budget()

type Record_ = { file: string; reason: TruncationReason };

/**
 * Fit the context into CONTEXT_BUDGET_TOKENS. Returns a new context (the input
 * is not modified) and the Truncation_Records produced here, in production
 * order. `files` of the result are in ranked order. When everything fits, the
 * text is unchanged and no record is returned.
 */
export function budget(context: RawChangeContext): {
  context: RawChangeContext;
  truncated: Record_[];
} {
  const records: Record_[] = [];

  let title = context.change.title;
  let description = context.change.description;
  let commits = context.change.commits.map((c) => ({ ...c }));
  const claimsOriginal = context.change.claims;
  // Keep the 1-based original position for the Pseudo_Path `claim:<n>`.
  let claims = claimsOriginal.map((c, i) => ({ ...c, n: i + 1 }));

  const fixedTotal = (): number =>
    estimateTokensOf([
      title ?? '',
      description ?? '',
      ...commits.map((c) => c.message),
      ...claims.map((c) => c.text),
    ]);
  const excess = (): number => fixedTotal() - CONTEXT_BUDGET_TOKENS;

  // Step 1: fixed fields. Order: oldest commit, description, claims from the last, title.
  while (excess() > 0 && commits.length > 0) {
    const e = excess();
    const first = commits[0]!;
    const est = estimateTokens(first.message);
    if (est <= e) {
      commits = commits.slice(1);
      records.push({ file: `commit:${first.sha}`, reason: 'dropped' });
    } else {
      const cut = truncateToTokens(first.message, est - e);
      if (cut.text.length === 0) {
        commits = commits.slice(1);
        records.push({ file: `commit:${first.sha}`, reason: 'dropped' });
      } else {
        commits = [{ ...first, message: cut.text }, ...commits.slice(1)];
        records.push({ file: `commit:${first.sha}`, reason: 'truncated' });
      }
    }
  }

  if (excess() > 0 && description !== undefined && description.length > 0) {
    const e = excess();
    const est = estimateTokens(description);
    const cut = est <= e ? { text: '' } : truncateToTokens(description, est - e);
    if (cut.text.length === 0) {
      description = undefined;
      records.push({ file: '<description>', reason: 'dropped' });
    } else {
      description = cut.text;
      records.push({ file: '<description>', reason: 'truncated' });
    }
  }

  for (let i = claims.length - 1; i >= 0 && excess() > 0; i--) {
    const e = excess();
    const claim = claims[i]!;
    const est = estimateTokens(claim.text);
    const cut = est <= e ? { text: '' } : truncateToTokens(claim.text, est - e);
    if (cut.text.length === 0) {
      claims = claims.filter((_, j) => j !== i);
      records.push({ file: `claim:${claim.n}`, reason: 'dropped' });
    } else {
      claims = claims.map((c, j) => (j === i ? { ...c, text: cut.text } : c));
      records.push({ file: `claim:${claim.n}`, reason: 'truncated' });
    }
  }

  if (excess() > 0 && title !== undefined && title.length > 0) {
    const e = excess();
    const est = estimateTokens(title);
    const cut = est <= e ? { text: '' } : truncateToTokens(title, est - e);
    if (cut.text.length === 0) {
      title = undefined;
      records.push({ file: '<title>', reason: 'dropped' });
    } else {
      title = cut.text;
      records.push({ file: '<title>', reason: 'truncated' });
    }
  }

  // Step 2: rank files.
  const binaryPaths = new Set(
    context.truncated.filter((t) => t.reason === 'binary').map((t) => t.file),
  );
  const ranked = context.change.files
    .map((f) => ({ f: { ...f }, rank: rankOf(f, binaryPaths) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        compareBytes(a.f.path, b.f.path) ||
        compareBytes(a.f.oldPath ?? '', b.f.oldPath ?? ''),
    )
    .map((x) => x.f);

  // Step 3, phase 1: reserve path and oldPath of every file.
  let remaining = CONTEXT_BUDGET_TOKENS - fixedTotal();
  const survivors: ChangedFile[] = [];
  for (const file of ranked) {
    const cost = estimateTokens(file.path) + estimateTokens(file.oldPath ?? '');
    if (cost <= remaining) {
      remaining -= cost;
      survivors.push(file);
    } else {
      records.push({ file: file.path, reason: 'dropped' });
    }
  }

  // Step 4, phase 2: fill patches in rank order.
  let cutDone = false;
  for (const file of survivors) {
    if (file.patch.length === 0) continue;
    if (cutDone) {
      file.patch = '';
      records.push({ file: file.path, reason: 'dropped' });
      continue;
    }
    const cost = estimateTokens(file.patch);
    if (cost <= remaining) {
      remaining -= cost;
      continue;
    }
    const cut = cutAtLine(file.patch, remaining);
    if (cut === undefined) {
      file.patch = '';
      records.push({ file: file.path, reason: 'dropped' });
    } else {
      file.patch = cut;
      remaining -= estimateTokens(cut);
      records.push({ file: file.path, reason: 'truncated' });
      cutDone = true;
    }
  }

  const change: RawChangeContext['change'] = {
    ...context.change,
    files: survivors,
    commits,
    claims: claims.map(({ n: _n, ...rest }) => rest),
  };
  if (title === undefined) delete change.title;
  else change.title = title;
  if (description === undefined) delete change.description;
  else change.description = description;

  return { context: { ...context, change }, truncated: records };
}
