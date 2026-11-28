/**
 * Shared types for the `publish: branch` feature.
 *
 * These live in `packages/ce` so the Comment_Renderer can use them without
 * depending on `action/`. The Action imports them from `continuous-evidence`.
 * Types plus the pure `fallbackNote`; no I/O.
 */

/** Closed set of reasons a publish did not happen. */
export type FallbackReason =
  | 'fork-pr'
  | 'no-pr-number'
  | 'no-images'
  | 'token-lacks-write'
  | 'push-blocked'
  | 'push-conflict-exhausted'
  | 'ref-guard'
  | 'git-error';

/** Result of the pre-Publisher decision and the Publisher itself. */
export type PublishResult =
  | {
      kind: 'published';
      /** Confirmed_SHA of the Evidence_Commit; the only SHA used in Image_URLs. */
      sha: string;
      imageUrls: string[];
      skippedCount: number;
    }
  | { kind: 'fallback'; reason: FallbackReason }
  | { kind: 'not-attempted' };

/**
 * One fixed note per Fallback_Reason. Pure and total. Notes are single-line,
 * distinct, and never carry raw Git output, a token, or a URL.
 */
export function fallbackNote(reason: FallbackReason): string {
  switch (reason) {
    case 'fork-pr':
      return 'publish skipped: fork PR';
    case 'no-pr-number':
      return 'publish skipped: not a pull request event';
    case 'no-images':
      return 'publish skipped: no screenshots in this run';
    case 'token-lacks-write':
      return 'publish skipped: the token cannot push (needs contents: write)';
    case 'push-blocked':
      return 'publish skipped: push to the ce-evidence branch was blocked by branch protection or a ruleset';
    case 'push-conflict-exhausted':
      return 'publish skipped: the ce-evidence branch kept changing, gave up after 3 retries';
    case 'ref-guard':
      return 'publish skipped: CE does not publish for the ce-evidence branch';
    case 'git-error':
      return 'publish skipped: a Git error occurred (see the workflow log)';
  }
}
