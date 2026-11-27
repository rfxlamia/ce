// `ce run` command (Requirements 10.x).
// Pure function of its arguments: no process.exit, no process.env, no process.cwd(), no .env loading.

import type { ResolveContextOptions } from '../context/resolve.js';
import { V0_SUPPORTED_SURFACES } from '../outcome/index.js';
import { run } from './pipeline.js';
import type { CreateGateway, RunResult } from './types.js';

type Writable = { write(text: string): unknown };

export interface RunCommandDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: Writable;
  stderr: Writable;
  createGateway: CreateGateway;
  now: () => Date;
  contextProviders?: ResolveContextOptions['providers'];
  exec?: ResolveContextOptions['exec'];
}

export interface ParsedRunArgs {
  config?: string;
  base?: string;
  claim?: string[];
}

const USAGE = `Usage: ce run [--config <file>] [--base <ref>] [--claim <text>]...

Options:
  --config <file>   Path to a Config_File
  --base <ref>      Base Git ref to compare the Change against
  --claim <text>    A Claim to assess (repeatable)
`;

export function parseRunArgs(argv: readonly string[]): ParsedRunArgs | null {
  const parsed: ParsedRunArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    let name: string;
    let value: string | undefined;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2) {
      name = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else if (arg.startsWith('--')) {
      name = arg.slice(2);
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      i += 1;
    } else {
      return null;
    }
    if (name !== 'config' && name !== 'base' && name !== 'claim') return null;
    if (value === undefined || value === '' || value.startsWith('--')) return null;
    if (name === 'claim') {
      (parsed.claim ??= []).push(value);
    } else {
      if (parsed[name] !== undefined) return null;
      parsed[name] = value;
    }
  }
  return parsed;
}

function isV0Surface(surface: string): boolean {
  return (V0_SUPPORTED_SURFACES as readonly string[]).includes(surface);
}

export async function runRunCommand(argv: readonly string[], deps: RunCommandDeps): Promise<number> {
  const { env, cwd, stdout, stderr } = deps;

  const args = parseRunArgs(argv);
  if (args === null) {
    stderr.write(USAGE);
    return 1;
  }

  const flags: Record<string, unknown> = {};
  if (args.config !== undefined) flags['config'] = args.config;
  const cliOptions: { claim?: string[]; base?: string } = {};
  if (args.base !== undefined) cliOptions.base = args.base;
  if (args.claim !== undefined) cliOptions.claim = args.claim;

  let result: RunResult;
  try {
    result = await run({
      cwd,
      env,
      flags,
      cliOptions,
      createGateway: deps.createGateway,
      now: deps.now,
      stderr,
      ...(deps.contextProviders !== undefined ? { contextProviders: deps.contextProviders } : {}),
      ...(deps.exec !== undefined ? { exec: deps.exec } : {}),
    });
  } catch (thrown) {
    const name =
      typeof thrown === 'object' && thrown !== null ? (thrown.constructor?.name ?? 'Object') : typeof thrown;
    stdout.write('Outcome: ERROR\n');
    stderr.write(`${name}\n`);
    return 1;
  }

  if (result.kind === 'config-failure') return result.exitCode;

  stdout.write(`Outcome: ${result.outcome}\n`);

  if (result.reason === 'surface-unsupported') {
    stdout.write('Reason: surface-unsupported\n');
    if (result.surface !== undefined) {
      stdout.write(`Surface: ${result.surface}\n`);
      if (isV0Surface(result.surface)) {
        stdout.write(`No capability is registered for ${result.surface} yet.\n`);
      }
    }
  }

  if (result.error !== undefined) {
    stderr.write(`${result.error.message}\n`);
  } else if (result.outcome === 'ERROR') {
    if (result.reason !== undefined) stderr.write(`Reason: ${result.reason}\n`);
    if (result.surface !== undefined) stderr.write(`Surface: ${result.surface}\n`);
  }

  return result.exitCode;
}
