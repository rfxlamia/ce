import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { extractCandidates, splitProse } from './candidates.js';
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

describe('extractCandidates', () => {
  it('orders sources, keeps --claim unsplit and cli provenance on duplicates', () => {
    const cli = { provider: 'cli' as const, location: '--claim[1]' };
    const r = extractCandidates(
      ctx({
        claims: [{ text: 'Adds a button. Fixes it.', provenance: cli }],
        title: 'Title one.',
        description: 'Adds a button. Fixes it.',
        provenance: [{ provider: 'github', location: 'title' }],
      }),
    );
    expect(r.candidates.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(r.candidates[0]).toMatchObject({ text: 'Adds a button. Fixes it.', provenance: cli });
    expect(r.candidates[1]!.provenance.location).toBe('title');
    expect(r.candidates.map((c) => c.text)).toEqual([
      'Adds a button. Fixes it.',
      'Title one.',
      'Adds a button.',
      'Fixes it.',
    ]);
  });

  it('splits lists, keeps wrapped lines, skips fences, headings, html comments, tables', () => {
    const text = [
      '# Heading',
      'First sentence wraps',
      'over two lines. Second one!',
      '',
      '```',
      'Code. here.',
      '```',
      '<!-- hidden.',
      'still hidden. -->',
      '| a | b |',
      '- item one',
      '  continued',
      '2. item two',
    ].join('\n');
    expect(splitProse(text)).toEqual([
      'First sentence wraps\nover two lines.',
      'Second one!',
      'item one\n  continued',
      'item two',
    ]);
  });

  it('extracts comment lines with exact locations and never splits them', () => {
    const f = file('src/a.ts', [
      'const x = 1;',
      '// First. Second.',
      '/**',
      ' * - not a list item',
      ' */',
      'let y; /* inline */',
    ]);
    const r = extractCandidates(ctx({ files: [f] }));
    expect(r.candidates.map((c) => [c.text, c.provenance.location])).toEqual([
      ['First. Second.', 'src/a.ts:2'],
      ['- not a list item', 'src/a.ts:4'],
    ]);
  });

  it('handles python hash comments and closed docstrings only', () => {
    const f = file('m.py', ['"""', 'Doc line.', '"""', 'x = 1', '# note here', '"""never closed', 'tail']);
    const texts = extractCandidates(ctx({ files: [f] })).candidates.map((c) => c.text);
    expect(texts).toEqual(['Doc line.', 'note here']);
  });

  it('filters directive comments, shebang and license lines', () => {
    const f = file('a.sh', [
      '#!/bin/sh',
      '# eslint-disable-next-line',
      '# noqa',
      '# @ts-expect-error',
      '# @ts-ignore',
      '# Copyright 2025 Example',
      '# real comment',
    ]);
    const r = extractCandidates(ctx({ files: [f] }));
    expect(r.candidates.map((c) => [c.text, c.provenance.location])).toEqual([['real comment', 'a.sh:7']]);
  });

  it('caps at 50 after dedup with a truncation record', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `// c${i % 55}`);
    const r = extractCandidates(ctx({ files: [file('a.js', lines)] }));
    expect(r.candidates).toHaveLength(50);
    expect(r.candidates[49]!.id).toBe('c50');
    expect(r.truncated).toEqual({ file: '<candidates>', reason: 'candidate-cap' });
  });

  it('property: every prose candidate is a substring of its source', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        for (const c of splitProse(s)) {
          expect(s.includes(c)).toBe(true);
          expect(c).toBe(c.trim());
          expect(c).not.toBe('');
        }
      }),
      { numRuns: 100 },
    );
  });
});
