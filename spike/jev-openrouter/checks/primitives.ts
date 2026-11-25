import { choice, noul, score } from '@typesafe-ai/sdk';
import type { SystemOneRequest, TypeSafeClient } from '@typesafe-ai/sdk';
import { timedCall } from '../lib/call.js';
import type { HarnessCallResult, RequestType } from '../lib/call.js';
import { diffAnswer } from '../lib/conformance.js';
import type { AnswerType, ConformanceEntry } from '../lib/conformance.js';

/** The Pinned_Model sent on the OpenRouter route. */
export const PINNED_MODEL = 'typesafe/jev-1.14';

/**
 * Synthetic state for the primitive probes. Question text is local to the spike
 * and must never be copied into packages/ce (jev/catalog.ts).
 */
const SYNTHETIC_STATE = {
  page: 'Checkout',
  elements: [
    { id: 'e1', role: 'button', name: 'Place order', enabled: true },
    { id: 'e2', role: 'link', name: 'Back to cart', enabled: true },
    { id: 'e3', role: 'textbox', name: 'Coupon code', enabled: true },
  ],
  lastAction: 'none',
};

interface Probe {
  requestType: Extract<RequestType, 'choice' | 'noul' | 'score'>;
  answerType: AnswerType;
  /** Name under which the answer comes back. */
  questionName: string;
  questions: SystemOneRequest['questions'];
}

const PROBES: Probe[] = [
  {
    requestType: 'choice',
    answerType: 'choice',
    questionName: 'next',
    questions: {
      next: choice('Which element should be activated to complete the purchase?', {
        e1: 'Place order button',
        e2: 'Back to cart link',
        e3: 'Coupon code textbox',
      }),
    },
  },
  {
    requestType: 'noul',
    answerType: 'noul',
    questionName: 'has_button',
    questions: {
      has_button: noul('Does the page contain a button named "Place order"?'),
    },
  },
  {
    requestType: 'score',
    answerType: 'score',
    questionName: 'readiness',
    questions: {
      readiness: score('How ready is this page for the user to finish checkout?', [
        'Not ready: nothing actionable',
        'Partly ready: some actions available',
        'Ready: the primary action is available',
      ]),
    },
  },
];

/** Performs one request and returns the parsed response. Injectable for tests. */
export type SystemOneCallFn = (request: SystemOneRequest) => Promise<unknown>;

export interface PrimitiveConformance {
  requestType: HarnessCallResult['requestType'];
  /** False when the call failed, so no answer existed to compare. */
  compared: boolean;
  /** Empty when conformant. */
  entries: ConformanceEntry[];
}

export interface PrimitivesOutput {
  results: HarnessCallResult[];
  conformance: PrimitiveConformance[];
}

/**
 * Send one choice, one noul and one score probe through the OpenRouter route.
 * A failed call is recorded and does not stop the others. No retries.
 */
export async function runPrimitives(
  client: TypeSafeClient,
  call: SystemOneCallFn = (request) => client.systemOne(request),
): Promise<PrimitivesOutput> {
  const results: HarnessCallResult[] = [];
  const conformance: PrimitiveConformance[] = [];

  for (const probe of PROBES) {
    const request: SystemOneRequest = {
      state: SYNTHETIC_STATE,
      questions: probe.questions,
      model: PINNED_MODEL,
    };
    const result = await timedCall(
      {
        requestType: probe.requestType,
        provider: 'openrouter',
        modelRequested: PINNED_MODEL,
        request,
      },
      () => call(request),
    );
    results.push(result);

    if (result.ok) {
      const answers = (result.raw.response as { answers?: Record<string, unknown> } | null)?.answers;
      conformance.push({
        requestType: probe.requestType,
        compared: true,
        entries: diffAnswer(probe.answerType, answers?.[probe.questionName]),
      });
    } else {
      conformance.push({ requestType: probe.requestType, compared: false, entries: [] });
    }
  }

  return { results, conformance };
}
