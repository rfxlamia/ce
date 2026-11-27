// Types for the Claims and Assessment stage. Every field is a plain
// JSON-serializable value (no Date, Map, Set, or function).

import type { Provenance } from '../context/types.js';

export type Surface =
  | 'browser_ui'
  | 'http_api'
  | 'cli'
  | 'backend_internal'
  | 'native_app'
  | 'non_runtime';

/** A Claim_Candidate that became a Claim (declared or classified). */
export interface Claim {
  id: string;
  text: string;
  /** null for a Declared_Claim (E1): no classifier probability exists. */
  probability: number | null;
  declared: boolean;
  provenance: Provenance;
}

/** One Subject the assessment questions were asked about: a Claim, or the Change_Subject. */
export interface AssessedSubject {
  id: string; // claim id, or 'change'
  kind: 'claim' | 'change';
  text: string;
  provenance: Provenance;
}

export interface PerClaimAssessment {
  claimId: string; // Claim id, or 'change'
  runtimeObservable: number;
  checksAdequate: number;
  surface: Surface;
  surfaceConfidence: number;
  needed: boolean;
  uncertain: boolean;
}

export type Cut = {
  /** File path, or a pseudo-path: `check:<n>`, `commit:<sha>`, `<title>`, `<description>`, `claim:<n>`. */
  file: string;
  reason: 'truncated' | 'dropped' | 'check-cap';
  isTest: boolean;
};

export interface AssessmentSettings {
  claimThreshold: number;
  observableThreshold: number;
  adequateThreshold: number;
  uncertaintyBand: number;
  onUncertain: 'evidence' | 'skip';
}

export interface AssessmentRecord {
  /** One entry per Jev question asked by this stage. */
  questions: {
    idVersion: string; // `${id}@${version}`
    subjectId: string; // candidate id, or Subject id
    probability?: number; // Noul
    probabilities?: Record<string, number>; // Choice
  }[];
  /** One entry per classified Claim_Candidate (not Declared_Claims; Decision D18). */
  candidates: { candidateId: string; probability: number; becameClaim: boolean }[];
  modelIds: string[]; // distinct Returned_Model_Ids
  settings: AssessmentSettings; // effective, resolved values
  cuts: Cut[];
  /**
   * Present only when no Claim was identified and the Change_Subject was not asked
   * because every changed file is a Documentation_File (Requirement 3 criterion 7).
   */
  subjectSkipped?: 'docs-only';
  /** Present only when decidedBy === 'policy' (Requirement 7 criterion 4). */
  policyDecision?: {
    policy: 'evidence' | 'skip';
    inBand: { subjectId: string; probability: 'runtimeObservable' | 'checksAdequate' }[];
  };
}

export interface Assessment {
  claimStatus: 'identified' | 'not_identified';
  subjects: AssessedSubject[];
  perClaim: PerClaimAssessment[];
  required: boolean;
  decidedBy: 'classifier' | 'policy';
  surface: Surface;
  record: AssessmentRecord;
}
