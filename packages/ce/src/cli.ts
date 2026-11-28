#!/usr/bin/env node
/**
 * Continuous Evidence CLI.
 *
 * Target UX (SPEC.md — Milestone 1 target output):
 *
 *   $ ce run
 *   Continuous Evidence
 *   Change detected
 *   Assessment: Runtime evidence required
 *   ...
 *   Evidence saved to .ce/runs/...
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runEvalCommand } from './eval/index.js';
import { VERSION, createJevGateway } from './index.js';
import { runInitCommand } from './init/index.js';
import { runRunCommand } from './run/index.js';

const [, , command, ...rest] = process.argv;

function help(): void {
  console.log(`Continuous Evidence v${VERSION}

Usage:
  ce init [--force]   Write a starter ce.yml for this project
  ce run [options]    Run Continuous Evidence for the current change
  ce eval [options]   Measure Jev agreement against labelled fixtures

Run options:
  --config <path>     Path to the ce.yml configuration file
  --base <ref>        Git base ref to compare the change against
  --claim <text>      A claim to assess (may be repeated)

Options are not finalized for v0; see SPEC.md at the repository root.`);
}

/**
 * Loads `.env` from the working directory (Decision D14). Variables already set,
 * including empty ones, are kept. A missing file is silent. An unreadable file
 * prints the file name and error code only, never content or values.
 * Returns false when the command must not run.
 */
function loadEnvFileIfPresent(cwd: string): boolean {
  const file = join(cwd, '.env');
  if (!existsSync(file)) return true;
  try {
    if (statSync(file).isDirectory()) {
      console.error('Cannot read .env: EISDIR');
      return false;
    }
    process.loadEnvFile(file);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'ENOENT') return true;
    console.error(`Cannot read .env: ${typeof code === 'string' ? code : 'UNKNOWN'}`);
    return false;
  }
}

async function main(): Promise<number> {
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      help();
      return 0;
    case '--version':
    case '-v':
      console.log(VERSION);
      return 0;
    case 'eval':
      if (!loadEnvFileIfPresent(process.cwd())) return 1;
      return runEvalCommand(rest, {
        env: process.env,
        cwd: process.cwd(),
        stdout: process.stdout,
        stderr: process.stderr,
        createGateway: createJevGateway,
        now: () => new Date(),
      });
    case 'init':
      // Deliberately does not load .env: init only reads package.json and the process env.
      return runInitCommand(rest, {
        env: process.env,
        cwd: process.cwd(),
        stdout: process.stdout,
        stderr: process.stderr,
      });
    case 'run':
      if (!loadEnvFileIfPresent(process.cwd())) return 1;
      return runRunCommand(rest, {
        env: process.env,
        cwd: process.cwd(),
        stdout: process.stdout,
        stderr: process.stderr,
        createGateway: createJevGateway,
        now: () => new Date(),
      });
    default:
      console.error(`Unknown command: ${rest.length > 0 ? `${command} ${rest.join(' ')}` : command}`);
      help();
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
