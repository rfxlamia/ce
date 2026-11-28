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
    // token and github-token are the Run_Token inputs, and default-token carries github.token.
    expect(inputNames).toContain('token');
    expect(inputNames).toContain('github-token');
    expect(inputNames).toContain('default-token');
  });

  it('declares token and github-token with an empty default, and default-token with github.token (inline-screenshot Req 1.3)', () => {
    expect(manifest.inputs?.token?.default).toBe('');
    expect(manifest.inputs?.['github-token']?.default).toBe('');
    expect(manifest.inputs?.['default-token']?.default).toBe('${{ github.token }}');
  });

  it('declares publish with an empty default (effective default none), and the two cap inputs (inline-screenshot Req 1.1, 8.2, 8.3)', () => {
    expect(manifest.inputs?.publish?.default).toBe('');
    expect(inputNames).toContain('publish-max-images');
    expect(inputNames).toContain('publish-max-image-bytes');
  });

  it('does not describe publish: branch as not implemented (inline-screenshot Req 2.1)', () => {
    expect(readFileSync(manifestPath, 'utf8')).not.toMatch(/not implemented/i);
  });

  it('declares an input of the same name for every scalar top-level ConfigSchema key, including publish (inline-screenshot Req 1.8)', () => {
    const schema = JSON.parse(readFileSync(resolve(repoRoot, 'schemas/ce.schema.json'), 'utf8')) as {
      properties: Record<string, { type?: string }>;
    };
    const scalarKeys = Object.entries(schema.properties)
      .filter(([key, value]) => key !== 'version' && value.type !== 'object')
      .map(([key]) => key);
    expect(scalarKeys).toContain('publish');
    expect(inputNames.filter((n) => scalarKeys.includes(n)).sort()).toEqual([...scalarKeys].sort());
  });

  it('declares an input for every ENV_KEY_MAP key except version (Req 3.1, 3.8)', () => {
    // default-token is internal and is not a ConfigSchema key (inline-screenshot Req 1.8).
    const internalExemptions = new Set(['default-token']);
    const mappedBack = new Set(
      inputNames.filter((n) => !internalExemptions.has(n)).map((n) => envNameForPath(n)),
    );
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
