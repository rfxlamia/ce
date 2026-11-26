// Claim_Identifier: turns Claim_Candidates into Claims.
// --claim candidates (provider 'cli') are Declared_Claims and are never sent to Jev.
// Every other candidate gets one Classification_Request. Malformed answers and
// gateway errors propagate to the caller (assess.ts wraps them into StageError).

import type { ChangeContext } from '../context/types.js';
import type { JevGateway } from '../jev/gateway.js';
import { buildClassificationRequest } from '../jev/catalog.js';
import { readNoul } from './answers.js';
import type { AssessmentRecord, AssessmentSettings, Claim, Cut } from './types.js';

export interface ClassifyResult {
  claims: Claim[];
  /** One entry per classified candidate (not Declared_Claims), in candidate order. */
  classifications: AssessmentRecord['candidates'];
  /** Distinct Returned_Model_Ids, in order of first appearance. */
  modelIds: string[];
  /** One entry per Jev question asked, in candidate order. */
  questionsAsked: AssessmentRecord['questions'];
  /** Cuts recorded by the request builder. */
  cuts: Cut[];
}

export async function identifyClaims(
  context: ChangeContext,
  settings: AssessmentSettings,
  gateway: JevGateway,
): Promise<ClassifyResult> {
  const result: ClassifyResult = {
    claims: [],
    classifications: [],
    modelIds: [],
    questionsAsked: [],
    cuts: [],
  };

  for (const candidate of context.candidates) {
    if (candidate.provenance.provider === 'cli') {
      result.claims.push({
        id: candidate.id,
        text: candidate.text,
        probability: null,
        declared: true,
        provenance: candidate.provenance,
      });
      continue;
    }

    const { request, cuts } = buildClassificationRequest(context, candidate);
    result.cuts.push(...cuts);
    const response = await gateway.ask(request);
    const probability = readNoul(response.answers['is_behavior']);

    if (!result.modelIds.includes(response.model)) result.modelIds.push(response.model);
    result.questionsAsked.push({
      idVersion: request.questions['is_behavior']!.idVersion,
      subjectId: candidate.id,
      probability,
    });

    const becameClaim = probability >= settings.claimThreshold;
    result.classifications.push({ candidateId: candidate.id, probability, becameClaim });
    if (becameClaim) {
      result.claims.push({
        id: candidate.id,
        text: candidate.text,
        probability,
        declared: false,
        provenance: candidate.provenance,
      });
    }
  }

  return result;
}
