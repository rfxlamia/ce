import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileGlob, matchesAny, matchesGlob } from './glob.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('matchesGlob examples', () => {
  const table: Array<[pattern: string, input: string, expected: boolean]> = [
    // `*` does not cross `/`
    ['a/*.ts', 'a/b.ts', true],
    ['a/*.ts', 'a/b/c.ts', false],
    ['a/*.ts', 'a/.ts', true],
    ['a/*.ts', 'xa/b.ts', false],
    ['a/*.ts', 'a/b.tsx', false],
    // `**` crosses `/`, including inside a segment
    ['a/**.ts', 'a/b.ts', true],
    ['a/**.ts', 'a/b/c.ts', true],
    ['a/**.ts', 'a/b/c.js', false],
    ['a/**/c.ts', 'a/c.ts', true],
    ['a/**/c.ts', 'a/b/x/c.ts', true],
    ['**/c.ts', 'c.ts', true],
    // literal `?`
    ['a/?.ts', 'a/b.ts', false],
    ['a/?.ts', 'a/?.ts', true],
    // literal `[`
    ['a/[b].ts', 'a/b.ts', false],
    ['a/[b].ts', 'a/[b].ts', true],
    // literal `{`
    ['a/{b,c}.ts', 'a/b.ts', false],
    ['a/{b,c}.ts', 'a/{b,c}.ts', true],
    // other regex metacharacters are literal
    ['a.b', 'axb', false],
    ['a+b', 'a+b', true],
    ['(a)|b', '(a)|b', true],
    ['(a)|b', 'b', false],
    // anchored full-string match
    ['a', 'a/b', false],
    ['b', 'a/b', false],
  ];

  it.each(table)('%s vs %s -> %s', (pattern, input, expected) => {
    expect(matchesGlob(pattern, input)).toBe(expected);
  });

  it('compileGlob returns an anchored RegExp', () => {
    const re = compileGlob('a/*.ts');
    expect(re).toBeInstanceOf(RegExp);
    expect(re.source.startsWith('^')).toBe(true);
    expect(re.source.endsWith('$')).toBe(true);
  });

  it('matchesAny is true when any pattern matches', () => {
    expect(matchesAny(['x/*.ts', 'a/*.ts'], 'a/b.ts')).toBe(true);
    expect(matchesAny(['x/*.ts', 'y/*.ts'], 'a/b.ts')).toBe(false);
    expect(matchesAny([], 'a/b.ts')).toBe(false);
  });
});

describe('context.checks uses this matcher, not fs.glob', () => {
  it('glob.ts imports no fs module and calls no glob function', () => {
    const source = readFileSync(path.join(here, 'glob.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/from\s+['"](?:node:)?fs(?:\/promises)?['"]/);
    expect(code).not.toMatch(/require\(\s*['"](?:node:)?fs/);
    expect(code).not.toMatch(/\bglob(?:Sync)?\s*\(/);
  });

  it('treats fs.glob wildcards as literals, so a checks pattern behaves differently', () => {
    // fs.glob would read `?`, `[..]` and `{..}` as wildcards; this matcher must not.
    expect(matchesGlob('reports/junit-?.xml', 'reports/junit-1.xml')).toBe(false);
    expect(matchesGlob('reports/junit-[0-9].xml', 'reports/junit-1.xml')).toBe(false);
    expect(matchesGlob('reports/{a,b}.xml', 'reports/a.xml')).toBe(false);
    expect(matchesGlob('reports/*.xml', 'reports/junit.xml')).toBe(true);
    expect(matchesGlob('reports/*.xml', 'reports/nested/junit.xml')).toBe(false);
  });
});
