import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Requirement 17 criterion 5: every requirement number cited in the
// "Issue checklist traceability" table must exist in requirements.md.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requirementsPath = resolve(
  repoRoot,
  '.kiro/specs/inline-screenshot-in-pr/requirements.md',
);

/** Numbers of every `### Requirement N:` heading. */
export function definedRequirements(text: string): Set<number> {
  const numbers = new Set<number>();
  for (const m of text.matchAll(/^### Requirement (\d+):/gm)) numbers.add(Number(m[1]));
  return numbers;
}

export interface TraceRow {
  item: string;
  /** Requirement numbers cited by the row (second column, ranges expanded, plus inline `Requirement N` mentions). */
  cited: number[];
}

/** Parses the rows of the "Issue checklist traceability" table. */
export function parseTraceability(text: string): TraceRow[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^###\s+Issue checklist traceability\s*$/.test(l));
  if (start < 0) throw new Error('Issue checklist traceability section not found');
  const rows: TraceRow[] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.trim().startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    // Split on unescaped pipes only (`\|` appears inside item text).
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    if (cells.every((c) => /^-+$/.test(c))) continue;
    if (cells[0] === 'Issue item') continue;
    const item = cells[0] ?? '';
    const cited = new Set<number>();
    const col2 = cells[1] ?? '';
    for (const m of col2.matchAll(/(\d+)\s+to\s+(\d+)/g)) {
      for (let n = Number(m[1]); n <= Number(m[2]); n++) cited.add(n);
    }
    for (const m of col2.replace(/(\d+)\s+to\s+(\d+)/g, '').matchAll(/\d+/g)) cited.add(Number(m[0]));
    for (const m of item.matchAll(/Requirement (\d+)(?:\.\d+)?/g)) cited.add(Number(m[1]));
    rows.push({ item, cited: [...cited].sort((a, b) => a - b) });
  }
  return rows;
}

/** Returns `{ item, requirement }` for every cited number that has no heading. */
export function findMissing(text: string): { item: string; requirement: number }[] {
  const defined = definedRequirements(text);
  return parseTraceability(text).flatMap((row) =>
    row.cited.filter((n) => !defined.has(n)).map((n) => ({ item: row.item, requirement: n })),
  );
}

describe('requirements.md traceability table', () => {
  const text = readFileSync(requirementsPath, 'utf8');

  it('has requirement headings and table rows to check', () => {
    expect(definedRequirements(text).size).toBeGreaterThan(0);
    const rows = parseTraceability(text);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.cited.length, row.item).toBeGreaterThan(0);
  });

  it('cites only requirement numbers that exist', () => {
    expect(findMissing(text)).toEqual([]);
  });

  it('detects a cited requirement number that does not exist', () => {
    const doc = [
      '### Requirement 1: A',
      '### Requirement 2: B',
      '### Issue checklist traceability',
      '',
      '| Issue item | Requirements |',
      '| --- | --- |',
      '| ok item | 1, 2 |',
      '| range item | 1 to 3 |',
      '| inline item (Requirement 9.1) | 2 |',
    ].join('\n');
    expect(findMissing(doc)).toEqual([
      { item: 'range item', requirement: 3 },
      { item: 'inline item (Requirement 9.1)', requirement: 9 },
    ]);
  });
});
