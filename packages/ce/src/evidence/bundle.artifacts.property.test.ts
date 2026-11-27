import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { writeBundle, type BundleFs } from './bundle.js';
import { buildRunRecordInputArb } from './arbitraries.js';

/** In-memory file system over a single run directory. */
function memoryFs(initial: readonly string[]): { fs: BundleFs; files: Map<string, string> } {
  const files = new Map<string, string>(initial.map((n) => [n, '']));
  const fs: BundleFs = {
    async mkdir() {
      return undefined;
    },
    async readdir(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
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
      files.delete(file);
    },
  };
  return { fs, files };
}

const RUN_DIR = '/mem/run';

const screenshotName = fc
  .tuple(fc.nat(30), fc.boolean())
  .map(([n, final]) => (final ? `step-${n}-final.png` : `step-${n}.png`));

// Files that must never be listed.
const noiseName = fc.constantFrom('notes.txt', 'report.html', 'console.json', 'network.har', 'README.md');

const dirContents = fc
  .record({
    shots: fc.uniqueArray(screenshotName, { maxLength: 8 }),
    log: fc.boolean(),
    calls: fc.boolean(),
    noise: fc.uniqueArray(noiseName, { maxLength: 3 }),
  })
  .map(({ shots, log, calls, noise }) => ({
    shots,
    log,
    calls,
    names: [...shots, ...(log ? ['target.log'] : []), ...(calls ? ['jev-calls.jsonl'] : []), ...noise],
  }));

describe('writeBundle artifact listing', () => {
  // Feature: evidence-bundle, Property 1: Artifact listing reflects the run directory exactly
  // **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.8**
  it('Feature: evidence-bundle, Property 1: Artifact listing reflects the run directory exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        buildRunRecordInputArb.filter((i) => i.resolution.outcome === 'ERROR'),
        dirContents,
        async (input, dir) => {
          const { fs, files } = memoryFs(dir.names.map((n) => path.join(RUN_DIR, n)));
          const { timings, ...rest } = input;
          const result = await writeBundle({
            ...rest,
            timings: { ...timings, durationMs: 1 },
            runDir: RUN_DIR,
            secrets: [],
            fs,
            now: () => new Date(0),
          });
          expect(result.ok).toBe(true);

          const text = files.get(path.join(RUN_DIR, 'run.json'));
          expect(text).toBeDefined();
          const record = JSON.parse(text as string) as { artifacts: { path: string; kind: string }[] };

          const expected = [
            ...dir.shots.map((p) => ({ path: p, kind: 'screenshot' })),
            ...(dir.log ? [{ path: 'target.log', kind: 'log' }] : []),
            ...(dir.calls ? [{ path: 'jev-calls.jsonl', kind: 'jev-calls' }] : []),
          ];
          const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
          expect([...record.artifacts].sort(byPath)).toEqual(expected.sort(byPath));

          expect(record.artifacts.filter((a) => a.kind === 'jev-calls').length).toBeLessThanOrEqual(1);
          for (const a of record.artifacts) {
            expect(a.path.startsWith('/')).toBe(false);
            expect(a.path.split('/')).not.toContain('..');
            expect(files.has(path.join(RUN_DIR, a.path))).toBe(true);
          }
          // Temp file is gone after the atomic rename.
          expect(files.has(path.join(RUN_DIR, 'run.json.tmp'))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  }, 30000);
});
