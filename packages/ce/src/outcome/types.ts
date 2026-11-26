import type { Assessment, Surface } from '../assessment/index.js';
import type { Stage, StageError } from '../errors.js';
import type { EvidenceSummary } from './evidence.js';

/** The four SPEC §7.1 outcomes. The only literal declaration outside resolve.ts. */
export const OUTCOMES = ['SKIPPED', 'EVIDENCED', 'UNSUPPORTED', 'ERROR'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type FinalState = 'reached' | 'not_reached';

/** The v0 Capability_Catalog (SPEC §5, journal §4): the only supported Surface. */
export const V0_SUPPORTED_SURFACES = ['browser_ui'] as const satisfies readonly Surface[];

export type ResolveReason =
  | 'stage-error'
  | 'assessment-missing'
  | 'not-required'
  | 'surface-unsupported'
  | 'evidence-collected'
  | 'no-observation'
  | 'evidence-incomplete';

export interface RuntimeResult {
  finalState: FinalState;
  evidence: EvidenceSummary;
}

export interface ResolveInput {
  error?: StageError;
  assessment?: Pick<Assessment, 'required' | 'surface'>;
  runtime?: RuntimeResult;
  supportedSurfaces?: readonly Surface[];
}

export interface Resolution {
  outcome: Outcome;
  reason: ResolveReason;
  /** Present iff outcome === 'EVIDENCED'. */
  finalState?: FinalState;
  /** Present iff reason === 'stage-error'. */
  errorStage?: Stage;
  /** The Dominant_Surface, when an assessment was present. */
  surface?: Surface;
}
