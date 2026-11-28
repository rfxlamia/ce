// Feature: inline-screenshot-in-pr, Property 8: fallbackNote is total, each note is short, single-line, and unique
// **Validates: Requirements 11.1, 11.2, 11.4, 11.5, 11.7**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classifyGitError, fallbackNote, type FallbackReason } from './fallback.js';

const NUM_RUNS = 100;

const ALL_REASONS: readonly FallbackReason[] = [
  'fork-pr',
  'no-pr-number',
  'no-images',
  'token-lacks-write',
  'push-blocked',
  'push-conflict-exhausted',
  'ref-guard',
  'git-error',
];

describe('Property 8: fallbackNote', () => {
  it('is total, non-empty, single-line, at most 200 code points', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_REASONS), (reason) => {
        const note = fallbackNote(reason);
        expect(typeof note).toBe('string');
        expect(note.length).toBeGreaterThan(0);
        expect(/[\r\n\u2028\u2029]/.test(note)).toBe(false);
        expect([...note].length).toBeLessThanOrEqual(200);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns pairwise distinct notes for the eight reasons', () => {
    const notes = ALL_REASONS.map((r) => fallbackNote(r));
    expect(new Set(notes).size).toBe(ALL_REASONS.length);
  });

  it('contains no URL or token-shaped text', () => {
    for (const reason of ALL_REASONS) {
      const note = fallbackNote(reason);
      expect(note).not.toMatch(/https?:\/\//i);
      expect(note).not.toMatch(/x-access-token|authorization|ghp_|ghs_/i);
    }
  });

  it('keeps the fixed fork note and names contents: write for the token note', () => {
    expect(fallbackNote('fork-pr')).toBe('publish skipped: fork PR');
    expect(fallbackNote('token-lacks-write')).toContain('contents: write');
  });
});

describe('classifyGitError', () => {
  const cases: Array<[string, unknown, FallbackReason]> = [
    [
      'protected branch',
      { message: 'git push failed', stderr: 'remote: error: GH006: Protected branch update failed for refs/heads/ce-evidence.' },
      'push-blocked',
    ],
    [
      'ruleset',
      { stderr: 'remote: error: GH013: Repository rule violations found for refs/heads/ce-evidence.' },
      'push-blocked',
    ],
    ['hook declined', { stderr: ' ! [remote rejected] x -> ce-evidence (pre-receive hook declined)' }, 'push-blocked'],
    ['Permission denied', { stderr: 'remote: Permission to o/r.git denied to x-access-token.' }, 'token-lacks-write'],
    ['Permission denied text', new Error('Permission denied (publickey)'), 'token-lacks-write'],
    ['403', { stderr: 'fatal: unable to access: The requested URL returned error: 403' }, 'token-lacks-write'],
    ['nested result stderr', { result: { stderr: 'error: 403' } }, 'token-lacks-write'],
    ['generic', new Error('something odd happened'), 'git-error'],
    ['string error', 'boom', 'git-error'],
    ['null', null, 'git-error'],
    ['undefined', undefined, 'git-error'],
    ['number', 42, 'git-error'],
    ['non-fast-forward is not classified', { stderr: ' ! [rejected] a -> ce-evidence (non-fast-forward)' }, 'git-error'],
  ];

  for (const [name, error, expected] of cases) {
    it(`maps ${name} to ${expected}`, () => {
      expect(classifyGitError(error)).toBe(expected);
    });
  }

  it('never throws on a hostile object and falls back to git-error', () => {
    const hostile = {
      get message(): string {
        throw new Error('getter exploded');
      },
    };
    expect(() => classifyGitError(hostile)).not.toThrow();
    expect(classifyGitError(hostile)).toBe('git-error');
  });

  it('never throws for arbitrary input and always returns a known reason', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const reason = classifyGitError(value);
        expect(ALL_REASONS).toContain(reason);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('result carries no raw error text in the note', () => {
    const secret = 'ghp_SECRETVALUE123';
    const reason = classifyGitError({ stderr: `remote: Permission denied for ${secret}` });
    expect(fallbackNote(reason)).not.toContain(secret);
  });
});
