/**
 * Evidence-branch guard (Requirement 12).
 *
 * Pure functions that decide whether a run concerns the `ce-evidence` branch.
 * Matching is exact: a branch that merely contains the text (for example
 * `feature/ce-evidence-docs`) never matches.
 */

export const EVIDENCE_BRANCH = 'ce-evidence';

const EVIDENCE_REF = `refs/heads/${EVIDENCE_BRANCH}`;

/** True only when `ref` is exactly `ce-evidence` or `refs/heads/ce-evidence`. */
export function isEvidenceBranchRef(ref: string | undefined | null): boolean {
  return ref === EVIDENCE_BRANCH || ref === EVIDENCE_REF;
}

/** True when GITHUB_REF, GITHUB_HEAD_REF, or GITHUB_BASE_REF names the evidence branch. */
export function isEvidenceBranchRun(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    isEvidenceBranchRef(env['GITHUB_REF']) ||
    isEvidenceBranchRef(env['GITHUB_HEAD_REF']) ||
    isEvidenceBranchRef(env['GITHUB_BASE_REF'])
  );
}
