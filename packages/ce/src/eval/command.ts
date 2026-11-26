// `ce eval` command (Requirements 8.8, 13.12, 14.1-14.9, 14.11-14.14; Decisions D15, D11).
// Pure function of its arguments: no process.exit, no process.env, no .env loading.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireJevCredentials } from '../config/credentials.js';
import { reportConfigFailure } from '../config/errors.js';
import type { ValidationError } from '../config/errors.js';
import { loadConfig } from '../config/load.js';
import type { LoadedConfig } from '../config/load.js';
import { collectSecretValues } from '../config/secrets.js';
import { StageError } from '../errors.js';
import type { JevGateway } from '../jev/gateway.js';
import { createJsonlCallLog } from '../jev/log.js';
import type { CallLog } from '../jev/log.js';
import type { LoadFixturesFailure } from './fixture.js';
import { formatReport } from './report.js';
import { runEval } from './run.js';

type Writable = { write(text: string): unknown };

export type CreateEvalGateway = (
  loaded: LoadedConfig,
  env: Record<string, string | undefined>,
  options: { callLog: CallLog },
) => { ok: true; gateway: JevGateway } | { ok: false; errors: ValidationError[] };

export interface EvalCommandDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: Writable;
  stderr: Writable;
  createGateway: CreateEvalGateway;
  now: () => Date;
}

const USAGE = `Usage: ce eval [--fixtures <dir>] [--config <file>]

Options:
  --fixtures <dir>   Directory of labelled fixtures (default: fixtures/eval)
  --config <file>    Path to a Config_File
`;

interface ParsedArgs {
  fixtures?: string;
  config?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const parsed: ParsedArgs = {};
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
    if (name !== 'fixtures' && name !== 'config') return null;
    if (value === undefined || value === '' || parsed[name] !== undefined) return null;
    parsed[name] = value;
  }
  return parsed;
}

function describeFixtureFailure(f: Exclude<LoadFixturesFailure, { ok: true } | { kind: 'context' }>): string {
  switch (f.kind) {
    case 'directory':
      return `Fixture directory is missing, unreadable or empty: ${f.dir}`;
    case 'schema':
      return `Fixture ${f.file}: invalid at "${f.path}", expected ${f.expected}`;
    case 'unlabelled-candidate':
      return `Fixture ${f.fixtureId}: candidate ${JSON.stringify(f.candidateText)} has no label for ${f.missing}`;
    case 'unknown-label':
      return `Fixture ${f.fixtureId}: label "${f.label}" names unknown candidate ${JSON.stringify(f.candidateText)}`;
  }
}

function describeStageError(error: StageError): string {
  const cause = error.cause;
  const name =
    typeof cause === 'object' && cause !== null ? (cause.constructor?.name ?? 'Object') : typeof cause;
  return `Eval failed at stage "${error.stage}": ${name}`;
}

function timestampDirName(date: Date): string {
  return `eval-${date.toISOString().replace(/[:.]/g, '-')}`;
}

export async function runEvalCommand(argv: readonly string[], deps: EvalCommandDeps): Promise<number> {
  const { env, cwd, stdout, stderr } = deps;

  const args = parseArgs(argv);
  if (args === null) {
    stderr.write(USAGE);
    return 1;
  }

  const flags: Record<string, unknown> = {};
  if (args.config !== undefined) flags['config'] = args.config;
  const loaded = loadConfig({ cwd, flags, env });
  if (!loaded.ok) return reportConfigFailure(loaded, collectSecretValues(env), stderr);

  const credentials = requireJevCredentials(loaded, env);
  if (!credentials.ok) return reportConfigFailure(credentials, collectSecretValues(env), stderr);

  const outDir = path.resolve(
    cwd,
    loaded.config.output?.dir ?? '.ce/runs',
    timestampDirName(deps.now()),
  );
  const callLogPath = path.join(outDir, 'jev-calls.jsonl');

  const created = deps.createGateway(loaded, env, { callLog: createJsonlCallLog(callLogPath) });
  if (!created.ok) {
    return reportConfigFailure({ ok: false, errors: created.errors }, collectSecretValues(env), stderr);
  }

  const fixturesDir = path.resolve(cwd, args.fixtures ?? path.join('fixtures', 'eval'));
  const outcome = await runEval({
    fixturesDir,
    config: loaded.config,
    gateway: created.gateway,
  });

  if (!outcome.ok) {
    if ('stageError' in outcome) {
      stderr.write(`${describeStageError(outcome.stageError)}\n`);
    } else {
      stderr.write(`${describeFixtureFailure(outcome)}\n`);
    }
    return 1;
  }

  const { result } = outcome;
  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'eval.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    stderr.write(`Cannot write eval output to ${outDir}${typeof code === 'string' ? ` (${code})` : ''}\n`);
    return 1;
  }

  stdout.write(formatReport(result));
  stdout.write(`Eval saved to ${outDir}\n`);
  return 0;
}
