import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Architecture test for the module boundaries of the Jev gateway.
// Requirements 3.7, 3.8, 13.1, 13.2, 13.3, 13.4, 13.6, 13.8, 13.9, 14.3, 14.6.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON = path.resolve(SRC, '..', 'package.json');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');

const allFiles = walk(SRC);
const isTest = (r: string): boolean => r.endsWith('.test.ts');
const inProperties = (r: string): boolean => r.split('/').includes('properties');

interface Source {
  rel: string;
  /** Source text with comments removed. */
  code: string;
  raw: string;
}

// Excluded from every rule: `*.test.ts` and anything under a `properties/` directory.
const sources: Source[] = allFiles
  .map((file) => ({ file, r: rel(file) }))
  .filter(({ r }) => !isTest(r) && !inProperties(r))
  .map(({ file, r }) => {
    const raw = readFileSync(file, 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    return { rel: r, code, raw };
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

const inJev = (r: string): boolean => r.startsWith('jev/');
const isNodeBuiltin = (spec: string): boolean =>
  spec.startsWith('node:') || builtinModules.includes(spec);

/** Matches a call `name(` that is not a method call or part of a longer identifier. */
const callPattern = (names: string[]): RegExp =>
  new RegExp(`(?<![\\w$.])(?:${names.join('|')})\\s*\\(`);

describe('architecture: Jev module boundaries', () => {
  it('scans a non-trivial set of source files', () => {
    expect(sources.some((s) => s.rel === 'jev/gateway.ts')).toBe(true);
    expect(sources.some((s) => s.rel === 'jev/catalog.ts')).toBe(true);
    expect(sources.some((s) => s.rel === 'scripts/verify-jev-image.ts')).toBe(true);
    expect(sources.some((s) => isTest(s.rel))).toBe(false);
  });

  it('(a) only files under jev/ import @typesafe-ai/sdk (13.1)', () => {
    const offenders = sources
      .filter((s) => !inJev(s.rel))
      .filter((s) =>
        importSpecifiers(s.code).some(
          (spec) => spec === '@typesafe-ai/sdk' || spec.startsWith('@typesafe-ai/sdk/'),
        ),
      )
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(b) only jev/catalog.ts calls the SDK question helpers (3.7, 6.14)', () => {
    const re = callPattern(['noul', 'choice', 'score', 'box', 'image', 'withAssets']);
    const offenders = sources
      .filter((s) => s.rel !== 'jev/catalog.ts')
      .filter((s) => re.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(c) within jev/, only transport-json.ts calls fetch (13.2)', () => {
    const re = /(?<![\w$.])fetch\s*\(|\bglobalThis\.fetch\s*\(/;
    const offenders = sources
      .filter((s) => inJev(s.rel) && s.rel !== 'jev/transport-json.ts')
      .filter((s) => re.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(d) nothing under jev/ imports outcome/resolve', () => {
    const offenders = sources
      .filter((s) => inJev(s.rel))
      .filter((s) => importSpecifiers(s.code).some((spec) => /outcome\/resolve/.test(spec)))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(e) scripts import only jev/probe and Node built-ins (14.6)', () => {
    // Allowed exceptions, per file:
    // - update-catalog-snapshot.ts also imports jev/catalog (task 4.2).
    // - generate-config-schema.ts belongs to the config module and imports config/json-schema.
    //   It predates this rule and does not touch the gateway; it is listed here so the rule
    //   stays strict for every other script, including the Verification_Script.
    const extraAllowed: Record<string, RegExp[]> = {
      'scripts/update-catalog-snapshot.ts': [/^\.\.\/jev\/catalog(\.js)?$/],
      'scripts/generate-config-schema.ts': [/^\.\.\/config\/json-schema(\.js)?$/],
    };
    const probeSpec = /^\.\.\/jev\/probe(\.js)?$/;
    const violations: string[] = [];
    for (const s of sources.filter((x) => x.rel.startsWith('scripts/'))) {
      for (const spec of importSpecifiers(s.code)) {
        const ok =
          isNodeBuiltin(spec) ||
          probeSpec.test(spec) ||
          (extraAllowed[s.rel] ?? []).some((re) => re.test(spec));
        if (!ok) violations.push(`${s.rel} imports ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('(f) files outside jev/ do not import the transports (13.2, 13.5)', () => {
    const offenders = sources
      .filter((s) => !inJev(s.rel))
      .filter((s) =>
        importSpecifiers(s.code).some((spec) => /jev\/transport-(sdk|json)(\.js)?$/.test(spec)),
      )
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});

describe('architecture: further rules', () => {
  it('jev/gateway.ts carries the exit-plan header comment (13.4)', () => {
    const raw = readFileSync(path.join(SRC, 'jev/gateway.ts'), 'utf8');
    const header = raw.slice(0, raw.indexOf('*/') + 2);
    expect(header.startsWith('/**')).toBe(true);
    expect(header).toMatch(/exit plan/i);
    expect(header).toMatch(/transport-json\.ts/);
    expect(header).toMatch(/SDK transport/);
    expect(header).toMatch(/JevGateway/);
  });

  it('package.json pins @typesafe-ai/sdk exactly at 0.7.0 (13.6)', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@typesafe-ai/sdk']).toBe('0.7.0');
  });

  it('does not inject a custom fetch into the SDK client (13.3)', () => {
    const sdk = sources.find((s) => s.rel === 'jev/transport-sdk.ts')!;
    expect(sdk.code).not.toMatch(/new\s+TypeSafeClient\s*\(\s*\{[^}]*\bfetch\b/);
  });

  it('files in jev/ write files only through the call log and never read Git (13.9)', () => {
    const fsWrite =
      /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync)\b/;
    const fsImport = /^(node:)?fs(\/promises)?$/;
    const gitLike = /^(node:)?child_process$|^simple-git$|^isomorphic-git$|^nodegit$/;
    const writers: string[] = [];
    const gitReaders: string[] = [];
    for (const s of sources.filter((x) => inJev(x.rel))) {
      const specs = importSpecifiers(s.code);
      if (s.rel !== 'jev/log.ts' && (specs.some((p) => fsImport.test(p)) || fsWrite.test(s.code))) {
        writers.push(s.rel);
      }
      if (specs.some((p) => gitLike.test(p)) || /['"`]\.git\b|\bgit\s+(log|diff|show|rev-parse)\b/.test(s.code)) {
        gitReaders.push(s.rel);
      }
    }
    expect(writers).toEqual([]);
    expect(gitReaders).toEqual([]);
  });

  it('the Verification_Script does not call fetch itself (14.6)', () => {
    const script = sources.find((s) => s.rel === 'scripts/verify-jev-image.ts')!;
    expect(script.code).not.toMatch(/(?<![\w$.])fetch\s*\(|\bglobalThis\.fetch\b/);
  });

  it('no test file imports the Verification_Script (14.3)', () => {
    // Property tests are scanned too; only this file is skipped because it names the script.
    const needle = ['scripts', 'verify-jev-image'].join('/');
    const self = rel(fileURLToPath(import.meta.url));
    const offenders = allFiles
      .map((f) => rel(f))
      .filter((r) => isTest(r) || inProperties(r))
      .filter((r) => r !== self)
      .filter((r) => {
        const text = readFileSync(path.join(SRC, r), 'utf8');
        return importSpecifiers(text).some((spec) => spec.includes(needle) || /(^|\/)verify-jev-image(\.js)?$/.test(spec));
      });
    expect(offenders).toEqual([]);
  });

  it('jev/probe.ts imports no outcome module and no module outside jev/ except errors (14.6)', () => {
    const probe = sources.find((s) => s.rel === 'jev/probe.ts')!;
    const external = importSpecifiers(probe.code).filter(
      (spec) => spec.startsWith('..') && !/^\.\.\/errors(\.js)?$/.test(spec),
    );
    expect(external).toEqual([]);
  });
});
