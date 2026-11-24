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
import { VERSION, run } from './index.js';

const [, , command, ...rest] = process.argv;

function help(): void {
  console.log(`Continuous Evidence v${VERSION}

Usage:
  ce run [options]    Run Continuous Evidence for the current change

Options are not finalized for v0; see SPEC.md at the repository root.`);
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
    case 'run':
      try {
        const result = await run();
        console.log(`Outcome: ${result.outcome}`);
        return 0;
      } catch (error) {
        console.error(`Outcome: ERROR`);
        console.error(error instanceof Error ? error.message : error);
        return 1;
      }
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
