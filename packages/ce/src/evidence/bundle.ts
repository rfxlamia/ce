// Evidence_Bundle writer. Builds, redacts and validates the Run_Record, then
// writes `run.json` atomically inside the Run_Dir. File system access and the
// clock are injected. This module reads no environment variable, imports no
// Jev gateway, SDK or fetch, writes no `report.html` and never touches
// `jev-calls.jsonl`. It decides no Outcome (Requirement 9.1).
import path from 'node:path';
import { StageError } from '../errors.js';
import {
  buildMinimalRunRecord,
  buildRunRecord,
  buildValidationFailureRunRecord,
  type BuildRunRecordInput,
  type StageTimings,
} from './build.js';
import { redactRunRecord } from './redact.js';
import { RunRecordSchema, type RunRecord } from './schema.js';

export const RUN_JSON_FILE = 'run.json';
export const RUN_JSON_TMP_FILE = 'run.json.tmp';
export const REPORT_HTML_FILE = 'report.html';
const TARGET_LOG_NAME = 'target.log';
const CALL_LOG_NAME = 'jev-calls.jsonl';

type Artifact = RunRecord['artifacts'][number];

/** The file system operations the writer needs. `node:fs/promises` satisfies it. */
export interface BundleFs {
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>;
  readdir(dir: string): Promise<string[]>;
  writeFile(file: string, data: string, encoding: 'utf8'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(file: string, options: { force: true }): Promise<void>;
}

/** Same as `StageTimings`, but `durationMs` may be left out and is then measured with the clock. */
export type WriteTimings = Omit<StageTimings, 'durationMs'> & { durationMs?: number };

export interface WriteBundleInput extends Omit<BuildRunRecordInput, 'artifacts' | 'timings'> {
  /** Absolute path of the Run_Dir. The writer writes only inside it. */
  runDir: string;
  /** Secret values to replace with `[REDACTED]` (from `collectSecretValues`, passed in). */
  secrets: readonly string[];
  timings: WriteTimings;
  fs: BundleFs;
  now: () => Date;
}

export interface WriteMinimalBundleInput extends WriteBundleInput {
  /** Set after a Validation_Failure of the first write: failing paths only. */
  validationFailure?: { fields: readonly string[] };
}

export type WriteBundleResult =
  | { ok: true; reportPath: string }
  | { ok: false; error: StageError; validationFailure?: { fields: string[] } };

/** Cause of a Validation_Failure. The message lists field paths and no values. */
export class RunRecordValidationError extends Error {
  readonly fields: readonly string[];
  constructor(fields: readonly string[]) {
    super(`Run record failed validation at: ${fields.join(', ')}`);
    this.name = 'RunRecordValidationError';
    this.fields = fields;
  }
}

interface ZodIssueLike {
  path: readonly PropertyKey[];
  keys?: readonly string[];
}

/** Failing field paths, dot-joined, without any value. Sorted and de-duplicated. */
function issuePaths(issues: readonly ZodIssueLike[]): string[] {
  const out = new Set<string>();
  for (const issue of issues) {
    const base = issue.path.map(String);
    if (issue.keys !== undefined && issue.keys.length > 0) {
      for (const key of issue.keys) out.add([...base, key].join('.'));
    } else {
      out.add(base.length === 0 ? '(root)' : base.join('.'));
    }
  }
  return [...out].sort();
}

function toBundleRelative(name: string): string {
  return name.split(path.sep).join('/');
}

/** Scans the Run_Dir for screenshots, `target.log` and `jev-calls.jsonl`. */
function discoverArtifacts(names: readonly string[]): Artifact[] {
  const sorted = [...new Set(names)].sort();
  const out: Artifact[] = [];
  for (const name of sorted) {
    if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') continue;
    if (name.toLowerCase().endsWith('.png')) {
      out.push({ path: toBundleRelative(name), kind: 'screenshot' });
    } else if (name === TARGET_LOG_NAME) {
      out.push({ path: name, kind: 'log' });
    } else if (name === CALL_LOG_NAME) {
      out.push({ path: name, kind: 'jev-calls' });
    }
  }
  return out;
}

function resolveTimings(t: WriteTimings, now: () => Date): StageTimings {
  if (t.durationMs !== undefined) return { ...t, durationMs: t.durationMs };
  const started = Date.parse(t.startedAt);
  const measured = Number.isNaN(started) ? 0 : now().getTime() - started;
  return { ...t, durationMs: Math.max(0, measured) };
}

/** Validates, then writes `run.json.tmp` and renames it. Never throws. */
async function persist(
  record: RunRecord,
  input: WriteBundleInput,
  names: readonly string[],
): Promise<WriteBundleResult> {
  const redacted = redactRunRecord(record, input.secrets);
  const parsed = RunRecordSchema.safeParse(redacted);
  if (!parsed.success) {
    const fields = issuePaths(parsed.error.issues as readonly ZodIssueLike[]);
    return {
      ok: false,
      error: new StageError('evidence', new RunRecordValidationError(fields)),
      validationFailure: { fields },
    };
  }

  const text = `${JSON.stringify(parsed.data, null, 2)}\n`;
  const finalPath = path.join(input.runDir, RUN_JSON_FILE);
  const tmpPath = path.join(input.runDir, RUN_JSON_TMP_FILE);
  try {
    await input.fs.mkdir(input.runDir, { recursive: true });
    await input.fs.writeFile(tmpPath, text, 'utf8');
  } catch (cause) {
    await input.fs.rm(tmpPath, { force: true }).catch(() => undefined);
    return { ok: false, error: new StageError('evidence', cause) };
  }
  try {
    await input.fs.rename(tmpPath, finalPath);
  } catch (cause) {
    await input.fs.rm(tmpPath, { force: true }).catch(() => undefined);
    return { ok: false, error: new StageError('evidence', cause) };
  }

  const hasReport = names.includes(REPORT_HTML_FILE);
  return { ok: true, reportPath: path.join(input.runDir, hasReport ? REPORT_HTML_FILE : RUN_JSON_FILE) };
}

async function listRunDir(input: WriteBundleInput): Promise<string[]> {
  try {
    return await input.fs.readdir(input.runDir);
  } catch {
    return [];
  }
}

/**
 * Writes the full Run_Record. Returns the Report_Path on success. On a
 * Validation_Failure nothing is written and the result carries the failing
 * field paths. Never throws.
 */
export async function writeBundle(input: WriteBundleInput): Promise<WriteBundleResult> {
  try {
    const names = await listRunDir(input);
    const { runDir: _runDir, secrets: _s, fs: _f, now: _n, timings, ...rest } = input;
    const record = buildRunRecord({
      ...rest,
      timings: resolveTimings(timings, input.now),
      artifacts: discoverArtifacts(names),
    });
    return await persist(record, input, names);
  } catch (cause) {
    return { ok: false, error: new StageError('evidence', cause) };
  }
}

/**
 * Writes the Minimal_Bundle of an ERROR run. After a Validation_Failure only
 * the top-level fields and `error` are written. Validated like the full
 * record. Never throws.
 */
export async function writeMinimalBundle(input: WriteMinimalBundleInput): Promise<WriteBundleResult> {
  try {
    const timings = resolveTimings(input.timings, input.now);
    if (input.validationFailure !== undefined) {
      const names = await listRunDir(input);
      const record = buildValidationFailureRunRecord({
        resolution: input.resolution,
        timings,
        fields: input.validationFailure.fields,
        error: input.error,
        ...(input.ceVersion === undefined ? {} : { ceVersion: input.ceVersion }),
      });
      return await persist(record, input, names);
    }
    const names = await listRunDir(input);
    const { runDir: _runDir, secrets: _s, fs: _f, now: _n, validationFailure: _v, timings: _t, ...rest } = input;
    const record = buildMinimalRunRecord({ ...rest, timings, artifacts: discoverArtifacts(names) });
    return await persist(record, input, names);
  } catch (cause) {
    return { ok: false, error: new StageError('evidence', cause) };
  }
}
