// Thin adapters over @actions/* and the GitHub REST comment routes
// (Requirements 4.x, 7.x, 11.11). Each adapter has an interface so tests can
// substitute fakes. Nothing here imports jev/ or talks to Jev.
//
// The Run_Token is held only inside the CommentApi closure. It is sent in the
// Authorization header to the host named by GITHUB_API_URL and is never logged,
// written, or placed in an error message.
import { spawn } from 'node:child_process';
import { appendFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import * as artifact from '@actions/artifact';
import * as cache from '@actions/cache';
import * as core from '@actions/core';
import { HttpClient } from '@actions/http-client';
import type { CommentApi } from './upsert.js';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Cache (Requirement 4.1, 4.3, 4.4, 4.6)
// ---------------------------------------------------------------------------

export interface BrowserCache {
  /** Returns true on an exact key hit, false on a miss. Throws on service failure. */
  restore(paths: string[], key: string): Promise<boolean>;
  /** Throws on service failure. A "already exists" race is not an error. */
  save(paths: string[], key: string): Promise<void>;
}

export function createBrowserCache(): BrowserCache {
  return {
    async restore(paths, key) {
      const hit = await cache.restoreCache(paths, key);
      return hit !== undefined && hit === key;
    },
    async save(paths, key) {
      try {
        await cache.saveCache(paths, key);
      } catch (error) {
        // Two jobs saving the same key race; the loser is harmless.
        if (error instanceof Error && error.name === 'ReserveCacheError') return;
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Chromium installer (Requirement 4.4, 4.5, 4.7, 4.8, 4.10)
// ---------------------------------------------------------------------------

export interface ChromiumInstaller {
  /** `playwright install chromium`. Rejects with a message naming the step on failure. */
  installChromium(browsersPath: string): Promise<void>;
  /** `playwright install-deps chromium` (Linux packages). Rejects on failure. */
  installLinuxDeps(browsersPath: string): Promise<void>;
}

/** Locates playwright-core's cli.js (not in its exports map), as the spike entry does. */
export function resolvePlaywrightCli(): string {
  return join(dirname(require.resolve('playwright-core/package.json')), 'cli.js');
}

function runNode(
  args: string[],
  env: NodeJS.ProcessEnv,
  step: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Argument vector, no shell, no PATH lookup of the interpreter.
    const child = spawn(process.execPath, args, { stdio: 'inherit', env, shell: false });
    child.on('error', (err) => reject(new Error(`${step} failed to start: ${err.message}`)));
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${step} failed (${signal !== null ? `signal ${signal}` : `exit code ${String(code)}`})`,
          ),
        );
    });
  });
}

export function createChromiumInstaller(
  baseEnv: NodeJS.ProcessEnv = process.env,
): ChromiumInstaller {
  const envFor = (browsersPath: string): NodeJS.ProcessEnv => ({
    ...baseEnv,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  });
  return {
    installChromium: (browsersPath) =>
      runNode(
        [resolvePlaywrightCli(), 'install', 'chromium'],
        envFor(browsersPath),
        'Chromium install (playwright install chromium)',
      ),
    installLinuxDeps: (browsersPath) =>
      runNode(
        [resolvePlaywrightCli(), 'install-deps', 'chromium'],
        envFor(browsersPath),
        'Chromium Linux packages install (playwright install-deps chromium)',
      ),
  };
}

// ---------------------------------------------------------------------------
// Artifact upload (Requirement 7.1, 7.3, 7.7, 7.8)
// ---------------------------------------------------------------------------

export interface ArtifactUploader {
  /**
   * Uploads every file under `runDir` with paths relative to `runDir`.
   * Returns the artifact id when the service returns one. Throws on failure.
   */
  upload(name: string, runDir: string): Promise<{ id?: number }>;
}

/**
 * All regular files under `dir`, absolute paths. Empty when absent.
 * Never followed or returned: symbolic links (file or directory), anything named
 * `.env` or `.env.*` (a directory named `.env` is skipped whole), and any path
 * that does not resolve inside the real path of `dir` (Requirement 7.7).
 */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    return out;
  }
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    for (const entry of entries) {
      const name = entry.name;
      if (name === '.env' || name.startsWith('.env.')) continue;
      // Dirent from withFileTypes does not follow links: a symlink is neither isFile nor isDirectory.
      if (entry.isSymbolicLink()) continue;
      const full = join(current, name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        let real: string;
        try {
          real = realpathSync(full);
        } catch {
          continue;
        }
        if (real === root || real.startsWith(root + sep)) out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}
export function createArtifactUploader(): ArtifactUploader {
  const client = new artifact.DefaultArtifactClient();
  return {
    async upload(name, runDir) {
      const files = listFilesRecursive(runDir);
      // The toolkit rejects an empty file list. An empty Run_Dir is not a step
      // failure (7.8): report "no id" so the caller falls back to the run URL.
      if (files.length === 0) return {};
      // rootDirectory = runDir keeps Run_Dir-relative paths inside the artifact.
      const result = await client.uploadArtifact(name, files, runDir);
      return result.id === undefined ? {} : { id: result.id };
    },
  };
}

// ---------------------------------------------------------------------------
// Comment API (Requirement 11.11)
// ---------------------------------------------------------------------------

export interface HttpStatusError extends Error {
  status: number;
}

function statusError(status: number, what: string): HttpStatusError {
  // Message carries the route description and status only: no URL query, no headers.
  const err = new Error(`GitHub API ${what} failed with HTTP ${status}`) as HttpStatusError;
  err.status = status;
  return err;
}

export interface CommentApiOptions {
  /** The Run_Token. Used only in the Authorization header. */
  token: string;
  /** GITHUB_API_URL, for example `https://api.github.com`. */
  apiUrl: string;
  /** `owner/name`. */
  repository: string;
  /** Page size for listComments. */
  perPage?: number;
}

/** Validates the API base URL. Only http(s) is accepted; credentials in the URL are rejected. */
function parseApiBase(apiUrl: string): URL {
  const url = new URL(apiUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('GITHUB_API_URL must be an http(s) URL');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('GITHUB_API_URL must not contain credentials');
  }
  return url;
}

export function createCommentApi(options: CommentApiOptions): CommentApi {
  const base = parseApiBase(options.apiUrl);
  const baseHref = base.href.replace(/\/+$/, '');
  const [owner, repo, ...rest] = options.repository.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error('GITHUB_REPOSITORY must have the form owner/name');
  }
  const repoPath = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const perPage = options.perPage ?? 100;
  // Redirects are off, so the Authorization header can never reach another host.
  const http = new HttpClient('continuous-evidence-action', undefined, {
    allowRedirects: false,
  });
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  async function call(
    verb: 'GET' | 'POST' | 'PATCH',
    path: string,
    what: string,
    payload?: unknown,
  ): Promise<unknown> {
    const url = `${baseHref}/repos/${repoPath}/${path}`;
    const res = await http.request(
      verb,
      url,
      payload === undefined ? null : JSON.stringify(payload),
      headers,
    );
    const status = res.message.statusCode ?? 0;
    const text = await res.readBody();
    if (status < 200 || status >= 300) throw statusError(status, what);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw statusError(status, `${what} (unparsable response)`);
    }
  }

  return {
    async listComments(pr, page) {
      const data = await call(
        'GET',
        `issues/${Math.trunc(pr)}/comments?per_page=${perPage}&page=${Math.trunc(page)}`,
        'list comments',
      );
      if (!Array.isArray(data)) throw statusError(200, 'list comments (unexpected response)');
      return data.map((c: { id: number; body?: string | null; user?: { login?: string } | null }) => ({
        id: c.id,
        body: typeof c.body === 'string' ? c.body : '',
        user: { login: c.user?.login ?? '' },
      }));
    },
    async createComment(pr, body) {
      const data = (await call('POST', `issues/${Math.trunc(pr)}/comments`, 'create comment', {
        body,
      })) as { id: number; html_url: string };
      return { id: data.id, html_url: data.html_url };
    },
    async updateComment(id, body) {
      const data = (await call('PATCH', `issues/comments/${Math.trunc(id)}`, 'update comment', {
        body,
      })) as { id: number; html_url: string };
      return { id: data.id, html_url: data.html_url };
    },
  };
}

// ---------------------------------------------------------------------------
// Job summary and outputs (Requirement 10.6)
// ---------------------------------------------------------------------------

export interface SummaryWriter {
  /** Appends `body` to the file named by GITHUB_STEP_SUMMARY. No-op when it is unset. */
  append(body: string): void;
}

export function createSummaryWriter(env: NodeJS.ProcessEnv = process.env): SummaryWriter {
  return {
    append(body) {
      const file = env['GITHUB_STEP_SUMMARY'];
      if (file === undefined || file === '') return;
      appendFileSync(file, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
    },
  };
}

export interface OutputSetter {
  set(name: string, value: string): void;
}

export function createOutputSetter(): OutputSetter {
  return { set: (name, value) => core.setOutput(name, value) };
}

/** Logging seam, so tests can capture warnings and the entry never needs `core` directly. */
export interface Logger {
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  /** Registers a value that the runner must mask in logs. */
  mask(value: string): void;
}

export function createLogger(): Logger {
  return {
    info: (m) => core.info(m),
    warning: (m) => core.warning(m),
    error: (m) => core.error(m),
    mask: (v) => {
      if (v !== '') core.setSecret(v);
    },
  };
}

/** The bundle of adapters the entry point receives. */
export interface GithubAdapters {
  cache: BrowserCache;
  installer: ChromiumInstaller;
  artifacts: ArtifactUploader;
  summary: SummaryWriter;
  outputs: OutputSetter;
  log: Logger;
  /** Builds the comment API for a Run_Token. The token never leaves this factory's closure. */
  commentApi(options: CommentApiOptions): CommentApi;
}

export function createGithubAdapters(): GithubAdapters {
  return {
    cache: createBrowserCache(),
    installer: createChromiumInstaller(),
    artifacts: createArtifactUploader(),
    summary: createSummaryWriter(),
    outputs: createOutputSetter(),
    log: createLogger(),
    commentApi: createCommentApi,
  };
}
