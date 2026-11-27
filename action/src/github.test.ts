import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listFilesRecursive } from './github.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ce-list-'));
  dirs.push(d);
  return d;
}

describe('listFilesRecursive', () => {
  it('returns only regular files inside the Run_Dir', () => {
    const outside = tmp();
    writeFileSync(join(outside, 'secret'), 's');
    mkdirSync(join(outside, 'sub'));
    writeFileSync(join(outside, 'sub', 'x'), 'x');
    const run = tmp();
    mkdirSync(join(run, 'a', 'b'), { recursive: true });
    writeFileSync(join(run, 'run.json'), '{}');
    writeFileSync(join(run, 'a', 'b', 'c.txt'), 'c');
    writeFileSync(join(run, '.env'), 'K=v');
    writeFileSync(join(run, '.env.local'), 'K=v');
    mkdirSync(join(run, '.env'.concat('.d')));
    writeFileSync(join(run, '.env.d', 'f'), 'f');
    let linked = true;
    try {
      symlinkSync(join(outside, 'secret'), join(run, 'link-file'));
      symlinkSync(join(outside, 'sub'), join(run, 'link-dir'), 'dir');
      symlinkSync(run, join(run, 'a', 'loop'), 'dir');
    } catch {
      linked = false; // platform cannot create symlinks
    }
    expect(listFilesRecursive(run)).toEqual([join(run, 'a', 'b', 'c.txt'), join(run, 'run.json')]);
    if (!linked) console.warn('symlink cases skipped');
  });

  it('skips a directory named .env', () => {
    const run = tmp();
    mkdirSync(join(run, '.env'));
    writeFileSync(join(run, '.env', 'f'), 'f');
    writeFileSync(join(run, 'ok'), 'ok');
    expect(listFilesRecursive(run)).toEqual([join(run, 'ok')]);
  });

  it('returns empty for a missing dir', () => {
    expect(listFilesRecursive(join(tmp(), 'nope'))).toEqual([]);
  });
});
