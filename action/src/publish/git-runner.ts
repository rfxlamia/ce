/**
 * Git_Runner seam (Requirement 5.6, 5.13, 5.14, 5.15; D8, D9, D10).
 *
 * Runs the system `git` binary through `execFile` with an argument vector.
 * No shell, no Git library. Tests inject a fake runner to record invocations
 * and to move the Fake_Remote tip between a fetch and a push.
 */
import { execFile } from 'node:child_process';

export interface GitInvocation {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Error thrown by a Git_Runner on a non-zero exit; carries the GitResult. */
export class GitCommandError extends Error {
  readonly result: GitResult;

  constructor(result: GitResult) {
    super(`git exited with code ${result.exitCode}`);
    this.name = 'GitCommandError';
    this.result = result;
  }
}

/** Runs `git <args>`. Rejects with a GitCommandError on a non-zero exit. */
export type GitRunner = (invocation: GitInvocation) => Promise<GitResult>;

const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/** Environment applied to every git command (Requirement 5.15). */
export function fixedGitEnv(): Record<string, string> {
  return {
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

/**
 * Credential environment for commands that contact the remote (Requirement 5.6).
 * The header travels only in these variables, never in argv, a URL, or a file.
 * `host` is the host or base URL the header is scoped to; a bare host name is
 * treated as an https URL, because Git matches `http.<url>.*` keys by URL.
 */
export function credentialEnv(runToken: string, host: string): Record<string, string> {
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${runToken}`).toString('base64')}`;
  const scope = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `https://${host}`;
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${scope}.extraheader`,
    GIT_CONFIG_VALUE_0: header,
  };
}

/**
 * Creates the real runner. The process environment is not inherited: only
 * PATH and HOME-less essentials plus the invocation's own env are passed, so
 * a stray user Git variable cannot change behavior.
 */
export function createGitRunner(): GitRunner {
  return (invocation) =>
    new Promise<GitResult>((resolve, reject) => {
      const base: Record<string, string> = {};
      const path = process.env['PATH'];
      if (path !== undefined) base['PATH'] = path;
      const env = { ...base, ...invocation.env };
      execFile(
        'git',
        invocation.args,
        { cwd: invocation.cwd, env, maxBuffer: MAX_BUFFER_BYTES, windowsHide: true },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }
          const code = (error as NodeJS.ErrnoException).code;
          const exitCode = typeof code === 'number' ? code : 1;
          const detail = typeof code === 'string' && stderr === '' ? `${code}: ${error.message}` : stderr;
          reject(new GitCommandError({ exitCode, stdout, stderr: detail }));
        },
      );
    });
}
