// Shared types for the context resolver. Types only; every shape is plain
// JSON-serializable data (no Date, Map, Set, functions, undefined-only unions
// beyond optional properties). Nothing here imports from jev/.

export type Provenance = {
  provider: 'git' | 'github' | 'cli' | 'junit' | 'config' | 'runtime';
  ref?: string;
  location?: string;
};

export type ReasonCode =
  | 'not-a-repository'
  | 'base-unresolved'
  | 'merge-base-missing'
  | 'git-failed'
  | 'head-missing'
  | 'source-absent'
  | 'source-unreadable'
  | 'source-malformed'
  | 'no-input'
  | 'not-configured';

export type TruncationReason =
  | 'dropped'
  | 'truncated'
  | 'env-file'
  | 'sensitive-file'
  | 'binary'
  | 'candidate-cap'
  | 'check-cap';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch: string;
  provenance: Provenance;
}

export interface ChangeContext {
  change: {
    title?: string;
    description?: string;
    base?: string;
    head?: string;
    files: ChangedFile[];
    commits: { sha: string; message: string; provenance: Provenance }[];
    claims: { text: string; provenance: Provenance }[];
    provenance: Provenance[];
  };
  candidates: { id: string; text: string; provenance: Provenance }[];
  checks: {
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    covers?: string[];
    provenance: Provenance;
  }[];
  truncated: { file: string; reason: TruncationReason }[];
  providers: {
    name: 'git' | 'github' | 'cli' | 'junit';
    status: 'used' | 'unavailable';
    reason?: ReasonCode;
  }[];
  redactions: { file: string; count: number }[];
}

/**
 * The context as assembled from the Providers, before the Budgeter and the
 * Candidate_Extractor run. Candidates are produced after budgeting, so they
 * are absent here.
 */
export type RawChangeContext = Omit<ChangeContext, 'candidates'>;

/**
 * The context after the Redactor and the Budgeter ran. Same shape as
 * RawChangeContext; the alias names the stage the Candidate_Extractor reads.
 */
export type BudgetedChangeContext = RawChangeContext;

/** One Claim_Candidate before ids are assigned. */
export type ClaimCandidate = { id: string; text: string; provenance: Provenance };
