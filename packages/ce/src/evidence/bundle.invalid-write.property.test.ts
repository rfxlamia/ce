import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { writeBundle, type BundleFs } from './bundle.js';
import { buildRunRecordInputArb } from './arbitraries.js';

/** In-memory file system over a single run directory. Counts every mutation. */
function memoryFs(initial: Record<string, string>): { fs: BundleFs; files: Map<string, string>; mutations: string[] } {
  const files = new Map<string, string>(Object.entries(initial));
  const mutations: string[] = [];
  const fs: BundleFs = {
    async mkdir() {
      return undefined;
    },
    async readdir(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
    async writeFile(file, data) {
      mutations.push(`write:${file}`);
      files.set(file, data);
    },
    async rename(from, to) {
      mutations.push(`rename:${from}->${to}`);
      const data = files.get(from);
      if (data === undefined) throw new Error('ENOENT');
      files.delete(from);
      files.set(to, data);
    },
    async rm(file) {
      mutations.push(`rm:${file}`);
      files.delete(file);
    },
  };
  return { fs, files, mutations };
}

const RUN_DIR = '/mem/run';
const STAGE_KEYS = ['config', 'context', 'assessment', 'runtime'] as const;

/** One way to make the record invalid, with the dot-path the writer must report. */
type Corruption =
  | { kind: 'startedAt'; marker: string }
  | { kind: 'durationMs' }
  | { kind: 'stage'; key: (typeof STAGE_KEYS)[number] }
  | { kind: 'ceVersion' };

const corruptionArb: fc.Arbitrary<Corruption> = fc.oneof(
  fc.stringMatching(/^[0-9a-f]{8,16}$/).map((h): Corruption => ({ kind: 'startedAt', marker: `NOT-A-DATE-${h}` })),
  fc.constant<Corruption>({ kind: 'durationMs' }),
  fc.constantFrom(...STAGE_KEYS).map((key): Corruption => ({ kind: 'stage', key })),
  fc.constant<Corruption>({ kind: 'ceVersion' }),
);

function pathOf(c: Corruption): string {
  switch (c.kind) {
    case 'startedAt':
      return 'timings.startedAt';
    case 'durationMs':
      return 'timings.durationMs';
    case 'stage':
      return `timings.stages.${c.key}`;
    case 'ceVersion':
      return 'ceVersion';
  }
}

describe('writeBundle invalid records', () => {
  // Feature: evidence-bundle, Property 6: Invalid records are never written, and their error names only paths
  // **Validates: Requirements 4.1, 4.2, 4.3**
  it('Feature: evidence-bundle, Property 6: Invalid records are never written, and their error names only paths', async () => {
    await fc.assert(
      fc.asyncProperty(
        buildRunRecordInputArb,
        fc.uniqueArray(corruptionArb, { minLength: 1, maxLength: 4, selector: pathOf }),
        fc.option(fc.constant('{"previous":true}\n'), { nil: undefined }),
        async (input, corruptions, previous) => {
          // Only inputs that build a valid record before corruption, so the failing paths are exactly ours.
          const probe = memoryFs({});
          const baseline = await writeBundle({
            ...input,
            timings: { ...input.timings, durationMs: 1 },
            runDir: RUN_DIR,
            secrets: [],
            fs: probe.fs,
            now: () => new Date(0),
          });
          fc.pre(baseline.ok);

          const initial: Record<string, string> = { [path.join(RUN_DIR, 'step-1.png')]: '' };
          if (previous !== undefined) initial[path.join(RUN_DIR, 'run.json')] = previous;
          const { fs, files, mutations } = memoryFs(initial);

          const timings = { ...input.timings, durationMs: 1, stages: { ...input.timings.stages } };
          let ceVersion: unknown = '0.0.0';
          const markers: string[] = [];
          for (const c of corruptions) {
            if (c.kind === 'startedAt') {
              timings.startedAt = c.marker;
              markers.push(c.marker);
            } else if (c.kind === 'durationMs') timings.durationMs = -7_654_321;
            else if (c.kind === 'stage') timings.stages[c.key] = -9_876_543;
            else ceVersion = 424_242_424;
          }
          // Values that must never be echoed back in the error.
          markers.push('-7654321', '-9876543', '424242424');

          const before = new Map(files);
          const result = await writeBundle({
            ...input,
            timings,
            ceVersion: ceVersion as string,
            runDir: RUN_DIR,
            secrets: [],
            fs,
            now: () => new Date(0),
          });

          // 4.2: nothing created or modified.
          expect(result.ok).toBe(false);
          expect(mutations).toEqual([]);
          expect(new Map(files)).toEqual(before);
          expect(files.has(path.join(RUN_DIR, 'run.json.tmp'))).toBe(false);
          if (previous === undefined) expect(files.has(path.join(RUN_DIR, 'run.json'))).toBe(false);
          else expect(files.get(path.join(RUN_DIR, 'run.json'))).toBe(previous);

          if (result.ok) return;

          // 4.1: StageError for the evidence stage.
          expect(result.error.stage).toBe('evidence');

          // 4.3: every failing path, and only paths.
          const expected = corruptions.map(pathOf).sort();
          expect([...(result.validationFailure?.fields ?? [])].sort()).toEqual(expected);
          const cause = result.error.cause as { fields?: readonly string[] };
          expect([...(cause.fields ?? [])].sort()).toEqual(expected);

          const exposed = JSON.stringify(result.validationFailure) + result.error.message + String((result.error.cause as Error).message);
          for (const m of markers) expect(exposed).not.toContain(m);
        },
      ),
      { numRuns: 100 },
    );
  });
});
