// Pre-Publisher decision table (Requirement 2.10). Pure: no I/O, no GitHub API call.

import type { RunRecord } from 'continuous-evidence';
import type { PublishMode } from '../publish.js';

export interface PrePublisherContext {
  publishMode: PublishMode;
  commentEnabled: boolean;
  /** `undefined` means the Run_Record is unavailable; the table continues. */
  outcome: RunRecord['outcome'] | undefined;
  isPullRequestEvent: boolean;
  isForkPr: boolean;
  /** True when the PR head or base ref names the Evidence_Branch. */
  isEvidenceBranchRef: boolean;
}

export type PrePublisherDecision =
  | { kind: 'not-attempted' }
  | { kind: 'fallback'; reason: 'no-pr-number' | 'fork-pr' | 'ref-guard' }
  | { kind: 'proceed' };

/**
 * Evaluated in fixed order: comment disabled, Outcome SKIPPED or UNSUPPORTED,
 * not a PR event, fork PR, evidence-branch ref, proceed. The caller only
 * invokes this when `publishMode === 'branch'`.
 */
export function decidePrePublisher(ctx: PrePublisherContext): PrePublisherDecision {
  if (!ctx.commentEnabled) return { kind: 'not-attempted' };
  if (ctx.outcome === 'SKIPPED' || ctx.outcome === 'UNSUPPORTED') {
    return { kind: 'not-attempted' };
  }
  if (!ctx.isPullRequestEvent) return { kind: 'fallback', reason: 'no-pr-number' };
  if (ctx.isForkPr) return { kind: 'fallback', reason: 'fork-pr' };
  if (ctx.isEvidenceBranchRef) return { kind: 'fallback', reason: 'ref-guard' };
  return { kind: 'proceed' };
}

function repoFullName(side: unknown): string | undefined {
  if (typeof side !== 'object' || side === null) return undefined;
  const repo = (side as { repo?: unknown }).repo;
  if (typeof repo !== 'object' || repo === null) return undefined;
  const name = (repo as { full_name?: unknown }).full_name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/**
 * Decides the fork condition from the Event_Payload alone (Requirement 10.5).
 * A missing head or base repository name counts as a fork (Requirement 10.6).
 */
export function isForkPullRequest(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return true;
  const pr = (payload as { pull_request?: unknown }).pull_request;
  if (typeof pr !== 'object' || pr === null) return true;
  const head = repoFullName((pr as { head?: unknown }).head);
  const base = repoFullName((pr as { base?: unknown }).base);
  if (head === undefined || base === undefined) return true;
  return head !== base;
}
