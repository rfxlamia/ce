// Source scan. Reads apps/site/src/, apps/site/index.html and the dependency
// fields of apps/site/package.json. This file lives under tests/, so it is not
// part of the scanned set.
// Validates: Requirements 1.14, 2.1-2.5, 8.5, 10.1-10.4, 13.5.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(SITE, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

interface Scanned {
  path: string;
  rel: string;
  text: string;
}

const read = (p: string): Scanned => ({
  path: p,
  rel: relative(SITE, p).split('\\').join('/'),
  text: readFileSync(p, 'utf8'),
});

const srcFiles = walk(SRC).map(read);
const indexHtml = read(join(SITE, 'index.html'));
const scanned = [...srcFiles, indexHtml];
const codeFiles = srcFiles.filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f.rel));

/** Module specifiers: from '...', bare import '...', import('...'), require('...'). */
function specifiers(text: string): string[] {
  const re =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[2] as string);
  return out;
}

function offenders(files: Scanned[], re: RegExp): string[] {
  return files.filter((f) => re.test(f.text)).map((f) => f.rel);
}

function expectNone(files: Scanned[], re: RegExp, what: string): void {
  const bad = offenders(files, re);
  expect(bad, `${what} found in: ${bad.join(', ')}`).toEqual([]);
}

describe('source scan', () => {
  it('scans a non-empty set of files', () => {
    expect(srcFiles.length).toBeGreaterThan(0);
    expect(srcFiles.every((f) => !f.rel.startsWith('tests/'))).toBe(true);
  });

  it('imports only react, react-dom and relative paths (R1.14, R2.1)', () => {
    const allowed = (s: string) =>
      s === 'react' ||
      s === 'react/jsx-runtime' ||
      s === 'react-dom' ||
      s === 'react-dom/client' ||
      s.startsWith('./') ||
      s.startsWith('../');
    const bad: string[] = [];
    for (const f of codeFiles) {
      for (const s of specifiers(f.text)) {
        if (!allowed(s)) bad.push(`${f.rel}: ${s}`);
      }
    }
    expect(bad, `disallowed imports: ${bad.join('; ')}`).toEqual([]);
  });

  it('does not reference CE packages or paths (R2.1, R2.4)', () => {
    expectNone(
      scanned,
      /continuous-evidence|packages\/ce|\baction\/|@ce\//i,
      'CE reference',
    );
  });

  it('has no test hooks (R2.2)', () => {
    expectNone(scanned, /\bdata-(testid|test|cy|ce)\b/i, 'test hook attribute');
  });

  it('has no inline style (R10.3)', () => {
    expectNone(scanned, /\bstyle\s*=/, 'style attribute');
    expectNone(scanned, /<style[\s>]/i, '<style> element');
    expectNone(
      codeFiles,
      /\.style\b|setAttribute\(\s*['"]style['"]/,
      'DOM style assignment',
    );
  });

  it('has no autoFocus, focus-trap or Escape handler code (R8.5)', () => {
    expectNone(codeFiles, /autoFocus/i, 'autoFocus');
    expectNone(codeFiles, /focus-?trap/i, 'focus trap');
    expectNone(
      codeFiles,
      /['"`]Escape['"`]|['"`]Esc['"`]|\bkeyCode\s*(?:===?|:)\s*27\b|\bonCancel\b/,
      'Escape handler',
    );
  });

  it('has no ::backdrop rule (R8.5, R10.1)', () => {
    expectNone(scanned, /::backdrop/, '::backdrop');
  });

  it('loads no third-party http(s) resource (R10.4)', () => {
    const re = /https?:\/\/(?!(?:localhost|127\.0\.0\.1)(?:[:/\s'"`]|$))[^\s'"`)]+/gi;
    const bad: string[] = [];
    for (const f of scanned) {
      for (const m of f.text.matchAll(re)) bad.push(`${f.rel}: ${m[0]}`);
    }
    expect(bad, `third-party URLs: ${bad.join('; ')}`).toEqual([]);
  });

  it('declares exactly react and react-dom as runtime dependencies (R1.4)', () => {
    const pkgPath = join(SITE, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    expect(
      Object.keys(pkg.dependencies ?? {}).sort(),
      `dependencies in ${relative(SITE, pkgPath)}`,
    ).toEqual(['react', 'react-dom']);
    for (const field of [
      'peerDependencies',
      'optionalDependencies',
      'bundledDependencies',
    ]) {
      expect(
        Object.keys(pkg[field] ?? {}),
        `${field} in package.json`,
      ).toEqual([]);
    }
    const all = JSON.stringify([
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    ]);
    expect(all, 'package.json dependency fields').not.toMatch(
      /continuous-evidence|@ce\/|packages\/ce|action\//i,
    );
  });
});
