// Evidence_Summary and the SPEC section 7.2 minimum-evidence check.
// Pure and total: no I/O, no clock, no randomness, no environment access.

import type { Provenance } from '../context/types.js';

/** The five items of SPEC 7.2, as plain data the outcome resolver can check. */
export interface EvidenceSummary {
  change: {
    title?: string;
    description?: string;
    base?: string;
    head?: string;
    files: string[];
  };
  claim:
    | { status: 'identified'; id: string; text: string; provenance: Provenance }
    | { status: 'not_identified' };
  subject: { url: string };
  actions: { kind: string; description: string }[];
  observations: { step: number; screenshot: string }[];
  artifacts: { runDir: string; reportPath: string };
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * True when the summary carries every item SPEC 7.2 requires. A
 * `not_identified` claim is valid because it carries no claim text.
 */
export function satisfiesMinimumEvidence(summary: EvidenceSummary): boolean {
  const changeOk =
    nonEmpty(summary.change.title) ||
    nonEmpty(summary.change.description) ||
    nonEmpty(summary.change.base) ||
    nonEmpty(summary.change.head) ||
    summary.change.files.length > 0;

  const claimOk =
    summary.claim.status === 'not_identified'
      ? true
      : nonEmpty(summary.claim.id) && nonEmpty(summary.claim.text);

  const subjectOk = nonEmpty(summary.subject.url);
  const actionsOk = Array.isArray(summary.actions);
  const observationsOk =
    summary.observations.length > 0 && summary.observations.every((o) => nonEmpty(o.screenshot));
  const artifactsOk = nonEmpty(summary.artifacts.runDir) && nonEmpty(summary.artifacts.reportPath);

  return changeOk && claimOk && subjectOk && actionsOk && observationsOk && artifactsOk;
}
