// Action entry point (task 5.2). `runAction(deps)` holds the whole flow and takes
// every side-effecting adapter as a dependency, so tests can run it with fakes.
// `main` at the bottom wires the real adapters.
//
// This file never decides, assigns or compares an Outcome. It reads
// `record.outcome` as data for the `outcome` output only. It does not import jev/.
import * as core from '@actions/core';
import {
  collectSecretValues,
  redactSecretValues,
  renderPrComment,
  stripCommentMarker,
} from 'continuous-evidence';
import type { PublishResult, RunRecord, UnavailableRecord } from 'continuous-evidence';
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildArtifactLink, buildArtifactName } from './artifact.js';
import { buildCacheKey, readPlaywrightVersion, resolveBrowsersPath } from './cache.js';
import { sanitizeChildEnv } from './env.js';
import { createGithubAdapters, listFilesRecursive } from './github.js';
import type { GithubAdapters } from './github.js';
import { buildChildInvocation } from './inputs.js';
import { validatePublishMode, resolvePublishSettings } from './publish.js';
import type { PublishMode } from './publish.js';
import { credentialMaskValues, resolveRunToken } from './token.js';
import { isEvidenceBranchRef, isEvidenceBranchRun } from './evidence-branch-guard.js';
import { decidePrePublisher, isForkPullRequest } from './publish/decision.js';
import { fallbackNote } from './publish/fallback.js';
import { createGitRunner } from './publish/git-runner.js';
import type { GitRunner } from './publish/git-runner.js';
import { publish } from './publish/publisher.js';
import type { DirectoryEntry } from './publish/select.js';
import { createLogger, createOutputSetter } from './github.js';
import type { Logger, OutputSetter } from './github.js';
import {
  listEntries,
  pickNewRunDir,
  readRunRecord,
  resolveEffectiveOutputDir,
} from './run-dir.js';
import { describeApiFailure, upsertComment } from './upsert.js';

export interface SpawnRequest {
  /** Full argument vector for the CE CLI, starting with `run`. No shell is involved. */
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface SpawnResult {
  /** Exit code, or null when the process ended by a signal or never started. */
  exitCode: number | null;
  signal: string | null;
  /** Set when the process could not be started. */
  error?: Error;
}

export interface ActionDeps {
  /** The Action's own environment (process.env). */
  env: Readonly<Record<string, string | undefined>>;
  /** Returns the input value, or '' when unset. */
  getInput(name: string): string;
  adapters: GithubAdapters;
  /** Runs the CE CLI. Output is streamed to the workflow log by the implementation. */
  spawnCli(request: SpawnRequest): Promise<SpawnResult>;
  platform: NodeJS.Platform;
  arch: string;
  home: string;
  /** Directory the `working-directory` input is resolved against. */
  cwd: string;
  /** Version of the playwright package shipped with the bundle. */
  playwrightVersion(): string;
  listEntries(dir: string): string[];
  readRunRecord(runDir: string): Promise<RunRecord | undefined>;
  /** Reads the Event_Payload file as text. Throws when unreadable. */
  readEventFile(path: string): string;
  /** Git seam for the Publisher. Defaults to the system `git`. */
  gitRunner?: GitRunner;
  /** Lists the regular files of a Run_Dir, symlink-safe. Defaults to the artifact walker. */
  listRunFiles?(runDir: string): DirectoryEntry[];
}

interface PullRequestContext {
  number: number | undefined;
  headRepo: string | undefined;
  baseRepo: string | undefined;
  headRef: string | undefined;
  baseRef: string | undefined;
  /** The parsed Event_Payload, for the fork decision (Requirement 10.5). */
  payload: unknown;
}

/** Regular files under `runDir` with bundle-relative paths and sizes. */
export function listRunDirEntries(runDir: string): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  for (const full of listFilesRecursive(runDir)) {
    try {
      entries.push({
        relativePath: relative(runDir, full).split(/[\\/]/).join('/'),
        isFile: true,
        sizeBytes: statSync(full).size,
      });
    } catch {
      // unreadable file: leave it out
    }
  }
  return entries;
}

/** Text of a failed Git step for the log, redacted by the caller. */
function gitErrorText(error: unknown): string {
  if (error === null || typeof error !== 'object') return String(error);
  const e = error as { message?: unknown; result?: { stderr?: unknown }; stderr?: unknown };
  return [e.result?.stderr, e.stderr, e.message]
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .join('\n');
}

/** Reads only the PR number and the head and base repository names (Requirement 5.4). */
function readPullRequestContext(deps: ActionDeps): PullRequestContext | undefined {
  const path = deps.env['GITHUB_EVENT_PATH'];
  if (path === undefined || path === '') return undefined;
  try {
    const payload = JSON.parse(deps.readEventFile(path)) as unknown;
    const pr = (payload as { pull_request?: Record<string, unknown> } | null)?.pull_request;
    if (pr === null || typeof pr !== 'object') return undefined;
    const name = (side: unknown): string | undefined => {
      const full = ((side as { repo?: { full_name?: unknown } } | null)?.repo ?? {}).full_name;
      return typeof full === 'string' && full !== '' ? full : undefined;
    };
    const number = pr['number'];
    const ref = (side: unknown): string | undefined => {
      const r = (side as { ref?: unknown } | null)?.ref;
      return typeof r === 'string' && r !== '' ? r : undefined;
    };
    return {
      payload,
      headRef: ref(pr['head']),
      baseRef: ref(pr['base']),
      number: typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : undefined,
      headRepo: name(pr['head']),
      baseRepo: name(pr['base']),
    };
  } catch {
    return undefined;
  }
}

function isPullRequestEvent(name: string | undefined): boolean {
  return name === 'pull_request' || name === 'pull_request_target';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ends a run that concerns the evidence branch: one notice, empty outcome, exit code 0 (Requirement 12.1, 12.2). */
function skipEvidenceBranchRun(log: Pick<Logger, 'info'>, outputs: OutputSetter): void {
  log.info(
    'notice: CE does not run on the ce-evidence branch. No CLI run, publish, artifact or comment was made.',
  );
  outputs.set('outcome', '');
  outputs.set('exit-code', '0');
}

/**
 * Runs the whole Action. Resolves to the exit code the step must end with.
 * Never throws for an expected failure; the failure is logged and a non-zero code returned.
 */
export async function runAction(deps: ActionDeps): Promise<number> {
  const { adapters, env } = deps;
  const log = adapters.log;

  // 0. Evidence-branch guard: the very first statement, before any input is read, before the
  // cache restore and before any GitHub or Git call (Requirement 12.1, 12.3).
  if (isEvidenceBranchRun(env)) {
    skipEvidenceBranchRun(log, adapters.outputs);
    return 0;
  }

  // 1. Inputs. `publish` is validated before any other side effect (Requirement 1.6).
  const publishRaw = deps.getInput('publish').trim();
  let publishInputMode: PublishMode;
  try {
    publishInputMode = validatePublishMode(publishRaw);
  } catch (error) {
    log.error(message(error));
    return 1;
  }
  const token = resolveRunToken(
    deps.getInput('token').trim(),
    deps.getInput('github-token').trim(),
    deps.getInput('default-token').trim(),
  );
  // Mask the token, its base64 form and the full Authorization header before any git command
  // (Requirement 7.2).
  const maskedValues = credentialMaskValues(token);
  for (const value of maskedValues) log.mask(value);
  const commentEnabled = deps.getInput('comment').trim().toLowerCase() !== 'false';
  const commentAuthor = deps.getInput('comment-author').trim() || 'github-actions[bot]';
  const workingDirectory = deps.getInput('working-directory').trim();
  const cwd = resolve(deps.cwd, workingDirectory);

  // 2. Child invocation and environment.
  const invocation = buildChildInvocation({ getInput: (name) => deps.getInput(name) });
  for (const warning of invocation.warnings) log.warning(warning);
  const browsersPath = resolveBrowsersPath(env, deps.platform, deps.home);
  const childEnv = sanitizeChildEnv(env, token, {
    ...invocation.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  });

  // 3. Browser cache and Chromium install (Requirement 4).
  let cacheKey: string | undefined;
  try {
    cacheKey = buildCacheKey(
      env['RUNNER_OS'] ?? deps.platform,
      env['RUNNER_ARCH'] ?? deps.arch,
      deps.playwrightVersion(),
    );
  } catch (error) {
    log.warning(`Browser cache disabled: ${message(error)}`);
  }
  let cacheHit = false;
  if (cacheKey !== undefined) {
    try {
      cacheHit = await adapters.cache.restore([browsersPath], cacheKey);
    } catch (error) {
      log.warning(`Browser cache restore failed: ${message(error)}`);
    }
  }
  try {
    if (!cacheHit) await adapters.installer.installChromium(browsersPath);
    // Linux packages are not part of the cached directory, so install them on a hit too.
    if (deps.platform === 'linux') await adapters.installer.installLinuxDeps(browsersPath);
  } catch (error) {
    log.error(`Chromium install failed, CE was not run: ${message(error)}`);
    return 1;
  }

  // 4. Output directory snapshot, then the CE CLI.
  const configIndex = invocation.argv.indexOf('--config');
  const flags: Record<string, unknown> = {};
  if (configIndex >= 0) flags['config'] = invocation.argv[configIndex + 1];
  const outputDir = resolveEffectiveOutputDir({ cwd, flags, env: childEnv });
  // Effective publish settings (consumed by the publish pipeline, task 7.2).
  const publishSettings = resolvePublishSettings({ cwd, flags, env: childEnv }, publishInputMode);
  if (publishSettings.mode === 'branch') {
    log.info(
      `publish: branch (at most ${publishSettings.maxImages} images, ${publishSettings.maxImageBytes} bytes each)`,
    );
  }
  const before = outputDir === undefined ? [] : deps.listEntries(outputDir);

  const result = await deps.spawnCli({ args: ['run', ...invocation.argv], env: childEnv, cwd });

  let failed = false;
  if (result.error !== undefined) {
    failed = true;
    log.error(`The CE CLI could not be started: ${message(result.error)}`);
  } else if (result.exitCode === null) {
    failed = true;
    log.error(`The CE CLI ended by signal ${result.signal ?? 'unknown'}`);
  }
  const exitCode = result.error === undefined ? result.exitCode : null;

  // 5. Save the cache on a miss.
  if (!cacheHit && cacheKey !== undefined) {
    try {
      await adapters.cache.save([browsersPath], cacheKey);
    } catch (error) {
      log.warning(`Browser cache save failed: ${message(error)}`);
    }
  }

  // 6. Run_Dir and run.json.
  let runDir: string | undefined;
  if (outputDir !== undefined) {
    runDir = pickNewRunDir(outputDir, before, deps.listEntries(outputDir));
  }
  if (runDir === undefined) log.warning('No new Run_Dir was found; no artifact is uploaded.');
  const record = runDir === undefined ? undefined : await deps.readRunRecord(runDir);

  // 7. Artifact upload (also after a spawn failure).
  let upload: { id?: number } | undefined;
  if (runDir !== undefined) {
    const name = buildArtifactName({
      explicitName: deps.getInput('artifact-name').trim(),
      runId: env['GITHUB_RUN_ID'] ?? '',
      runAttempt: env['GITHUB_RUN_ATTEMPT'] ?? '',
      job: env['GITHUB_JOB'] ?? '',
      runDirName: runDir.split(/[\\/]/).pop() ?? '',
    });
    try {
      upload = await adapters.artifacts.upload(name, runDir);
    } catch (error) {
      log.warning(`Artifact upload failed: ${message(error)}`);
    }
  }
  const artifactLink = buildArtifactLink({
    serverUrl: env['GITHUB_SERVER_URL'] ?? 'https://github.com',
    repository: env['GITHUB_REPOSITORY'] ?? '',
    runId: env['GITHUB_RUN_ID'] ?? '',
    upload,
  });

  // 8. Publish screenshots (Requirement 2.2). Runs after the artifact upload attempt.
  const secrets = [...collectSecretValues(env), ...maskedValues];
  const pr = isPullRequestEvent(env['GITHUB_EVENT_NAME']) ? readPullRequestContext(deps) : undefined;
  const repository = env['GITHUB_REPOSITORY'] ?? '';
  const serverUrl = env['GITHUB_SERVER_URL'] ?? 'https://github.com';
  let publishResult: PublishResult = { kind: 'not-attempted' };
  if (publishSettings.mode === 'branch') {
    if (!commentEnabled) {
      log.info('notice: publish is "branch" but comment is false, so nothing is published.');
    }
    const decision = decidePrePublisher({
      publishMode: publishSettings.mode,
      commentEnabled,
      outcome: record?.outcome,
      isPullRequestEvent: pr?.number !== undefined,
      isForkPr: isForkPullRequest(pr?.payload),
      isEvidenceBranchRef: [pr?.headRef, pr?.baseRef, env['GITHUB_HEAD_REF'], env['GITHUB_BASE_REF']].some(
        (ref) => isEvidenceBranchRef(ref),
      ),
    });
    if (decision.kind === 'proceed') {
      const [owner = '', repo = ''] = repository.split('/');
      try {
        publishResult = await publish({
          runner: deps.gitRunner ?? createGitRunner(),
          runToken: token,
          record,
          runDir: runDir ?? '',
          listing: runDir === undefined ? [] : (deps.listRunFiles ?? listRunDirEntries)(runDir),
          prNumber: pr?.number ?? 0,
          runId: runDir === undefined ? '' : (runDir.split(/[\\/]/).pop() ?? ''),
          owner,
          repo,
          serverUrl,
          imageCap: publishSettings.maxImages,
          byteCapBytes: publishSettings.maxImageBytes,
          tmpBase: env['RUNNER_TEMP'],
          refs: [pr?.headRef, pr?.baseRef],
          warn: (m) => log.warning(redactSecretValues(m, secrets)),
          onGitError: (e) => log.info(redactSecretValues(gitErrorText(e), secrets)),
        });
      } catch (error) {
        // publish() does not throw; this keeps a bug there from failing the step.
        log.info(redactSecretValues(message(error), secrets));
        publishResult = { kind: 'fallback', reason: 'git-error' };
      }
    } else if (decision.kind === 'fallback') {
      publishResult = decision;
    }
    if (
      publishResult.kind === 'fallback' &&
      publishResult.reason !== 'no-images' &&
      publishResult.reason !== 'no-pr-number'
    ) {
      log.warning(redactSecretValues(fallbackNote(publishResult.reason), secrets));
    }
  }

  // 9. Render and redact the comment body, then comment or job summary.
  const unavailable: UnavailableRecord = {
    kind: 'unavailable',
    exitCode: exitCode ?? Number.NaN,
  };
  const rendered = renderPrComment({
    record: record ?? unavailable,
    artifactLink,
    secrets,
    publishResult,
    repository,
    serverUrl,
    prNumber: pr?.number,
  });
  const body = redactSecretValues(rendered, secrets);

  let commentUrl = '';
  let posted = false;
  if (!commentEnabled) {
    log.info('comment is false: the report is written to the job summary.');
  } else if (pr === undefined || pr.number === undefined) {
    log.info('Not a pull request event: the report is written to the job summary.');
  } else if (pr.headRepo === undefined || pr.baseRepo === undefined || pr.headRepo !== pr.baseRepo) {
    log.warning(
      'Fork pull request: no comment is posted because the token cannot write to the base repository. The report is written to the job summary.',
    );
  } else {
    try {
      const api = adapters.commentApi({
        token,
        apiUrl: env['GITHUB_API_URL'] ?? 'https://api.github.com',
        repository: env['GITHUB_REPOSITORY'] ?? '',
      });
      commentUrl = (await upsertComment(api, pr.number, commentAuthor, body)).url;
      posted = true;
    } catch (error) {
      log.warning(describeApiFailure(error));
    }
  }
  if (!posted) {
    try {
      adapters.summary.append(stripCommentMarker(body));
    } catch (error) {
      log.warning(`Could not write the job summary: ${message(error)}`);
    }
  }

  // 10. Outputs. `outcome` is read from the record as data.
  const out = adapters.outputs;
  out.set('outcome', record === undefined ? '' : String(record.outcome));
  out.set('run-dir', runDir ?? '');
  out.set('artifact-url', upload === undefined ? '' : artifactLink);
  out.set('comment-url', commentUrl);
  out.set('exit-code', exitCode === null ? '' : String(exitCode));

  if (failed) return 1;
  return exitCode ?? 1;
}

/** Locates the bundled CE CLI (`ce-cli.js`, built next to this file by scripts/build-action.mjs). */
export function resolveCeCli(from: string = import.meta.url): string {
  return join(dirname(fileURLToPath(from)), 'ce-cli.js');
}

function spawnCeCli(request: SpawnRequest): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    // Argument vector, no shell. Output goes straight to the workflow log.
    const child = spawn(process.execPath, [resolveCeCli(), ...request.args], {
      cwd: request.cwd,
      env: request.env,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', (error) => resolvePromise({ exitCode: null, signal: null, error }));
    child.on('close', (code, signal) => resolvePromise({ exitCode: code, signal }));
  });
}

export function createRealDeps(): ActionDeps {
  return {
    env: process.env,
    getInput: (name) => core.getInput(name),
    adapters: createGithubAdapters(),
    spawnCli: spawnCeCli,
    platform: process.platform,
    arch: process.arch,
    home: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
    cwd: process.env['GITHUB_WORKSPACE'] ?? process.cwd(),
    playwrightVersion: () => readPlaywrightVersion(),
    listEntries,
    readRunRecord,
    readEventFile: (path) => readFileSync(path, 'utf8'),
    gitRunner: createGitRunner(),
    listRunFiles: listRunDirEntries,
  };
}

async function main(): Promise<void> {
  // The guard comes first: before the real adapters (cache, artifact client, ...) are built.
  if (isEvidenceBranchRun(process.env)) {
    skipEvidenceBranchRun(createLogger(), createOutputSetter());
    process.exitCode = 0;
    return;
  }
  const code = await runAction(createRealDeps());
  process.exitCode = code;
}

// Run only when executed as the entry file, not when imported by tests.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    core.setFailed(message(error));
  });
}
