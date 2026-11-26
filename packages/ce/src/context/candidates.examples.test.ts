import { describe, expect, it } from 'vitest';
import { extractCandidates } from './candidates.js';
import type { BudgetedChangeContext, ChangedFile } from './types.js';

const gitProv = { provider: 'git' as const };

function ctx(over: Partial<BudgetedChangeContext['change']> = {}): BudgetedChangeContext {
  return {
    change: { files: [], commits: [], claims: [], provenance: [], ...over },
    checks: [],
    truncated: [],
    providers: [],
    redactions: [],
  };
}

function file(path: string, added: string[], start = 1): ChangedFile {
  const patch = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +${start},${added.length} @@`,
    ...added.map((l) => `+${l}`),
  ].join('\n');
  return { path, status: 'added', patch, provenance: gitProv };
}

const texts = (c: BudgetedChangeContext): string[] => extractCandidates(c).candidates.map((x) => x.text);

describe('candidate extraction examples', () => {
  it('72-column wrapped commit message gives one candidate per sentence (9.7)', () => {
    const message = [
      'Add the retry button to the checkout page so users can',
      'retry a failed payment. Fix the spinner that never stops',
      'spinning on slow networks.',
    ].join('\n');
    for (const l of message.split('\n')) expect(l.length).toBeLessThanOrEqual(72);
    const r = extractCandidates(
      ctx({ commits: [{ sha: 'abc', message, provenance: { provider: 'git', location: 'abc' } }] }),
    );
    expect(r.candidates.map((c) => c.text)).toEqual([
      'Add the retry button to the checkout page so users can\nretry a failed payment.',
      'Fix the spinner that never stops\nspinning on slow networks.',
    ]);
    expect(r.candidates.every((c) => c.provenance.location === 'abc')).toBe(true);
  });

  it('block comment with * continuations yields no list items and exact path:line (9.8, 11.12)', () => {
    const f = file(
      'src/a.ts',
      ['const x = 1;', '/**', ' * - not a list item', ' * Retries on failure.', ' */', 'const y = 2;'],
      10,
    );
    const r = extractCandidates(ctx({ files: [f] }));
    expect(r.candidates.map((c) => c.text)).toEqual(['- not a list item', 'Retries on failure.']);
    expect(r.candidates.map((c) => c.provenance.location)).toEqual(['src/a.ts:12', 'src/a.ts:13']);
    expect(r.candidates.every((c) => c.provenance.provider === 'git')).toBe(true);
  });

  it('HTML comment in a Markdown diff is a candidate, in the description it is not (9.9, 9.10)', () => {
    const md = file('docs/a.md', ['Intro', '<!-- Document the new flag. -->']);
    expect(texts(ctx({ files: [md] }))).toEqual(['Document the new flag.']);
    expect(
      texts(ctx({ description: '<!-- Document the new flag. -->\nReal sentence.' })),
    ).toEqual(['Real sentence.']);
  });

  it('Directive_Comments give no candidate, ordinary neighbor does (9.14, 9.15)', () => {
    const cases: [string, string[]][] = [
      ['src/a.ts', ['// eslint-disable-next-line no-console', '// Ordinary neighbor.']],
      ['src/a.py', ['# noqa: E501', '# Ordinary neighbor.']],
      ['src/b.ts', ['// @ts-expect-error', '// Ordinary neighbor.']],
      ['src/c.ts', ['// @ts-ignore', '// Ordinary neighbor.']],
      ['run.sh', ['#!/bin/sh', '# Ordinary neighbor.']],
      ['src/d.ts', ['// Copyright 2025 Example', '// Ordinary neighbor.']],
    ];
    for (const [path, lines] of cases) {
      const r = extractCandidates(ctx({ files: [file(path, lines)] }));
      expect(r.candidates.map((c) => c.text), path).toEqual(['Ordinary neighbor.']);
      expect(r.candidates[0]!.provenance.location, path).toBe(`${path}:2`);
    }
  });

  it('--claim text keeps provider cli (11.17, 11.25)', () => {
    const cli = { provider: 'cli' as const, location: '--claim[1]' };
    const r = extractCandidates(ctx({ claims: [{ text: 'Adds a button. Fixes it.', provenance: cli }] }));
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ text: 'Adds a button. Fixes it.', provenance: cli });
  });
});
