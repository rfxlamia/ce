// `ce init` command.
// Pure function of its arguments: no process.exit, no process.env, no process.cwd(), no .env loading.

import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import { detectProject } from './detect.js';
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

/** B0: any directory entry (file, directory, symlink, dangling or not) counts. Returns the first name found. */
function firstExistingConfig(fs: InitFs, cwd: string): string | null {
  for (const name of CONFIG_NAMES) {
    try {
      fs.lstat(join(cwd, name));
      return name;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
  return null;
}

export async function runInitCommand(argv: readonly string[], deps: InitCommandDeps): Promise<number> {
  const { cwd, env, stdout, stderr } = deps;
  const fs = deps.fs ?? defaultFs;
  const force = argv.includes('--force');

  if (!force) {
    const existing = firstExistingConfig(fs, cwd);
    if (existing !== null) {
      stderr.write(existsMessage(existing));
      return 1;
    }
  }

  const packageJsonText = fs.readFile(join(cwd, 'package.json'), 'utf8');
  const entries = new Set(fs.readdir(cwd));
  const files = new Set(LOCKFILES.filter((f) => entries.has(f)));

  const detection = detectProject({ packageJsonText, files });
  const text = renderConfig(detection);

  let name = 'ce.yml';
  try {
    if (force) {
      const target = forceTarget(fs, cwd);
      name = target.name;
      if (target.bothFiles) stderr.write('Note: .ce.yml also exists and stays ignored; ce.yml takes precedence.\n');
      replaceAtomically(fs, cwd, name, text);
    } else {
      fs.writeFile(join(cwd, name), text, { flag: 'wx' });
    }
  } catch (error) {
    const code = errorCode(error);
    stderr.write(code === 'EEXIST' && !force ? existsMessage(name) : `Cannot write ${name}: ${code}\n`);
    return 1;
  }

  stdout.write(renderNextSteps({ detection, configPath: name, env }));
  return 0;
}
