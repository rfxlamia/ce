import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { StageError } from '../errors.js';
import { writeBundle, writeMinimalBundle, type BundleFs, type WriteBundleInput } from './bundle.js';
import { buildRunRecordInputArb } from './arbitraries.js';

const RUN_DIR = '/mem/run';
const RUN_JSON = path.join(RUN_DIR, 'run.json');
const TMP_JSON = path.join(RUN_DIR, 'run.json.tmp');

interface Memory {
  fs: BundleFs;
  files: Map<string, string>;
  removed: string[];
}

/** In-memory fs. `overrides` replace single operations to inject failures. */
function memoryFs(overrides: Partial<BundleFs> = {}): Memory {
  const files = new Map<string, string>();
  const removed: string[] = [];
  const fs: BundleFs = {
    async mkdir() {
      return undefined;
    },
    async readdir() {
      return [];
    },
    async writeFile(file, data) {
      files.set(file, data);
    },
    async rename(from, to) {
      const data = files.get(from);
      if (data === undefined) throw new Error('ENOENT');
      files.delete(from);
      files.set(to, data);
    },
    async rm(file) {
      removed.push(file);
      files.delete(file);
    },
    ...overrides,
  };
  return { fs, files, removed };
}

let base: Omit<WriteBundleInput, 'fs'>;

beforeAll(() => {
  const sample = fc.sample(
    buildRunRecordInputArb.filter((i) => i.resolution.outcome === 'ERROR'),
    1,
  )[0]!;
  const { timings, ...rest } = sample;
  base = {
    ...rest,
    timings: { ...timings, durationMs: 1 },
    runDir: RUN_DIR,
    secrets: [],
    now: () => new Date(0),
  };
});

describe('writeBundle failures', () => {
  // Requirements 4.4, 4.5
  it('removes the temp file on a rename failure and keeps the original error', async () => {
    const renameError = new Error('EXDEV: rename failed');
    const mem = memoryFs({
      async rename() {
        throw renameError;
      },
    });
    const result = await writeBundle({ ...base, fs: mem.fs });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(StageError);
    expect(result.error.stage).toBe('evidence');
    expect(result.error.cause).toBe(renameError);
    expect(mem.removed).toContain(TMP_JSON);
    expect(mem.files.has(TMP_JSON)).toBe(false);
    expect(mem.files.has(RUN_JSON)).toBe(false);
  });

  it('keeps the rename error when the temp file cleanup also fails', async () => {
    const renameError = new Error('rename failed');
    const mem = memoryFs({
      async rename() {
        throw renameError;
      },
      async rm() {
        throw new Error('rm failed');
      },
    });
    const result = await writeBundle({ ...base, fs: mem.fs });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.cause).toBe(renameError);
  });

  // Requirement 4.8
  it('returns a StageError and writes no run.json on a write failure', async () => {
    const writeError = new Error('ENOSPC: no space left');
    const mem = memoryFs({
      async writeFile() {
        throw writeError;
      },
    });
    const result = await writeBundle({ ...base, fs: mem.fs });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(StageError);
    expect(result.error.stage).toBe('evidence');
    expect(result.error.cause).toBe(writeError);
    expect(mem.files.has(RUN_JSON)).toBe(false);
    expect(mem.files.has(TMP_JSON)).toBe(false);
  });
});

describe('writeMinimalBundle failures', () => {
  // Requirements 5.11, 5.15, 5.16
  it('does not throw and writes no run.json when the write fails', async () => {
    const mem = memoryFs({
      async writeFile() {
        throw new Error('EIO');
      },
    });
    const result = await writeMinimalBundle({ ...base, fs: mem.fs });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('evidence');
    expect(mem.files.has(RUN_JSON)).toBe(false);
  });

  it('does not throw when the rename fails and leaves no run.json or temp file', async () => {
    const mem = memoryFs({
      async rename() {
        throw new Error('EPERM');
      },
    });
    const result = await writeMinimalBundle({ ...base, fs: mem.fs });

    expect(result.ok).toBe(false);
    expect(mem.files.has(RUN_JSON)).toBe(false);
    expect(mem.files.has(TMP_JSON)).toBe(false);
  });

  it('does not throw when every fs operation fails', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('fs down');
    };
    const mem = memoryFs({ mkdir: boom, readdir: boom, writeFile: boom, rename: boom, rm: boom });
    const result = await writeMinimalBundle({
      ...base,
      fs: mem.fs,
      validationFailure: { fields: ['outcome'] },
    });

    expect(result.ok).toBe(false);
    expect(mem.files.has(RUN_JSON)).toBe(false);
  });
});
