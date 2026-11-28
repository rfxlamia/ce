/**
 * Publisher orchestration (Requirement 4.6, 4.7, 5, 8.4, 11, 12.5).
 *
 * select -> cap -> temp repo -> commit -> push (bounded retry) -> confirm ->
 * Image_URLs. Every Git command goes through the injected Git_Runner. The
 * Run_Token travels only in environment variables (Requirement 5.6).
 * `publish()` never throws: every failure is a `fallback` PublishResult.
 */
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PublishResult, RunRecord } from 'continuous-evidence';
import { EVIDENCE_BRANCH, isEvidenceBranchRef } from '../evidence-branch-guard.js';
import { applyCaps } from './cap.js';
import { classifyGitError } from './fallback.js';
import { credentialEnv, fixedGitEnv } from './git-runner.js';
import type { GitResult, GitRunner } from './git-runner.js';
import { assignPublishedNames, selectImagesDetailed } from './select.js';
import type { DirectoryEntry } from './select.js';
import { buildImageUrl } from './url.js';

/** Retries after the first push attempt (Requirement 5.7). */
export const MAX_PUSH_RETRIES = 3;

const AUTHOR_NAME = 'Continuous Evidence';
const AUTHOR_EMAIL = 'ce-evidence@users.noreply.github.com';
const BRANCH_REF = `refs/heads/${EVIDENCE_BRANCH}`;
const TRACKING_REF = `refs/remotes/origin/${EVIDENCE_BRANCH}`;

export interface PublishOptions {
  runner: GitRunner;
  runToken: string;
  record: RunRecord | undefined;
  runDir: string;
  listing: readonly DirectoryEntry[];
  prNumber: number;
  runId: string;
  owner: string;
  repo: string;
  serverUrl: string;
  imageCap: number;
  byteCapBytes: number;
  /** RUNNER_TEMP; falls back to `os.tmpdir()` when undefined or empty. */
  tmpBase?: string | undefined;
  /** PR head and base ref names; the Publisher re-checks them (Requirement 12.5). */
  refs?: ReadonlyArray<string | undefined>;
  /** Remote URL override. Defaults to `<serverUrl>/<owner>/<repo>.git`. Used by tests. */
  remoteUrl?: string;
  /** Receives warnings that carry no path text and no secret (Requirement 4.7). */
  warn?: (message: string) => void;
  /** Receives the raw error of a failed Git step, for the caller to redact and log. */
  onGitError?: (error: unknown) => void;
}

/** Fixed commit message (Requirement 5.5). No Claim, diff, or secret text. */
export function buildCommitMessage(prNumber: number, runId: string): string {
  // eslint-disable-next-line no-control-regex
  const safeRunId = runId.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  return `ce: evidence for PR #${prNumber} (${safeRunId})`;
}

function fail(reason: Extract<PublishResult, { kind: 'fallback' }>['reason']): PublishResult {
  return { kind: 'fallback', reason };
}

function errorText(error: unknown): string {
  if (error === null || typeof error !== 'object') return typeof error === 'string' ? error : '';
  const r = (error as { result?: Partial<GitResult> }).result;
  const own = error as { message?: unknown; stderr?: unknown };
  return [r?.stderr, r?.stdout, own.stderr, own.message]
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
}

function isNonFastForward(error: unknown): boolean {
  return /non-fast-forward|fetch first|stale info|tip of your current branch is behind/i.test(errorText(error));
}

/** A lost race on the ref itself: another writer created or locked the branch first. */
function isRefRace(error: unknown): boolean {
  return /cannot lock ref|reference already exists|failed to update ref|already exists/i.test(errorText(error));
}

function isMissingRemoteBranch(error: unknown): boolean {
  return /couldn't find remote ref/i.test(errorText(error));
}

function isSafeSegment(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return value !== '' && value !== '.' && !value.includes('/') && !value.includes('\\') && !value.includes('..') && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** Thrown inside the orchestration to carry a ready fallback result. */
class FallbackSignal extends Error {
  constructor(readonly reason: Extract<PublishResult, { kind: 'fallback' }>['reason']) {
    super(reason);
  }
}

export async function publish(options: PublishOptions): Promise<PublishResult> {
  let tempDir: string | undefined;
  try {
    // 1. Select and cap. No Git call when nothing is selected (Requirement 4.6).
    const selection = selectImagesDetailed(options.record, options.listing);
    for (const dropped of selection.dropped) {
      if (dropped.origin.kind === 'step') {
        options.warn?.(`publish: skipped the screenshot of step ${dropped.origin.index + 1} (path outside the run directory)`);
      } else {
        options.warn?.('publish: skipped the final screenshot (path outside the run directory)');
      }
    }
    const sizes = new Map(options.listing.map((e) => [e.relativePath, e.sizeBytes]));
    const sized = selection.selected.map((image) => ({
      ...image,
      sizeBytes: sizes.get(image.relativePath) ?? 0,
    }));
    const capped = applyCaps(sized, options.imageCap, options.byteCapBytes);
    if (capped.kept.length === 0) return fail('no-images');

    // 2. Defense in depth for the evidence-branch guard (Requirement 12.5).
    if ((options.refs ?? []).some((ref) => isEvidenceBranchRef(ref))) return fail('ref-guard');

    if (!Number.isInteger(options.prNumber) || options.prNumber <= 0) return fail('no-pr-number');
    if (!isSafeSegment(options.runId)) return fail('git-error');

    const images = assignPublishedNames(capped.kept);
    const evidencePath = `pr-${options.prNumber}/${options.runId}`;
    const remote =
      options.remoteUrl ?? `${options.serverUrl.replace(/\/+$/, '')}/${options.owner}/${options.repo}.git`;

    // 3. Temporary directory outside the repository under test, mode 0700.
    const base = options.tmpBase !== undefined && options.tmpBase !== '' ? options.tmpBase : tmpdir();
    tempDir = await mkdtemp(join(base, 'ce-publish-'));
    const work = join(tempDir, 'repo');
    await mkdir(work, { mode: 0o700 });

    const localEnv = {
      ...fixedGitEnv(),
      GIT_AUTHOR_NAME: AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
    };
    const remoteEnv = { ...localEnv, ...credentialEnv(options.runToken, options.serverUrl) };
    const git = (args: string[], remoteCommand = false): Promise<GitResult> =>
      options.runner({ args, cwd: work, env: remoteCommand ? remoteEnv : localEnv });

    // Run a step; on failure report the raw error and map it to a fallback.
    const guarded = async <T>(step: () => Promise<T>): Promise<T> => {
      try {
        return await step();
      } catch (error) {
        options.onGitError?.(error);
        throw new FallbackSignal(classifyGitError(error));
      }
    };

    await guarded(() => git(['init', '-q', '--template=']));

    /** Fetches the single Evidence_Branch, depth 1. Returns false when it does not exist yet. */
    const fetchTip = async (): Promise<boolean> => {
      try {
        await git(
          ['fetch', '--depth', '1', '--no-tags', remote, `+${BRANCH_REF}:${TRACKING_REF}`],
          true,
        );
        return true;
      } catch (error) {
        if (isMissingRemoteBranch(error)) return false;
        options.onGitError?.(error);
        throw new FallbackSignal(classifyGitError(error));
      }
    };

    /** Creates the one Evidence_Commit on the current tip (or as an orphan root). */
    const commitOnTip = async (tipExists: boolean): Promise<string> => {
      if (tipExists) {
        await guarded(() => git(['checkout', '-q', '-f', '-B', EVIDENCE_BRANCH, TRACKING_REF]));
      } else {
        await guarded(() => git(['symbolic-ref', 'HEAD', BRANCH_REF]));
      }
      for (const image of images) {
        const target = join(work, evidencePath, image.publishedName);
        await mkdir(dirname(target), { recursive: true });
        // Overwrites an existing file on a re-run with the same Run_Id (Requirement 5.10).
        await copyFile(join(options.runDir, image.relativePath), target);
      }
      await guarded(() => git(['add', '--', evidencePath]));
      await guarded(() =>
        git([
          'commit',
          '-q',
          '--allow-empty',
          '--no-verify',
          '--no-gpg-sign',
          '-m',
          buildCommitMessage(options.prNumber, options.runId),
        ]),
      );
      const head = await guarded(() => git(['rev-parse', 'HEAD']));
      return head.stdout.trim();
    };

    // 4 to 6. Fetch, commit, push; retry a non-fast-forward rejection.
    let tipExists = await fetchTip();
    let localSha = await commitOnTip(tipExists);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await git(['push', '-q', remote, `HEAD:${BRANCH_REF}`], true);
        break;
      } catch (error) {
        options.onGitError?.(error);
        const reason = classifyGitError(error);
        // A lost ref race is retried even though Git reports it as `[remote rejected]`.
        const retryable = isRefRace(error) || (reason === 'git-error' && isNonFastForward(error));
        if (!retryable) return fail(reason);
        if (attempt >= MAX_PUSH_RETRIES) return fail('push-conflict-exhausted');
        tipExists = await fetchTip();
        localSha = await commitOnTip(tipExists);
      }
    }

    // 7. Read the remote back before claiming success (Requirement 5.12).
    const listed = await guarded(() => git(['ls-remote', remote, BRANCH_REF], true));
    const tip = listed.stdout.trim().split(/\s+/)[0] ?? '';
    if (!/^[0-9a-f]{40}$/.test(tip)) return fail('git-error');
    if (tip !== localSha) {
      // Another run pushed right after us; our commit must still be reachable from the tip.
      await guarded(() => git(['fetch', '--depth', '100', '--no-tags', remote, `+${BRANCH_REF}:${TRACKING_REF}`], true));
      await guarded(() => git(['merge-base', '--is-ancestor', localSha, TRACKING_REF]));
    }

    // 8. Image_URLs come from the Confirmed_SHA only.
    const imageUrls = images.map((image) =>
      buildImageUrl({
        serverUrl: options.serverUrl,
        owner: options.owner,
        repo: options.repo,
        sha: localSha,
        prNumber: options.prNumber,
        runId: options.runId,
        file: image.publishedName,
      }),
    );
    return { kind: 'published', sha: localSha, imageUrls, skippedCount: capped.skippedCount };
  } catch (error) {
    if (error instanceof FallbackSignal) return fail(error.reason);
    options.onGitError?.(error);
    return fail(classifyGitError(error));
  } finally {
    if (tempDir !== undefined) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
