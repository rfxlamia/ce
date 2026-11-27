import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_KEY_MAP, envNameForPath } from 'continuous-evidence';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'action.yml');

interface Manifest {
  name?: unknown;
  description?: unknown;
  branding?: unknown;
  runs?: { using?: unknown; main?: unknown };
  inputs?: Record<string, { default?: unknown }>;
  outputs?: Record<string, unknown>;
}

const manifest = parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const inputNames = Object.keys(manifest.inputs ?? {});

describe('action.yml manifest', () => {
  it('exists at the repository root (Req 1.1)', () => {
    expect(existsSync(manifestPath)).toBe(true);
  });

  it('declares runs.using node24 (Req 1.2)', () => {
    expect(manifest.runs?.using).toBe('node24');
  });

  it('declares runs.main as an existing file under action/dist (Req 1.3)', () => {
    const main = manifest.runs?.main;
    expect(typeof main).toBe('string');
    expect(String(main).startsWith('action/dist/')).toBe(true);
    expect(existsSync(resolve(repoRoot, String(main)))).toBe(true);
  });

  it('declares name, description and branding (Req 1.4)', () => {
    expect(typeof manifest.name).toBe('string');
    expect(manifest.name).not.toBe('');
    expect(typeof manifest.description).toBe('string');
    expect(manifest.description).not.toBe('');
    expect(manifest.branding).toBeTypeOf('object');
    expect(manifest.branding).not.toBeNull();
  });

  it('declares the five outputs (Req 1.5)', () => {
    expect(Object.keys(manifest.outputs ?? {}).sort()).toEqual(
      ['artifact-url', 'comment-url', 'exit-code', 'outcome', 'run-dir'].sort(),
    );
  });

  it('declares no input that carries a credential (Req 3.9)', () => {
    const credential = /api-?key|secret|password/i;
    expect(inputNames.filter((n) => credential.test(n))).toEqual([]);
    // github-token is the Run_Token input and is allowed.
    expect(inputNames).toContain('github-token');
  });

  it('declares an input for every ENV_KEY_MAP key except version (Req 3.1, 3.8)', () => {
    const mappedBack = new Set(inputNames.map((n) => envNameForPath(n)));
    const missing: string[] = [];
    for (const [envName, path] of ENV_KEY_MAP) {
      if (path === 'version' || path === 'runtime.fixtures') continue;
      if (!mappedBack.has(envName)) missing.push(`${path} (${envName})`);
    }
    expect(missing).toEqual([]);
  });

  it('declares output-dir as an input (Req 3.1, 3.8)', () => {
    expect(inputNames).toContain('output-dir');
  });
});
