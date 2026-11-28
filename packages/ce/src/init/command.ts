// `ce init` command.
// Pure function of its arguments: no process.exit, no process.env, no process.cwd(), no .env loading.

import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import { detectProject } from './detect.js';
import { renderNextSteps } from './next-steps.js';
import { renderConfig } from './template.js';

type Writable = { write(text: string): unknown };

/** The subset of node:fs the command uses (sync, node:fs-compatible). Injected only to simulate failures. */
export interface InitFs {
  lstat(path: string): nodeFs.Stats;
  readFile(path: string, encoding: 'utf8'): string;
  readdir(path: string): string[];
  writeFile(path: string, data: string, options: { flag: string }): void;
}

export interface InitCommandDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: Writable;
  stderr: Writable;
  fs?: InitFs;
}

const LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json'];
const CONFIG_NAME = 'ce.yml';
const CONFIG_NAMES = ['ce.yml', '.ce.yml'] as const;

const defaultFs: InitFs = {
  lstat: (p) => nodeFs.lstatSync(p),
  readFile: (p, enc) => nodeFs.readFileSync(p, enc),
  readdir: (p) => nodeFs.readdirSync(p),
  writeFile: (p, data, options) => nodeFs.writeFileSync(p, data, options),
};

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

function existsMessage(name: string): string {
  return `${name} already exists; re-run with --force to overwrite\n`;
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

export async function runInitCommand(_argv: readonly string[], deps: InitCommandDeps): Promise<number> {
  const { cwd, env, stdout, stderr } = deps;
  const fs = deps.fs ?? defaultFs;

  const existing = firstExistingConfig(fs, cwd);
  if (existing !== null) {
    stderr.write(existsMessage(existing));
    return 1;
  }

  const packageJsonText = fs.readFile(join(cwd, 'package.json'), 'utf8');
  const entries = new Set(fs.readdir(cwd));
  const files = new Set(LOCKFILES.filter((f) => entries.has(f)));

  const detection = detectProject({ packageJsonText, files });
  try {
    fs.writeFile(join(cwd, CONFIG_NAME), renderConfig(detection), { flag: 'wx' });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
    stderr.write(existsMessage(CONFIG_NAME));
    return 1;
  }
  stdout.write(renderNextSteps({ detection, configPath: CONFIG_NAME, env }));
  return 0;
}
