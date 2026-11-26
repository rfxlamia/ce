import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Architecture test for the outcome/ module boundaries.
// Requirements 1.5, 1.6, 1.7, 10.3, 10.4, 11.3.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');
const isTest = (r: string): boolean => r.endsWith('.test.ts');
const isTestOnly = (r: string): boolean => r === 'outcome/arbitraries.ts';

interface Source {
  rel: string;
  /** Source text with comments removed. */
  code: string;
}

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

// Excluded from every rule: `*.test.ts` and the test-only `outcome/arbitraries.ts`.
const sources: Source[] = walk(SRC)
  .map((file) => ({ file, r: rel(file) }))
  .filter(({ r }) => !isTest(r) && !isTestOnly(r))
  .map(({ file, r }) => ({ rel: r, code: stripComments(readFileSync(file, 'utf8')) }));

function importSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) specs.push(m[1]!);
  return specs;
}

/** Specifiers of `import`/`export ... from` statements that are not `import type` / `export type`. */
function valueImportSpecifiers(code: string): string[] {
  const specs: string[] = [];
  for (const m of code.matchAll(/\b(?:import|export)\b([^'";]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    if (!/^\s*type\b/.test(m[1]!)) specs.push(m[2]!);
  }
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(m[1]!);
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  for (const m of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  return specs;
}

const LITERAL = '(?:SKIPPED|EVIDENCED|UNSUPPORTED|ERROR)';
const QUOTED = `['"\`]${LITERAL}['"\`]`;
// Assign (`outcome: 'X'`, `outcome = 'X'`), return (`return 'X'`, `=> 'X'`) or cast (`as 'X'`, `<'X'>`).
// A comparison such as `outcome === 'X'` is not matched.
const OUTCOME_LITERAL_USE = new RegExp(
  [
    `\\boutcome\\s*(?::|(?<![=!<>])=(?![=>]))\\s*${QUOTED}`,
    `\\breturn\\s+${QUOTED}`,
    `=>\\s*${QUOTED}`,
    `\\bas\\s+${QUOTED}`,
    `<\\s*${QUOTED}\\s*>`,
  ].join('|'),
);

const inOutcome = (r: string): boolean => r.startsWith('outcome/');
const scoped = sources.filter((s) => inOutcome(s.rel));

const FORBIDDEN_SPECIFIER = (spec: string): boolean =>
  spec === 'node:fs' ||
  spec === 'fs' ||
  spec === 'node:child_process' ||
  spec === 'child_process' ||
  spec === 'node:http' ||
  spec === 'node:https' ||
  spec === 'playwright' ||
  spec.startsWith('playwright/') ||
  spec === '@typesafe-ai/sdk' ||
  spec.startsWith('@typesafe-ai/sdk/') ||
  /(^|\/)jev(\/|$)/.test(spec) ||
  /(^|\/)runtime(\/|$)/.test(spec);

const TYPE_ONLY_TARGET = (spec: string): boolean =>
  /(^|\/)assessment(\/|$)/.test(spec) ||
  /(^|\/)context(\/|$)/.test(spec) ||
  /(^|\/)errors(\.js)?$/.test(spec);

describe('architecture: outcome/ boundaries', () => {
  it('scans a non-trivial set of source files', () => {
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((s) => isTest(s.rel) || isTestOnly(s.rel))).toBe(false);
    expect(scoped.map((s) => s.rel)).toEqual(
      expect.arrayContaining(['outcome/resolve.ts', 'outcome/types.ts']),
    );
    expect(scoped.every((s) => inOutcome(s.rel))).toBe(true);
  });

  it('(a) imports no fs, child_process, http, https, playwright, SDK, jev/ or runtime/ (1.5, 11.3)', () => {
    const offenders = scoped
      .filter((s) => importSpecifiers(s.code).some(FORBIDDEN_SPECIFIER))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(b) uses no process.env, Date, Math.random or performance (1.5)', () => {
    const re = /\bprocess\s*\.\s*env\b|\bDate\b|\bMath\s*\.\s*random\b|\bperformance\b/;
    const offenders = scoped.filter((s) => re.test(s.code)).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(c) every import from assessment/, context/ or errors.ts is type-only (1.6, 11.3)', () => {
    const offenders = scoped
      .filter((s) => valueImportSpecifiers(s.code).some(TYPE_ONLY_TARGET))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});

describe('architecture: Outcome literals across src/', () => {
  it('(d) only outcome/resolve.ts assigns, returns or casts to an Outcome literal (1.7, 10.3, 10.4)', () => {
    const offenders = sources
      .filter((s) => s.rel !== 'outcome/resolve.ts')
      .filter((s) => OUTCOME_LITERAL_USE.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(e) outcome/resolve.ts is detected as the one deciding file', () => {
    const resolve = sources.find((s) => s.rel === 'outcome/resolve.ts');
    expect(resolve).toBeDefined();
    expect(OUTCOME_LITERAL_USE.test(resolve!.code)).toBe(true);
  });

  it("(f) outcome/types.ts holds the literals only in OUTCOMES (1.7)", () => {
    const types = sources.find((s) => s.rel === 'outcome/types.ts');
    expect(types).toBeDefined();
    expect(types!.code).toMatch(/OUTCOMES\s*=\s*\[[^\]]*SKIPPED[^\]]*\]\s*as const/);
    const withoutOutcomes = types!.code.replace(/export const OUTCOMES\s*=\s*\[[^\]]*\]\s*as const;?/, '');
    expect(new RegExp(QUOTED).test(withoutOutcomes)).toBe(false);
  });
});

describe('architecture: checker self-tests', () => {
  it('does not report a comparison against an Outcome literal', () => {
    const code = stripComments(
      "if (resolution.outcome === 'EVIDENCED') { run(); }\n" +
        "const bad = resolution.outcome !== 'ERROR';\n" +
        "const ok = (r: { outcome: string }) => r.outcome === 'SKIPPED';\n",
    );
    expect(OUTCOME_LITERAL_USE.test(code)).toBe(false);
  });

  it.each([
    ["const r = { outcome: 'EVIDENCED' };"],
    ["let x; x.outcome = 'SKIPPED';"],
    ["function f() { return 'UNSUPPORTED'; }"],
    ["const f = () => 'ERROR';"],
    ["const o = value as 'EVIDENCED';"],
  ])('reports an assignment, return or cast: %s', (snippet) => {
    expect(OUTCOME_LITERAL_USE.test(snippet)).toBe(true);
  });

  it('flags a value import and accepts a type import from errors.ts', () => {
    expect(valueImportSpecifiers("import { StageError } from '../errors.js';")).toEqual([
      '../errors.js',
    ]);
    expect(valueImportSpecifiers("import type { StageError } from '../errors.js';")).toEqual([]);
  });
});
