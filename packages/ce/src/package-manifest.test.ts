import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// This file lives in packages/ce/src, so the package root is one level up.
const packageRoot = new URL('../', import.meta.url);
const repoRoot = new URL('../../../', import.meta.url);

type Json = Record<string, unknown>;

const readText = (base: URL, relative: string): string =>
  readFileSync(new URL(relative, base), 'utf8');

const readJson = (base: URL, relative: string): Json =>
  JSON.parse(readText(base, relative)) as Json;

describe('packages/ce package manifest', () => {
  const pkg = readJson(packageRoot, 'package.json');
  const scripts = pkg.scripts as Record<string, string>;

  it('declares repository pointing at the monorepo package directory', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/rfxlamia/ce.git',
      directory: 'packages/ce',
    });
  });

  it('declares homepage and bugs urls', () => {
    expect(pkg.homepage).toBe('https://github.com/rfxlamia/ce#readme');
    expect(pkg.bugs).toEqual({ url: 'https://github.com/rfxlamia/ce/issues' });
  });

  it('declares a non-empty keywords list', () => {
    expect(Array.isArray(pkg.keywords)).toBe(true);
    expect((pkg.keywords as unknown[]).length).toBeGreaterThan(0);
  });

  // The version itself is checked against VERSION by version.staleness.test.ts.
  it('ships only dist', () => {
    expect(pkg.files).toEqual(['dist']);
  });

  it('keeps the ce bin pointing at dist/cli.js', () => {
    // No "./" prefix: npm 11 publish rewrites "./dist/cli.js" to "dist/cli.js"
    // and warns that the bin entry "was invalid and removed".
    expect(pkg.bin).toEqual({ ce: 'dist/cli.js' });
  });

  it('builds with the lean build config', () => {
    expect(scripts.build).toBe('tsc -p tsconfig.build.json');
  });

  it('prepack removes dist and then builds', () => {
    expect(scripts.prepack).toBe(
      "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && npm run build",
    );
  });

  it('keeps typecheck on the full tsconfig so tests stay type-checked', () => {
    expect(scripts.typecheck).toBe('tsc --noEmit');
  });
});

describe('packages/ce tsconfig.build.json', () => {
  it('extends the full tsconfig.json', () => {
    const buildConfig = readJson(packageRoot, 'tsconfig.build.json');
    expect(buildConfig.extends).toBe('./tsconfig.json');
  });

  it.each([
    '**/*.test.ts',
    '**/*.testsupport.ts',
    '**/*arbitraries.ts',
    'src/scripts/**',
  ])('excludes %s', (pattern) => {
    const buildConfig = readJson(packageRoot, 'tsconfig.build.json');
    expect(buildConfig.exclude).toEqual(expect.arrayContaining([pattern]));
  });
});

describe('packages/ce publishable files', () => {
  it('ships a README.md in the package directory', () => {
    expect(existsSync(new URL('README.md', packageRoot))).toBe(true);
  });

  it('ships a LICENSE byte-identical to the root LICENSE', () => {
    const packageLicense = new URL('LICENSE', packageRoot);
    const rootLicense = new URL('LICENSE', repoRoot);

    expect(existsSync(packageLicense)).toBe(true);
    expect(readFileSync(packageLicense).equals(readFileSync(rootLicense))).toBe(true);
  });

  it('starts the CLI entry with a node shebang', () => {
    const firstLine = readText(packageRoot, 'src/cli.ts').split('\n')[0];
    expect(firstLine).toBe('#!/usr/bin/env node');
  });
});
