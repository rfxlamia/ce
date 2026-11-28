// `ce init` command.
// Pure function of its arguments: no process.exit, no process.env, no process.cwd(), no .env loading.

import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import { detectProject, type Detection } from './detect.js';
import { renderNextSteps } from './next-steps.js';
import { renderConfig } from './template.js';

type Writable = { write(text: string): unknown };

/** The subset of node:fs the command uses (sync, node:fs-compatible). Injected only to simulate failures. */
export interface InitFs {
  lstat(path: string): nodeFs.Stats;
  stat(path: string): nodeFs.Stats;
  readFile(path: string, encoding: 'utf8'): string;
  readdir(path: string): string[];
  writeFile(path: string, data: string, options: { flag: string }): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
}

export interface InitCommandDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: Writable;
  stderr: Writable;
  fs?: InitFs;
}

const LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json'];
const CONFIG_NAMES = ['ce.yml', '.ce.yml'] as const;

const defaultFs: InitFs = {
  lstat: (p) => nodeFs.lstatSync(p),
  stat: (p) => nodeFs.statSync(p),
  readFile: (p, enc) => nodeFs.readFileSync(p, enc),
  readdir: (p) => nodeFs.readdirSync(p),
  writeFile: (p, data, options) => nodeFs.writeFileSync(p, data, options),
  rename: (from, to) => nodeFs.renameSync(from, to),
  unlink: (p) => nodeFs.unlinkSync(p),
};

const USAGE = `Usage: ce init [--force]

Options:
  --force   Overwrite an existing ce.yml (or .ce.yml)
`;

/** Returns null for an unknown flag or any positional argument. */
function parseInitArgs(argv: readonly string[]): { force: boolean } | null {
  let force = false;
  for (const arg of argv) {
    if (arg !== '--force') return null;
    force = true;
  }
  return { force };
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

function existsMessage(name: string): string {
  return `${name} already exists; re-run with --force to overwrite\n`;
}

function isFile(fs: InitFs, path: string): boolean {
  try {
    return fs.stat(path).isFile();
  } catch {
    return false;
  }
}

/** B3: the file `discoverConfigFile` would load (same stat/isFile rule); ce.yml when neither is a file. */
function forceTarget(fs: InitFs, cwd: string): { name: string; bothFiles: boolean } {
  const ceIsFile = isFile(fs, join(cwd, 'ce.yml'));
  const dotIsFile = isFile(fs, join(cwd, '.ce.yml'));
  if (ceIsFile) return { name: 'ce.yml', bothFiles: dotIsFile };
  if (dotIsFile) return { name: '.ce.yml', bothFiles: false };
  return { name: 'ce.yml', bothFiles: false };
}

/** Writes a temp file in `cwd`, then renames it over `name`. The temp file is removed on any failure. */
function replaceAtomically(fs: InitFs, cwd: string, name: string, text: string): void {
  const temp = join(cwd, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFile(temp, text, { flag: 'wx' });
    fs.rename(temp, join(cwd, name));
  } catch (error) {
    try {
      fs.unlink(temp);
    } catch {
      // The temp file may never have been created.
    }
    throw error;
  }
}

/**
 * B0: any directory entry (file, directory, symlink, dangling or not) counts. Returns the first name found.
 * Throws only for a non-ENOENT lstat failure, which the caller reports.
 */
function firstExistingConfig(fs: InitFs, cwd: string): string | null {
  for (const name of CONFIG_NAMES) {
    try {
      fs.lstat(join(cwd, name));
      return name;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw new ConfigCheckError(name, errorCode(error));
    }
  }
  return null;
}

class ConfigCheckError extends Error {
  constructor(
    readonly file: string,
    readonly code: string,
  ) {
    super(`Cannot check ${file}: ${code}`);
  }
}

interface ProjectInput {
  packageJsonText: string | null;
  packageJsonUnreadable: boolean;
  /** Set when package.json exists but could not be read. */
  readErrorCode: string | null;
  files: Set<string>;
}

/** Reads package.json and the regular-file lockfiles in `cwd`. Never throws. */
function gatherProjectInput(cwd: string, fs: InitFs): ProjectInput {
  let packageJsonText: string | null = null;
  let readErrorCode: string | null = null;
  try {
    packageJsonText = fs.readFile(join(cwd, 'package.json'), 'utf8');
  } catch (error) {
    const code = errorCode(error);
    if (code !== 'ENOENT') readErrorCode = code;
  }
  let names: string[] = [];
  try {
    names = fs.readdir(cwd);
  } catch {
    // Lockfile detection is best effort.
  }
  const files = new Set(LOCKFILES.filter((f) => names.includes(f) && isFile(fs, join(cwd, f))));
  return { packageJsonText, packageJsonUnreadable: readErrorCode !== null, readErrorCode, files };
}

/** Creates `ce.yml` exclusively, or replaces the B3 target atomically under --force. Returns the file name written. */
function writeConfig(fs: InitFs, cwd: string, text: string, force: boolean, stderr: Writable): string {
  if (!force) {
    try {
      fs.writeFile(join(cwd, 'ce.yml'), text, { flag: 'wx' });
    } catch (error) {
      throw new ConfigWriteError('ce.yml', errorCode(error), errorCode(error) === 'EEXIST');
    }
    return 'ce.yml';
  }
  const target = forceTarget(fs, cwd);
  try {
    replaceAtomically(fs, cwd, target.name, text);
  } catch (error) {
    throw new ConfigWriteError(target.name, errorCode(error), false);
  }
  if (target.bothFiles) stderr.write('Note: .ce.yml also exists and stays ignored; ce.yml takes precedence.\n');
  return target.name;
}

class ConfigWriteError extends Error {
  constructor(
    readonly file: string,
    readonly code: string,
    readonly alreadyExists: boolean,
  ) {
    super(`Cannot write ${file}: ${code}`);
  }
}

function packageJsonNotes(input: ProjectInput, detection: Detection): string[] {
  if (input.readErrorCode !== null) return [`package.json could not be read (${input.readErrorCode})\n`];
  if (detection.status === 'fallback' && detection.reason === 'unparseable') {
    return ['package.json could not be parsed\n'];
  }
  return [];
}

export async function runInitCommand(argv: readonly string[], deps: InitCommandDeps): Promise<number> {
  const { cwd, env, stdout, stderr } = deps;
  const fs = deps.fs ?? defaultFs;

  const args = parseInitArgs(argv);
  if (args === null) {
    stderr.write(USAGE);
    return 1;
  }

  try {
    if (!args.force) {
      const existing = firstExistingConfig(fs, cwd);
      if (existing !== null) {
        stderr.write(existsMessage(existing));
        return 1;
      }
    }
    const input = gatherProjectInput(cwd, fs);
    const detection = detectProject({
      packageJsonText: input.packageJsonText,
      packageJsonUnreadable: input.packageJsonUnreadable,
      files: input.files,
    });
    const name = writeConfig(fs, cwd, renderConfig(detection), args.force, stderr);
    for (const note of packageJsonNotes(input, detection)) stderr.write(note);
    stdout.write(renderNextSteps({ detection, configPath: name, env }));
    return 0;
  } catch (error) {
    if (error instanceof ConfigCheckError) {
      stderr.write(`${error.message}\n`);
    } else if (error instanceof ConfigWriteError) {
      stderr.write(error.alreadyExists ? existsMessage(error.file) : `${error.message}\n`);
    } else {
      throw error;
    }
    return 1;
  }
}
