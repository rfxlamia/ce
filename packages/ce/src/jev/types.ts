import type { Question, TextWithAssets } from '@typesafe-ai/sdk';
import type { Stage } from '../errors.js';

/**
 * Type-only definitions shared by `catalog.ts` and `gateway.ts`.
 * This file holds no runtime code and calls no SDK helper.
 */

/** A catalog question together with the metadata the Call_Log records instead of question text. */
export interface BuiltCatalogQuestion {
  readonly id: string;
  readonly version: number;
  /** `${id}@${version}` */
  readonly idVersion: string;
  readonly type: Question['type'];
  readonly requiresImage: boolean;
  readonly labelsFixed: boolean;
  readonly question: Question;
}

/** A request to the Jev gateway. State and questions are built by `catalog.ts` only. */
export interface Jev_Request {
  stage: Stage;
  state: string | TextWithAssets;
  questions: Record<string, BuiltCatalogQuestion>;
}

/** Result shape shared by both transports (the dated model id, answers keyed by question name, usage). */
export interface RawSystemOneResult {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number | null; output_tokens: number | null };
}
