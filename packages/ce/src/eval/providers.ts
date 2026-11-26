// Fixture_Providers and Stub_Exec for the offline eval (Decision D16).
// The fixture replaces the git, github and junit providers; the production
// CLI provider is reused. Nothing here reads GITHUB_EVENT_PATH or runs git.

import type { EffectiveConfig } from '../config/schema.js';
import { resolveCliArgs } from '../context/providers/cli-args.js';
import type { GitExecOptions, GitExecResult, resolveGit } from '../context/providers/git.js';
import type { resolveGithubEvent } from '../context/providers/github-event.js';
import type { resolveJunit } from '../context/providers/junit.js';
import { resolveContext } from '../context/resolve.js';
import type { ChangeContext } from '../context/types.js';

/** Minimal structural shape of a fixture; `EvalFixtureFile` satisfies it. */
export interface FixtureChangeInput {
  change: {
    title?: string;
    description?: string;
    commits: { sha: string; message: string }[];
    files: {
      path: string;
      status: 'added' | 'modified' | 'deleted' | 'renamed';
      patch: string;
    }[];
    claims?: string[];
  };
  checks: { name: string; status: 'passed' | 'failed' | 'skipped' }[];
}

export function fixtureGitProvider(fixture: FixtureChangeInput): typeof resolveGit {
  return () => ({
    files: fixture.change.files.map((f) => ({
      path: f.path,
      status: f.status,
      patch: f.patch,
      provenance: { provider: 'git' as const, location: f.path },
    })),
    commits: fixture.change.commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      provenance: { provider: 'git' as const, location: c.sha },
    })),
    truncated: [],
    status: { name: 'git', status: 'used' },
  });
}

export function fixtureGithubProvider(fixture: FixtureChangeInput): typeof resolveGithubEvent {
  const { title, description } = fixture.change;
  return () => {
    if (title === undefined && description === undefined) {
      return { status: { name: 'github', status: 'unavailable', reason: 'source-absent' } };
    }
    return {
      pullRequest: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { body: description } : {}),
      },
      provenance: { provider: 'github', location: 'fixture' },
      status: { name: 'github', status: 'used' },
    };
  };
}

export function fixtureJunitProvider(fixture: FixtureChangeInput): typeof resolveJunit {
  return () => ({
    checks: fixture.checks.map((c) => ({
      name: c.name,
      status: c.status,
      provenance: { provider: 'junit' as const, location: c.name },
    })),
    status: { name: 'junit', status: 'used' },
  });
}

export interface FixtureProvidersOverride {
  git?: typeof resolveGit;
  github?: typeof resolveGithubEvent;
  junit?: typeof resolveJunit;
}

export interface StubExecCall {
  args: string[];
}

/** Records every call and returns an error result; never throws. */
export function createStubExec(): {
  exec: (args: string[], options: GitExecOptions) => GitExecResult;
  calls: StubExecCall[];
} {
  const calls: StubExecCall[] = [];
  return {
    calls,
    exec: (args) => {
      calls.push({ args });
      return {
        error: Object.assign(new Error('git not available in eval'), { code: 'ENOENT' }),
      };
    },
  };
}

/**
 * Builds a fixture's ChangeContext through the real resolveContext. The caller
 * raises StageError('context', cause) naming the fixture when
 * `execCalls.length > 0`.
 */
export function buildFixtureContext(
  fixture: FixtureChangeInput,
  options: {
    config: EffectiveConfig;
    env: Record<string, string | undefined>;
    /** Test seam: replaces individual fixture providers. Production code omits it. */
    providersOverride?: FixtureProvidersOverride;
  },
): { context: ChangeContext; execCalls: StubExecCall[] } {
  const stub = createStubExec();
  const context = resolveContext({
    config: options.config,
    cliOptions: { claim: fixture.change.claims ?? [] },
    env: options.env,
    cwd: '/eval',
    providers: {
      cli: resolveCliArgs,
      git: fixtureGitProvider(fixture),
      github: fixtureGithubProvider(fixture),
      junit: fixtureJunitProvider(fixture),
      ...options.providersOverride,
    },
    exec: stub.exec,
  });
  return { context, execCalls: stub.calls };
}
