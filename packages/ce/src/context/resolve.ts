// Context resolver: Base_Ref and Head_Commit selection (Requirement 2).
// Both selectors are pure given the injected `commitExists` probe, which the
// caller binds to `git rev-parse --verify --quiet <ref>^{commit}` (Decision
// D28; contacts no remote). resolveContext (Requirement 10) follows them.

import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compileRedactPattern } from '../config/redact-pattern.js';
import type { EffectiveConfig } from '../config/schema.js';
import { collectSecretValues } from '../config/secrets.js';
import { StageError } from '../errors.js';
import { budget } from './budget.js';
import { extractCandidates } from './candidates.js';
import { redact } from './redact.js';
import { resolveCliArgs } from './providers/cli-args.js';
import { resolveGit } from './providers/git.js';
import type { GitExecOptions, GitExecResult } from './providers/git.js';
import { resolveGithubEvent } from './providers/github-event.js';
import { resolveJunit } from './providers/junit.js';
import type {
  ChangeContext,
  ChangedFile,
  Provenance,
  RawChangeContext,
  TruncationReason,
} from './types.js';

const ZERO_SHA = '0'.repeat(40);

export interface BaseRefSources {
  /** `--base` as supplied by the CLI Provider (its provenance is `cli`/`--base`). */
  cliBase?: { ref: string; provenance: Provenance };
  /** `pull_request.base` of the GitHub payload. */
  githubPrBase?: { sha?: string; ref?: string };
  /** `before` of a push payload. */
  githubPushBefore?: string;
  /** `context.base` of the Effective_Config. */
  configBase?: string;
  commitExists: (ref: string) => boolean;
}

export interface HeadRefSources {
  githubHeadSha?: string;
  commitExists: (ref: string) => boolean;
}

const nonEmpty = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length > 0;

/** Base_Ref priority (D4): --base, GitHub payload, context.base, origin/main. */
export function selectBaseRef(sources: BaseRefSources): {
  ref: string;
  provenance: Provenance;
} {
  const { cliBase, githubPrBase, githubPushBefore, configBase, commitExists } = sources;

  if (cliBase && nonEmpty(cliBase.ref)) {
    return { ref: cliBase.ref, provenance: cliBase.provenance };
  }

  if (githubPrBase) {
    if (nonEmpty(githubPrBase.sha)) {
      return {
        ref: githubPrBase.sha,
        provenance: { provider: 'github', location: 'pull_request.base.sha' },
      };
    }
    if (nonEmpty(githubPrBase.ref)) {
      return {
        ref: `origin/${githubPrBase.ref}`,
        provenance: { provider: 'github', location: 'pull_request.base.ref' },
      };
    }
  }

  // D18/D28: all-zeros or unresolvable `before` is ignored, not an error.
  if (
    nonEmpty(githubPushBefore) &&
    githubPushBefore !== ZERO_SHA &&
    commitExists(githubPushBefore)
  ) {
    return {
      ref: githubPushBefore,
      provenance: { provider: 'github', location: 'push.before' },
    };
  }

  if (nonEmpty(configBase)) {
    return { ref: configBase, provenance: { provider: 'config', location: 'context.base' } };
  }

  return {
    ref: 'origin/main',
    provenance: { provider: 'config', location: 'default:origin/main' },
  };
}

/** Head_Commit selection (D9, D29). */
export function selectHeadRef(sources: HeadRefSources): {
  ref: string;
  provenance: Provenance;
  headMissing: boolean;
} {
  const { githubHeadSha, commitExists } = sources;
  if (nonEmpty(githubHeadSha)) {
    if (commitExists(githubHeadSha)) {
      return {
        ref: githubHeadSha,
        provenance: { provider: 'github', location: 'pull_request.head.sha' },
        headMissing: false,
      };
    }
    return { ref: 'HEAD', provenance: { provider: 'git', location: 'HEAD' }, headMissing: true };
  }
  return { ref: 'HEAD', provenance: { provider: 'git', location: 'HEAD' }, headMissing: false };
}

// ---------------------------------------------------------------------------
// resolveContext (Requirement 10)

export const CHECK_CAP = 200;

export interface ResolveContextOptions {
  config: EffectiveConfig;
  cliOptions: { claim?: string[]; base?: string };
  env: Record<string, string | undefined>;
  cwd: string;
  providers?: {
    cli?: typeof resolveCliArgs;
    github?: typeof resolveGithubEvent;
    git?: typeof resolveGit;
    junit?: typeof resolveJunit;
  };
  /** Test hook: replaces the real git runner used by the default wiring. */
  exec?: (args: string[], options: GitExecOptions) => GitExecResult;
}

/** Real git runner. The env the git provider passes is merged into process.env. */
function defaultExec(args: string[], options: GitExecOptions): GitExecResult {
  const r = spawnSync('git', args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    maxBuffer: options.maxBuffer,
    encoding: 'utf8',
  });
  if (r.error) return { error: r.error as NodeJS.ErrnoException };
  if (r.status !== 0) {
    return { error: Object.assign(new Error('git exited with failure'), { code: String(r.status) }) };
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        walk(p);
      } else if (e.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

const PROVIDER_RECORD_REASONS = new Set<TruncationReason>([
  'binary',
  'env-file',
  'sensitive-file',
  'dropped',
]);

export function resolveContext(options: ResolveContextOptions): ChangeContext {
  try {
    return resolveContextUnsafe(options);
  } catch (cause) {
    if (cause instanceof StageError) throw cause;
    throw new StageError('context', cause);
  }
}

function resolveContextUnsafe(options: ResolveContextOptions): ChangeContext {
  const { config, cliOptions, cwd } = options;
  const exec = options.exec ?? defaultExec;
  const p = options.providers ?? {};
  const ctxConfig = config.context ?? {};

  // Read the environment once; compile patterns before any text is handled.
  const secrets = collectSecretValues(options.env);
  let configuredPatterns: RegExp[];
  try {
    configuredPatterns = (ctxConfig.redact ?? []).map((item) => compileRedactPattern(item));
  } catch (cause) {
    throw new StageError('context', cause);
  }

  const commitExists = (ref: string): boolean => {
    try {
      const r = exec(
        ['--no-optional-locks', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
        { maxBuffer: 1024 * 1024, cwd, env: { GIT_OPTIONAL_LOCKS: '0' } },
      );
      return !('error' in r) && r.stdout.trim() !== '';
    } catch {
      return false;
    }
  };

  // 1. Independent providers.
  const cli = (p.cli ?? resolveCliArgs)(cliOptions);
  const github = (p.github ?? resolveGithubEvent)({
    ...(options.env.GITHUB_EVENT_PATH !== undefined ? { eventPath: options.env.GITHUB_EVENT_PATH } : {}),
    readFile: (path) => readFileSync(path, 'utf8'),
  });
  const junit = (p.junit ?? resolveJunit)({
    cwd,
    ...(ctxConfig.checks !== undefined ? { checksPattern: ctxConfig.checks } : {}),
    listFiles: (dir) => listFilesRecursive(dir),
    lstat: (path) => {
      try {
        return lstatSync(path);
      } catch {
        return undefined;
      }
    },
    readFile: (path) => {
      const size = statSync(path).size;
      return { size, text: () => readFileSync(path, 'utf8') };
    },
  });

  // 2. Refs.
  const pr = github.pullRequest;
  const pushBefore = pr ? undefined : github.push?.before;
  const base = selectBaseRef({
    ...(cli.base ? { cliBase: cli.base } : {}),
    ...(pr ? { githubPrBase: { ...(pr.baseSha ? { sha: pr.baseSha } : {}), ...(pr.baseRef ? { ref: pr.baseRef } : {}) } } : {}),
    ...(pushBefore !== undefined ? { githubPushBefore: pushBefore } : {}),
    ...(ctxConfig.base !== undefined ? { configBase: ctxConfig.base } : {}),
    commitExists,
  });
  const head = selectHeadRef({
    ...(pr?.headSha ? { githubHeadSha: pr.headSha } : {}),
    commitExists,
  });

  // 3. Git.
  const git = (p.git ?? resolveGit)({
    cwd,
    baseRef: base,
    headRef: head,
    ...(ctxConfig.include ? { include: ctxConfig.include } : {}),
    ...(ctxConfig.exclude ? { exclude: ctxConfig.exclude } : {}),
    exec,
  });

  // GitHub status: a push `before` that is unusable counts as absent (3.9).
  let githubStatus = github.status;
  if (
    githubStatus.status === 'used' &&
    !pr &&
    !(
      pushBefore !== undefined &&
      pushBefore !== '0'.repeat(40) &&
      commitExists(pushBefore)
    )
  ) {
    githubStatus = { name: 'github', status: 'unavailable', reason: 'source-absent' };
  }
  const githubUsed = githubStatus.status === 'used';

  // Redaction helpers.
  const counts = new Map<string, number>();
  const red = (
    text: string,
    key: string,
    textKind: 'patch' | 'text',
    extension?: string,
  ): string => {
    const r = redact(text, {
      secrets,
      configuredPatterns,
      textKind,
      ...(extension !== undefined ? { extension } : {}),
    });
    if (r.count > 0) counts.set(key, (counts.get(key) ?? 0) + r.count);
    return r.text;
  };
  const quiet = (text: string): string =>
    redact(text, { secrets, configuredPatterns, textKind: 'text' }).text;

  // 4. Assemble and redact.
  const gitUsed = git.status.status === 'used';
  const provenance: Provenance[] = [];
  const change: RawChangeContext['change'] = {
    files: [],
    commits: [],
    claims: [],
    provenance,
  };

  if (githubUsed && pr?.title !== undefined) {
    change.title = red(pr.title, '<title>', 'text');
    provenance.push({ provider: 'github', location: 'title' });
  }
  if (githubUsed && pr?.body !== undefined) {
    change.description = red(pr.body, '<description>', 'text');
    provenance.push({ provider: 'github', location: 'description' });
  }
  if (gitUsed) {
    change.base = quiet(base.ref);
    provenance.push(base.provenance);
    if (git.head) {
      change.head = git.head.sha;
      provenance.push(git.head.provenance);
    }
    change.files = git.files.map((f): ChangedFile => {
      const path = red(f.path, quiet(f.path), 'text');
      const file: ChangedFile = {
        ...f,
        path,
        patch: red(f.patch, path, 'patch', extensionOf(f.path)),
        provenance: { ...f.provenance, ...(f.provenance.location !== undefined ? { location: path } : {}) },
      };
      if (f.oldPath !== undefined) file.oldPath = red(f.oldPath, path, 'text');
      return file;
    });
    change.commits = git.commits.map((c) => ({
      ...c,
      message: red(c.message, `commit:${c.sha}`, 'text'),
    }));
  }
  change.claims = cli.claims.map((c, i) => ({ ...c, text: red(c.text, `claim:${i + 1}`, 'text') }));

  // Checks, redacted then capped.
  let checks = junit.checks.map((c) => ({
    ...c,
    name: red(c.name, c.provenance.location ?? 'check', 'text'),
  }));
  const checkRecords: { file: string; reason: TruncationReason }[] = [];
  if (checks.length > CHECK_CAP) {
    const rank = (s: string): number => (s === 'failed' ? 0 : s === 'skipped' ? 1 : 2);
    const keep = new Set(
      checks
        .map((c, i) => ({ i, r: rank(c.status) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .slice(0, CHECK_CAP)
        .map((x) => x.i),
    );
    const removed = checks.length - CHECK_CAP;
    checks = checks.filter((_, i) => keep.has(i));
    checkRecords.push({ file: `check:${removed}`, reason: 'check-cap' });
  }

  const providerRecords = git.truncated
    .filter((t) => PROVIDER_RECORD_REASONS.has(t.reason))
    .map((t) => ({ file: quiet(t.file), reason: t.reason }))
    .sort((a, b) => compareBytes(a.file, b.file));

  const raw: RawChangeContext = {
    change,
    checks,
    truncated: providerRecords,
    providers: [
      git.status,
      { ...githubStatus },
      cli.status,
      junit.status,
    ],
    redactions: [...counts.entries()]
      .sort((a, b) => compareBytes(a[0], b[0]))
      .map(([file, count]) => ({ file, count })),
  };

  // 6. Budget, 7. candidates.
  const budgeted = budget(raw);
  const extracted = extractCandidates(budgeted.context);
  const truncated = [
    ...providerRecords,
    ...budgeted.truncated,
    ...checkRecords,
    ...(extracted.truncated ? [extracted.truncated] : []),
  ];

  return {
    ...budgeted.context,
    candidates: extracted.candidates,
    truncated,
    redactions: raw.redactions,
  };
}
