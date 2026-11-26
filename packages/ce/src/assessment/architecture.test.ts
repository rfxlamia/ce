import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Architecture test for the assessment/ and eval/ module boundaries.
// Requirements 9.5, 9.6, 9.7, 9.8, 9.9, 14.18, 16.6.

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
const inProperties = (r: string): boolean => r.split('/').includes('properties');

interface Source {
  rel: string;
  /** Source text with comments removed. */
  code: string;
}

// Excluded from every rule: `*.test.ts` and anything under a `properties/` directory.
const sources: Source[] = walk(SRC)
  .map((file) => ({ file, r: rel(file) }))
  .filter(({ r }) => !isTest(r) && !inProperties(r))
  .map(({ file, r }) => {
    const raw = readFileSync(file, 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    return { rel: r, code };
  });

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

const inScope = (r: string): boolean => r.startsWith('assessment/') || r.startsWith('eval/');
const scoped = sources.filter((s) => inScope(s.rel));

describe('architecture: assessment/ and eval/ boundaries', () => {
  it('scans a non-trivial set of source files (eval/ may be absent)', () => {
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((s) => isTest(s.rel))).toBe(false);
    expect(scoped.every((s) => inScope(s.rel))).toBe(true);
  });

  it('(a) does not import outcome/resolve (9.5)', () => {
    const offenders = scoped
      .filter((s) => importSpecifiers(s.code).some((spec) => /outcome\/resolve/.test(spec)))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(b) does not return SKIPPED, EVIDENCED or UNSUPPORTED (9.5)', () => {
    const word = '(?:SKIPPED|EVIDENCED|UNSUPPORTED)';
    const re = new RegExp(
      `\\breturn\\s+['"\`]${word}['"\`]|=>\\s*['"\`]${word}['"\`]|\\boutcome\\s*:\\s*['"\`]${word}['"\`]`,
    );
    const offenders = scoped.filter((s) => re.test(s.code)).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(c) does not import the SDK or the Jev transports (9.6, 9.7)', () => {
    const offenders = scoped
      .filter((s) =>
        importSpecifiers(s.code).some(
          (spec) =>
            spec === '@typesafe-ai/sdk' ||
            spec.startsWith('@typesafe-ai/sdk/') ||
            /jev\/transport-(sdk|json)(\.js)?$/.test(spec),
        ),
      )
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(d) does not call fetch (9.7)', () => {
    const re = /(?<![\w$.])fetch\s*\(|\bglobalThis\.fetch\b/;
    const offenders = scoped.filter((s) => re.test(s.code)).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(e) defines no question text and calls no SDK question helper (9.8, 9.9)', () => {
    const helpers = /(?<![\w$.])(?:noul|choice|score|box|image|withAssets)\s*\(/;
    const questionText = /\bquestion(?:Text)?\s*[:=]\s*['"`]/i;
    const offenders = scoped
      .filter((s) => helpers.test(s.code) || questionText.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});

describe('architecture: environment loading', () => {
  it('process.loadEnvFile appears only in cli.ts (14.18, 16.6)', () => {
    const offenders = sources
      .filter((s) => /\bprocess\s*\.\s*loadEnvFile\b/.test(s.code))
      .map((s) => s.rel)
      .filter((r) => r !== 'cli.ts');
    expect(offenders).toEqual([]);
  });
});
