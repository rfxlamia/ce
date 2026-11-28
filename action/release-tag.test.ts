import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts/release-tag.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'ce-release-tag-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function pkg(version: string): string {
  const dir = mkdtempSync(join(tmp, 'p-'));
  const file = join(dir, 'package.json');
  writeFileSync(file, JSON.stringify({ name: 'continuous-evidence', version }));
  return file;
}

function run(tag: string, version: string) {
  const r = spawnSync(process.execPath, [script, tag, '--package', pkg(version)], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('scripts/release-tag.mjs', () => {
  it('blocks a tag that does not match the package version, naming both', () => {
    const r = run('v0.2.0', '0.1.0');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('v0.2.0');
    expect(r.stderr).toContain('0.1.0');
    expect(r.stdout).toBe('');
  });

  it('prints latest for a matching stable tag', () => {
    const r = run('v0.1.0', '0.1.0');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('latest');
  });

  it('prints next for a matching prerelease tag', () => {
    const r = run('v0.2.0-rc.1', '0.2.0-rc.1');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('next');
  });

  it('rejects a tag without the v prefix', () => {
    expect(run('0.2.0-rc.1', '0.2.0-rc.1').code).toBe(1);
  });

  it('rejects the floating tag v0', () => {
    expect(run('v0', '0.1.0').code).toBe(1);
  });

  it('rejects a tag that only matches the trigger glob (v0.1.0abc)', () => {
    expect(run('v0.1.0abc', '0.1.0').code).toBe(1);
  });

  it('fails when no tag is given', () => {
    const r = spawnSync(process.execPath, [script, '--package', pkg('0.1.0')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
  });
});
