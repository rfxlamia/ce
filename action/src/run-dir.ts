import { loadConfig, RunRecordSchema } from 'continuous-evidence';
import type { RunRecord } from 'continuous-evidence';
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Resolves the Effective_Output_Dir with the same loader, cwd, flags and env
 * the CE_CLI will use. Returns undefined when the config does not load
 * (Requirement 6.1, 6.2). The result is an absolute path.
 */
export function resolveEffectiveOutputDir(options: {
  cwd: string;
  flags: Record<string, unknown>;
  env: Record<string, string | undefined>;
}): string | undefined {
  try {
    const loaded = loadConfig(options);
    if (!loaded.ok) return undefined;
    const dir = loaded.config.output?.dir ?? '.ce/runs';
    return resolve(options.cwd, dir);
  } catch {
    return undefined;
  }
}

/** Lists immediate entry names of `dir`, or [] when it does not exist or cannot be read. */
export function listEntries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

/**
 * Picks the Run_Dir created by this invocation: the one new entry, the most
 * recently modified of several (ties broken by name, later wins), or undefined
 * (Requirement 6.2, 6.3, 6.4). Returns the absolute path.
 */
export function pickNewRunDir(
  dir: string,
  before: readonly string[],
  after: readonly string[],
): string | undefined {
  const known = new Set(before);
  const added = [...new Set(after)].filter((name) => !known.has(name));
  if (added.length === 0) return undefined;
  const ranked = added
    .map((name) => ({ name, time: mtimeMs(join(dir, name)) }))
    .sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return join(dir, ranked[0]!.name);
}

/** True for a relative path that stays inside the bundle (Bundle_Relative_Path). */
function isBundleRelativePath(path: string): boolean {
  if (path === '' || path.includes('\0')) return false;
  if (isAbsolute(path) || path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).some((segment) => segment === '..');
}

/**
 * Reads and validates `run.json` inside `runDir` only. Returns undefined when
 * the file is absent, unparsable or invalid (Requirement 6.5, 6.6). Entries of
 * `artifacts` whose path is not a Bundle_Relative_Path are dropped (6.7).
 */
export async function readRunRecord(runDir: string): Promise<RunRecord | undefined> {
  let text: string;
  try {
    text = await readFile(join(runDir, 'run.json'), 'utf8');
  } catch {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = RunRecordSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const record = parsed.data;
  return { ...record, artifacts: record.artifacts.filter((a) => isBundleRelativePath(a.path)) };
}
