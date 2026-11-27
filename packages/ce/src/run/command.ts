// `ce run` command (Requirements 10.x).
// Pure function of its arguments: no process.exit, no process.env, no process.cwd(), no .env loading.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolveContextOptions } from '../context/resolve.js';
import { RunRecordSchema } from '../evidence/schema.js';
import { buildSummary } from '../evidence/summary.js';
import type { SummaryInput } from '../evidence/summary.js';
import { TargetUnreachableError } from '../runtime/target.js';
import { run } from './pipeline.js';
import type { CapabilityRegistry, CreateGateway, ResolvedRunWithBundle, RunResult } from './types.js';

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
  /** Capability_Registry passed to run(); run() applies the production default when absent. */
  capabilities?: CapabilityRegistry;
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

/** Reads the written run.json back. Returns undefined when it cannot be read or does not parse. */
async function readWrittenRecord(runDir: string) {
  try {
    const text = await readFile(join(runDir, 'run.json'), 'utf8');
    const parsed = RunRecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function summaryInputFor(result: ResolvedRunWithBundle): Promise<SummaryInput> {
  if (result.bundleWritten && result.reportPath !== undefined) {
    const record = await readWrittenRecord(result.runDir);
    if (record !== undefined) return { kind: 'bundle', record, reportPath: result.reportPath };
  }
  return {
    kind: 'no_bundle',
    outcome: result.outcome,
    reason: result.reason,
    ...(result.errorStage !== undefined ? { errorStage: result.errorStage } : {}),
    ...(result.surface !== undefined ? { surface: result.surface } : {}),
    claimTexts: result.claimTexts ?? [],
    ...(result.finalState !== undefined ? { finalState: result.finalState } : {}),
    ...(result.failureFields !== undefined ? { failureFields: result.failureFields } : {}),
  };
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
      ...(deps.capabilities !== undefined ? { capabilities: deps.capabilities } : {}),
    });
  } catch (thrown) {
    const name =
      typeof thrown === 'object' && thrown !== null ? (thrown.constructor?.name ?? 'Object') : typeof thrown;
    stdout.write('Outcome: ERROR\n');
    stderr.write(`${name}\n`);
    return 1;
  }

  stdout.write(buildSummary(await summaryInputFor(result)));

  if (result.error !== undefined) {
    stderr.write(`${result.error.message}\n`);
    const cause = result.error.cause;
    if (cause instanceof TargetUnreachableError) {
      stderr.write(`Target URL: ${cause.url}\n`);
      stderr.write(`Last status: ${String(cause.lastStatus)}\n`);
    }
  } else if (result.outcome === 'ERROR') {
    if (result.reason !== undefined) stderr.write(`Reason: ${result.reason}\n`);
    if (result.surface !== undefined) stderr.write(`Surface: ${result.surface}\n`);
  }

  return result.exitCode;
}
