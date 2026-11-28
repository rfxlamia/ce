import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recordPath = resolve(
  repoRoot,
  '.kiro/specs/inline-screenshot-in-pr/private-repo-image-verification.md',
);

/** Required result fields (Requirement 15 criterion 2). Labels match the record template. */
export const REQUIRED_FIELDS = [
  'Date',
  'Repository visibility',
  'Exact URL form tested',
  'Viewer (a), with read access, saw',
  'Viewer (b), without access or logged out, saw',
  'Image rendered inline for viewer (a)',
  'Image rendered inline for viewer (b)',
] as const;

/** Patterns that must never appear in the record (Requirement 15 criterion 5). */
const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: 'OpenRouter key', re: /\bsk-or-[A-Za-z0-9-]{10,}/ },
  { name: 'authorization header', re: /\b(?:Bearer|token)\s+[A-Za-z0-9_\-.]{20,}/ },
  { name: 'cookie', re: /\bcookie\s*[:=]\s*\S|\b(?:user_session|_gh_sess|logged_in)\s*=/i },
  // Any github.com/<owner>/<repo> whose names are not the redaction placeholders.
  { name: 'unredacted repository name', re: /github\.com\/(?!<OWNER>\/<REPO>)[^\s/`)]+\/[^\s/`)]+/ },
];

export interface RecordCheck {
  status: 'DEFERRED' | 'COMPLETED' | 'INVALID';
  missing: string[];
  empty: string[];
  forbidden: string[];
}

export function checkRecord(text: string): RecordCheck {
  const statusMatch = /^Status:\s*(\S+)\s*$/m.exec(text);
  const raw = statusMatch?.[1];
  const status = raw === 'DEFERRED' || raw === 'COMPLETED' ? raw : 'INVALID';
  const missing: string[] = [];
  const empty: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    const line = text.split('\n').find((l) => l.startsWith(`- ${field}:`));
    if (line === undefined) {
      missing.push(field);
      continue;
    }
    const value = line.slice(`- ${field}:`.length).trim();
    if (value === '' || value === 'PENDING') empty.push(field);
  }
  const forbidden = FORBIDDEN.filter(({ re }) => re.test(text)).map(({ name }) => name);
  return { status, missing, empty, forbidden };
}

describe('Private_Render_Check record', () => {
  it('exists at the path Requirement 15 names', () => {
    expect(existsSync(recordPath)).toBe(true);
  });

  const text = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : '';
  const result = checkRecord(text);

  it('has a DEFERRED or COMPLETED status line', () => {
    expect(result.status).not.toBe('INVALID');
  });

  it('contains every required field', () => {
    expect(result.missing).toEqual([]);
  });

  it('contains no token, cookie, or private repository name', () => {
    expect(result.forbidden).toEqual([]);
  });

  it('leaves no field empty once completed, and reports deferred without failing', () => {
    if (result.status === 'DEFERRED') {
      console.warn(
        'Private_Render_Check is DEFERRED: tracked follow-up, not a merge or close precondition.',
      );
      return;
    }
    expect(result.empty).toEqual([]);
  });
});

describe('checkRecord', () => {
  const field = (name: string, value: string): string => `- ${name}: ${value}`;
  const completed = (overrides: Record<string, string> = {}): string =>
    [
      'Status: COMPLETED',
      ...REQUIRED_FIELDS.map((f) => field(f, overrides[f] ?? 'ok')),
    ].join('\n');

  it('accepts a DEFERRED status line', () => {
    expect(checkRecord('Status: DEFERRED').status).toBe('DEFERRED');
    expect(checkRecord('Status: PENDING').status).toBe('INVALID');
  });

  it('accepts a fully filled completed record', () => {
    const r = checkRecord(completed());
    expect(r).toEqual({ status: 'COMPLETED', missing: [], empty: [], forbidden: [] });
  });

  it('flags an empty or PENDING field in a completed record', () => {
    expect(checkRecord(completed({ Date: '' })).empty).toEqual(['Date']);
    expect(checkRecord(completed({ Date: 'PENDING' })).empty).toEqual(['Date']);
  });

  it('flags forbidden content', () => {
    const leak = completed({
      'Exact URL form tested': 'https://github.com/acme/secret/raw/x',
      Date: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    });
    expect(checkRecord(leak).forbidden).toEqual(['GitHub token', 'unredacted repository name']);
    expect(checkRecord('Cookie: a=b').forbidden).toContain('cookie');
  });
});
