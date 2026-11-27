import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listEntries,
  pickNewRunDir,
  readRunRecord,
  resolveEffectiveOutputDir,
} from './run-dir.js';
import { skippedRunRecordArb } from '../../packages/ce/src/evidence/arbitraries.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ce-run-dir-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeRun(dir: string, name: string, seconds: number): void {
  mkdirSync(join(dir, name), { recursive: true });
  utimesSync(join(dir, name), seconds, seconds);
}

describe('pickNewRunDir', () => {
  it('returns undefined when no entry is new (zero)', () => {
    const dir = join(root, 'runs');
    makeRun(dir, 'a', 100);
    const before = listEntries(dir);
    expect(pickNewRunDir(dir, before, listEntries(dir))).toBeUndefined();
  });

  it('returns undefined when the directory does not exist', () => {
    const dir = join(root, 'missing');
    expect(listEntries(dir)).toEqual([]);
    expect(pickNewRunDir(dir, [], listEntries(dir))).toBeUndefined();
  });

  it('returns the one new entry', () => {
    const dir = join(root, 'runs');
    mkdirSync(dir);
    const before = listEntries(dir);
    makeRun(dir, 'run-1', 100);
    expect(pickNewRunDir(dir, before, listEntries(dir))).toBe(join(dir, 'run-1'));
  });

  it('returns the newest of several new entries', () => {
    const dir = join(root, 'runs');
    mkdirSync(dir);
    const before = listEntries(dir);
    makeRun(dir, 'b', 200);
    makeRun(dir, 'c', 300);
    makeRun(dir, 'a', 100);
    expect(pickNewRunDir(dir, before, listEntries(dir))).toBe(join(dir, 'c'));
  });

  it('ignores a newer stale pre-existing entry', () => {
    const dir = join(root, 'runs');
    makeRun(dir, 'stale', 9000);
    const before = listEntries(dir);
    makeRun(dir, 'fresh', 100);
    expect(pickNewRunDir(dir, before, listEntries(dir))).toBe(join(dir, 'fresh'));
  });
});

describe('resolveEffectiveOutputDir', () => {
  it('uses output.dir set only in ce.yml', () => {
    writeFileSync(join(root, 'ce.yml'), 'output:\n  dir: custom/runs\n');
    expect(resolveEffectiveOutputDir({ cwd: root, flags: {}, env: {} })).toBe(
      join(root, 'custom/runs'),
    );
  });

  it('falls back to .ce/runs by default', () => {
    expect(resolveEffectiveOutputDir({ cwd: root, flags: {}, env: {} })).toBe(
      join(root, '.ce/runs'),
    );
  });

  it('lets the environment override ce.yml', () => {
    writeFileSync(join(root, 'ce.yml'), 'output:\n  dir: from-file\n');
    expect(
      resolveEffectiveOutputDir({ cwd: root, flags: {}, env: { CE_OUTPUT_DIR: 'from-env' } }),
    ).toBe(join(root, 'from-env'));
  });

  it('returns undefined on a config error', () => {
    writeFileSync(join(root, 'ce.yml'), 'output: [unclosed\n');
    expect(resolveEffectiveOutputDir({ cwd: root, flags: {}, env: {} })).toBeUndefined();
    expect(
      resolveEffectiveOutputDir({ cwd: root, flags: { config: 'nope.yml' }, env: {} }),
    ).toBeUndefined();
  });
});

describe('readRunRecord', () => {
  it('reads a valid run.json', async () => {
    const record: { outcome: string } = fc.sample(skippedRunRecordArb, 1)[0]!;
    writeFileSync(join(root, 'run.json'), JSON.stringify(record));
    const read = await readRunRecord(root);
    expect(read?.outcome).toBe(record.outcome);
  });

  it('returns undefined for an invalid run.json', async () => {
    writeFileSync(join(root, 'run.json'), JSON.stringify({ outcome: 'EVIDENCED' }));
    expect(await readRunRecord(root)).toBeUndefined();
  });

  it('returns undefined for unparsable and absent files', async () => {
    writeFileSync(join(root, 'run.json'), '{not json');
    expect(await readRunRecord(root)).toBeUndefined();
    expect(await readRunRecord(join(root, 'absent'))).toBeUndefined();
  });
});
