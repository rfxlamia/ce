import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import type { ConfigFileError, ValidationError } from './errors.js';

export type DiscoverResult =
  | { path: string | null; ignoredPath: string | null }
  | { flagError: ValidationError };

export type ReadResult =
  | { ok: true; value: unknown }
  | { ok: false; fileError: ConfigFileError }
  | { ok: false; errors: ValidationError[] };

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isReadableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the Config_File. Looks only in `cwd` (or at the exact `configFlag`
 * path); never walks upward and never consults $HOME.
 */
export function discoverConfigFile(options: {
  cwd: string;
  configFlag?: string | undefined;
}): DiscoverResult {
  const { cwd, configFlag } = options;

  if (configFlag !== undefined) {
    const trimmed = configFlag.trim();
    if (trimmed === '') {
      return {
        flagError: {
          path: 'config',
          value: configFlag,
          expected: 'path must be non-empty',
          source: 'flag',
        },
      };
    }
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
    if (!isReadableFile(resolved)) {
      return {
        flagError: {
          path: 'config',
          value: configFlag,
          expected: `path must name a readable YAML file (cannot read "${configFlag}")`,
          source: 'flag',
        },
      };
    }
    return { path: resolved, ignoredPath: null };
  }

  const primary = path.join(cwd, 'ce.yml');
  const hidden = path.join(cwd, '.ce.yml');
  const hasPrimary = isFile(primary);
  const hasHidden = isFile(hidden);
  if (hasPrimary) return { path: primary, ignoredPath: hasHidden ? hidden : null };
  if (hasHidden) return { path: hidden, ignoredPath: null };
  return { path: null, ignoredPath: null };
}

/** Read and parse a Config_File. Never throws. */
export function readAndParseConfigFile(filePath: string | null): ReadResult {
  if (filePath === null) return { ok: true, value: {} };

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return {
      ok: false,
      fileError: {
        kind: 'read',
        file: filePath,
        code: typeof err?.code === 'string' ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : String(error),
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(text, { schema: 'core' });
  } catch (error) {
    if (error instanceof YAML.YAMLParseError) {
      const fileError: ConfigFileError = {
        kind: 'parse',
        file: filePath,
        code: error.code,
        message: error.message,
      };
      const pos = error.linePos?.[0];
      if (pos) {
        fileError.line = pos.line;
        fileError.column = pos.col;
      }
      return { ok: false, fileError };
    }
    const err = error as NodeJS.ErrnoException;
    return {
      ok: false,
      fileError: {
        kind: 'read',
        file: filePath,
        code: typeof err?.code === 'string' ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : String(error),
      },
    };
  }

  if (parsed === null || parsed === undefined) return { ok: true, value: {} };

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      errors: [{ path: '(root)', value: parsed, expected: 'mapping', source: 'file' }],
    };
  }
  return { ok: true, value: parsed };
}
