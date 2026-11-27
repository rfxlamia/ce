import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { writeBundle, writeMinimalBundle, type BundleFs } from './bundle.js';
import { buildRunRecordInputArb } from './arbitraries.js';

const RUN_DIR = '/mem/run';
const CALL_LOG = path.join(RUN_DIR, 'jev-calls.jsonl');

/** In-memory file system that also records every path it was asked to modify. */
function memoryFs(initial: ReadonlyMap<string, string>): {
  fs: BundleFs;
  files: Map<string, string>;
  touched: string[];
} {
  const files = new Map<string, string>(initial);
  const touched: string[] = [];
  const fs: BundleFs = {
    async mkdir() {
      return undefined;
    },
    async readdir(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
    async writeFile(file, data) {
      touched.push(file);
      files.set(file, data);
    },
    async rename(from, to) {
      touched.push(from, to);
      const data = files.get(from);
      if (data === undefined) throw new Error('ENOENT');
      files.delete(from);
      files.set(to, data);
    },
    async rm(file) {
      touched.push(file);
      files.delete(file);
    },
  };
  return { fs, files, touched };
}

const callLogText = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.array(fc.jsonValue().map((v) => JSON.stringify(v)), { maxLength: 6 }).map((l) => l.join('\n') + (l.length ? '\n' : '')),
);

const extraFiles = fc.record({
  shots: fc.uniqueArray(fc.nat(10).map((n) => `step-${n}.png`), { maxLength: 4 }),
  log: fc.boolean(),
});

describe('bundle writer leaves the Call_Log alone', () => {
  // Feature: evidence-bundle, Property 13: The Call_Log file is never modified
  // **Validates: Requirements 7.6**
  it('Feature: evidence-bundle, Property 13: The Call_Log file is never modified', async () => {
    await fc.assert(
      fc.asyncProperty(
        buildRunRecordInputArb.filter((i) => i.resolution.outcome === 'ERROR'),
        callLogText,
        extraFiles,
        fc.constantFrom('full', 'minimal'),
        async (input, callLog, extra, mode) => {
          const initial = new Map<string, string>([[CALL_LOG, callLog]]);
          for (const s of extra.shots) initial.set(path.join(RUN_DIR, s), '');
          if (extra.log) initial.set(path.join(RUN_DIR, 'target.log'), '');
          const { fs, files, touched } = memoryFs(initial);

          const { timings, ...rest } = input;
          const base = {
            ...rest,
            timings: { ...timings, durationMs: 1 },
            runDir: RUN_DIR,
            // The secret embeds log content behind a marker that cannot occur in a Run_Record.
            // A bare 3-char slice (e.g. "ERR", "202") would redact enum or timestamp values
            // and make the write fail validation, which is unrelated to this property.
            secrets: [`\u0001ce-secret:${callLog.slice(0, 3)}`],
            fs,
            now: () => new Date(0),
          };
          const result = mode === 'full' ? await writeBundle(base) : await writeMinimalBundle(base);
          expect(result.ok).toBe(true);

          expect(files.get(CALL_LOG)).toBe(callLog);
          expect(touched).not.toContain(CALL_LOG);
        },
      ),
      { numRuns: 100 },
    );
  });
});
