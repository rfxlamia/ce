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

const defaultFs: InitFs = {
  readFile: (p, enc) => nodeFs.readFileSync(p, enc),
  readdir: (p) => nodeFs.readdirSync(p),
  writeFile: (p, data, options) => nodeFs.writeFileSync(p, data, options),
};

export async function runInitCommand(_argv: readonly string[], deps: InitCommandDeps): Promise<number> {
  const { cwd, env, stdout } = deps;
  const fs = deps.fs ?? defaultFs;

  const packageJsonText = fs.readFile(join(cwd, 'package.json'), 'utf8');
  const entries = new Set(fs.readdir(cwd));
  const files = new Set(LOCKFILES.filter((f) => entries.has(f)));

  const detection = detectProject({ packageJsonText, files });
  fs.writeFile(join(cwd, CONFIG_NAME), renderConfig(detection), { flag: 'wx' });
  stdout.write(renderNextSteps({ detection, configPath: CONFIG_NAME, env }));
  return 0;
}
