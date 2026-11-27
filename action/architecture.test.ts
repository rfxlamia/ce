import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Architecture test for the Action boundaries.
// Requirements 9.4, 15.10, 15.12.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTION_SRC = path.join(ROOT, 'action', 'src');
const COMMENT_TS = path.join(ROOT, 'packages', 'ce', 'src', 'evidence', 'comment.ts');

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

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

interface Source {
  rel: string;
  code: string;
}

const rel = (file: string): string => path.relative(ROOT, file).split(path.sep).join('/');
const isTestFile = (r: string): boolean =>
  r.endsWith('.test.ts') || r.endsWith('.testsupport.ts') || r.endsWith('arbitraries.ts');

const actionSources: Source[] = walk(ACTION_SRC)
  .map((file) => ({ file, r: rel(file) }))
  .filter(({ r }) => !isTestFile(r))
  .map(({ file, r }) => ({ rel: r, code: stripComments(readFileSync(file, 'utf8')) }));

const commentSource: Source[] = existsSync(COMMENT_TS)
  ? [{ rel: rel(COMMENT_TS), code: stripComments(readFileSync(COMMENT_TS, 'utf8')) }]
  : [];

const scoped: Source[] = [...actionSources, ...commentSource];

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

const isJevSpecifier = (spec: string): boolean => /(^|\/)jev(\/|$)/.test(spec);
const isSdkSpecifier = (spec: string): boolean =>
  spec === '@typesafe-ai/sdk' || spec.startsWith('@typesafe-ai/sdk/');

const LITERAL = '(?:SKIPPED|EVIDENCED|UNSUPPORTED|ERROR)';
const QUOTED = `['"\`]${LITERAL}['"\`]`;
// Assign, return or cast an Outcome literal. A comparison is not matched.
const OUTCOME_LITERAL_USE = new RegExp(
  [
    `\\boutcome\\s*(?::|(?<![=!<>])=(?![=>]))\\s*${QUOTED}`,
    `\\breturn\\s+${QUOTED}`,
    `=>\\s*${QUOTED}`,
    `\\bas\\s+${QUOTED}`,
    `<\\s*${QUOTED}\\s*>`,
  ].join('|'),
);

const FETCH_CALL = /(?<![\w$.])(?:globalThis\s*\.\s*)?fetch\s*\(/;

describe('architecture: action/src and evidence/comment.ts boundaries', () => {
  it('scans action/src and comment.ts', () => {
    expect(actionSources.map((s) => s.rel)).toEqual(
      expect.arrayContaining([
        'action/src/inputs.ts',
        'action/src/cache.ts',
        'action/src/run-dir.ts',
      ]),
    );
    expect(commentSource.map((s) => s.rel)).toEqual(['packages/ce/src/evidence/comment.ts']);
    expect(scoped.some((s) => isTestFile(s.rel))).toBe(false);
  });

  it('import nothing from jev/', () => {
    const offenders = scoped
      .filter((s) => importSpecifiers(s.code).some(isJevSpecifier))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('import no Jev SDK', () => {
    const offenders = scoped
      .filter((s) => importSpecifiers(s.code).some(isSdkSpecifier))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('call no fetch for Jev', () => {
    const offenders = scoped.filter((s) => FETCH_CALL.test(s.code)).map((s) => s.rel);
    expect(offenders).toEqual([]);
    const jevShaped = scoped
      .filter((s) => /data_base64|systemone|openrouter\.ai|typesafe\.(?:ai|com)/i.test(s.code))
      .map((s) => s.rel);
    expect(jevShaped).toEqual([]);
  });

  it('never assign, return or cast an Outcome literal', () => {
    const offenders = scoped.filter((s) => OUTCOME_LITERAL_USE.test(s.code)).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});

describe('architecture: named files import nothing from jev/', () => {
  const named = [
    'action/src/inputs.ts',
    'action/src/cache.ts',
    'action/src/run-dir.ts',
    'packages/ce/src/evidence/comment.ts',
  ];

  it.each(named)('%s exists and has no jev/ import', (file) => {
    const source = scoped.find((s) => s.rel === file);
    expect(source).toBeDefined();
    expect(importSpecifiers(source!.code).filter(isJevSpecifier)).toEqual([]);
  });
});

describe('architecture: checker self-tests', () => {
  it('flags jev and SDK specifiers and a bare fetch call', () => {
    expect(importSpecifiers("import { x } from '../../packages/ce/src/jev/gateway.js';").some(isJevSpecifier)).toBe(true);
    expect(importSpecifiers("import { y } from '@typesafe-ai/sdk';").some(isSdkSpecifier)).toBe(true);
    expect(FETCH_CALL.test('await fetch(url)')).toBe(true);
    expect(FETCH_CALL.test('route.fetch(url)')).toBe(false);
  });

  it('reports an Outcome literal assignment but not a comparison', () => {
    expect(OUTCOME_LITERAL_USE.test("const r = { outcome: 'EVIDENCED' };")).toBe(true);
    expect(OUTCOME_LITERAL_USE.test("if (o.outcome === 'EVIDENCED') {}")).toBe(false);
  });
});
