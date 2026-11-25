import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { image } from '@typesafe-ai/sdk';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { timedCall } from '../lib/call.js';
import type { HarnessCallResult, RequestType } from '../lib/call.js';
import type { Provider } from '../lib/client.js';
import { computeStats } from '../lib/stats.js';
import type { LatencyStats } from '../lib/stats.js';

/** Model for the text-only Next_Action_Request. */
export const NEXT_ACTION_MODEL = 'typesafe/jev-1.14';
/** `box` needs the preview model (SDK README). Recorded explicitly as an override. */
export const FINAL_IMAGE_MODEL = 'jev-preview';
export const IMAGE_HEADER = { 'TypeSafe-Danger-Zone-Images': 'true' } as const;

export const DEFAULT_SAMPLE_COUNT = 20;
export const NEXT_ACTION_OPTION_COUNT = 100;

/** Stated budget: 90 s timeout / 12 steps = 7.5 s per step (Req 3.7). */
export const STEP_BUDGET = {
  timeoutSeconds: 90,
  steps: 12,
  perStepMs: (90 / 12) * 1000,
} as const;

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE_PATH = join(here, '..', 'fixtures', 'demo-app-screenshot.png');

export interface RateLimitOccurrence {
  requestType: RequestType;
  /** 1-based sample index within its request type. */
  sampleIndex: number;
  httpStatus?: number;
  retryAfter?: string;
}

export interface LatencyRequestSummary {
  requestType: RequestType;
  status: 'ran' | 'not-run';
  /** Cause when `not-run`. */
  reason?: string;
  modelRequested: string;
  requestedSamples: number;
  stats: LatencyStats;
  /** Number of options offered to the classifier (Next_Action_Request only). */
  optionCount?: number;
  /** Reported input tokens of successful calls (Req 3.4). */
  inputTokens: number[];
  rateLimits: RateLimitOccurrence[];
  /** p95 latency compared with the per-step budget. Judgment of fit stays with the Findings_Document. */
  budget: {
    perStepMs: number;
    p50WithinBudget: boolean | null;
    p95WithinBudget: boolean | null;
  };
}

export interface LatencyCheckResult {
  budget: typeof STEP_BUDGET;
  nextAction: LatencyRequestSummary;
  finalImage: LatencyRequestSummary;
  /** Single labelled diagnostic calls (one each) isolating why image/box requests fail. Not part of the stats. */
  diagnostics: HarnessCallResult[];
  /** All raw call results, in send order, for Raw_Samples. */
  calls: HarnessCallResult[];
}

export interface LatencyCheckOptions {
  client: TypeSafeClient;
  provider?: Provider;
  sampleCount?: number;
  fixturePath?: string;
  /** Injectable for tests. */
  now?: () => number;
  /** Calls are pushed here as they happen, so a caller keeps partial calls if the check throws. */
  sink?: HarnessCallResult[];
}

/** Locally invented option labels. Question text stays in the harness (never catalog.ts). */
export function buildOptions(count: number): Record<string, string> {
  const verbs = ['click', 'focus', 'hover', 'scroll to', 'read', 'toggle', 'open', 'dismiss'];
  const targets = ['save button', 'search field', 'nav link', 'cart icon', 'filter chip', 'row menu', 'tab header', 'help link', 'theme switch', 'footer link', 'modal close', 'pager next', 'sort header'];
  const options: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const label = `opt_${String(i + 1).padStart(3, '0')}`;
    options[label] = `${verbs[i % verbs.length]} the ${targets[i % targets.length]} number ${i + 1}`;
  }
  return options;
}

function emptyStats(): LatencyStats {
  return computeStats([], 0);
}

function summarize(
  requestType: RequestType,
  modelRequested: string,
  requestedSamples: number,
  calls: HarnessCallResult[],
  optionCount?: number,
): LatencyRequestSummary {
  const ok = calls.filter((c) => c.ok);
  const stats = computeStats(ok.map((c) => c.latencyMs), calls.length - ok.length);
  const rateLimits: RateLimitOccurrence[] = [];
  calls.forEach((c, i) => {
    if (c.httpStatus === 429 || c.retryAfter !== undefined) {
      rateLimits.push({
        requestType,
        sampleIndex: i + 1,
        ...(c.httpStatus !== undefined ? { httpStatus: c.httpStatus } : {}),
        ...(c.retryAfter !== undefined ? { retryAfter: c.retryAfter } : {}),
      });
    }
  });
  const within = (v: number): boolean | null => (Number.isNaN(v) ? null : v <= STEP_BUDGET.perStepMs);
  return {
    requestType,
    status: 'ran',
    modelRequested,
    requestedSamples,
    stats,
    ...(optionCount !== undefined ? { optionCount } : {}),
    inputTokens: ok.flatMap((c) => (c.inputTokens !== undefined ? [c.inputTokens] : [])),
    rateLimits,
    budget: { perStepMs: STEP_BUDGET.perStepMs, p50WithinBudget: within(stats.p50), p95WithinBudget: within(stats.p95) },
  };
}

function notRun(requestType: RequestType, modelRequested: string, requestedSamples: number, reason: string): LatencyRequestSummary {
  return {
    requestType,
    status: 'not-run',
    reason,
    modelRequested,
    requestedSamples,
    stats: emptyStats(),
    inputTokens: [],
    rateLimits: [],
    budget: { perStepMs: STEP_BUDGET.perStepMs, p50WithinBudget: null, p95WithinBudget: null },
  };
}

/**
 * Send `sampleCount` sequential Next_Action_Request and Final_Image_Request samples
 * and compute latency statistics from successes only. Never retries, never throws.
 */
export async function runLatencyCheck(opts: LatencyCheckOptions): Promise<LatencyCheckResult> {
  const { client } = opts;
  const provider: Provider = opts.provider ?? 'openrouter';
  const sampleCount = Math.max(1, Math.floor(opts.sampleCount ?? DEFAULT_SAMPLE_COUNT));
  const fixturePath = opts.fixturePath ?? DEFAULT_FIXTURE_PATH;
  const calls: HarnessCallResult[] = opts.sink ?? [];

  // Next_Action_Request: text only, ~100 options, one choice question.
  const options = buildOptions(NEXT_ACTION_OPTION_COUNT);
  const optionCount = Object.keys(options).length;
  const nextActionBody = {
    state: 'A web page is open with a form, a toolbar, a data table, a sidebar and a footer. The goal is to save the current draft.',
    questions: {
      next: {
        type: 'choice' as const,
        instructions: 'Which single action should be taken next to reach the goal?',
        criteria: options,
      },
    },
    model: NEXT_ACTION_MODEL,
  };
  const nextActionCalls: HarnessCallResult[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const result = await timedCall(
      { requestType: 'next_action', provider, modelRequested: NEXT_ACTION_MODEL, optionCount, request: nextActionBody },
      () => client.systemOne(nextActionBody),
      opts.now,
    );
    nextActionCalls.push(result);
    calls.push(result);
  }
  const nextAction = summarize('next_action', NEXT_ACTION_MODEL, sampleCount, nextActionCalls, optionCount);

  // Final_Image_Request: screenshot, noul + box. Missing fixture is recorded as not-run.
  let finalImage: LatencyRequestSummary;
  if (!existsSync(fixturePath)) {
    finalImage = notRun('final_image', FINAL_IMAGE_MODEL, sampleCount, `fixture not found: ${fixturePath}`);
  } else {
    let bytes: Buffer | undefined;
    let readError: string | undefined;
    try {
      bytes = await readFile(fixturePath);
    } catch (err) {
      readError = err instanceof Error ? err.message : String(err);
    }
    if (!bytes || bytes.length === 0) {
      finalImage = notRun('final_image', FINAL_IMAGE_MODEL, sampleCount, readError ?? `fixture is empty: ${fixturePath}`);
    } else {
      const screenshot = image(bytes);
      const questions = {
        done: { type: 'noul' as const, instructions: 'Does the page show that the draft was saved?' },
        subject: { type: 'box' as const, instructions: 'The save confirmation message.' },
      };
      // Raw_Sample request: image bytes are stored as a reference, not inlined.
      const recorded = {
        state: { image: 'fixtures/demo-app-screenshot.png', bytes: bytes.length, encoding: 'data URL (image/png)' },
        questions,
        model: FINAL_IMAGE_MODEL,
        headers: IMAGE_HEADER,
      };
      const imageCalls: HarnessCallResult[] = [];
      for (let i = 0; i < sampleCount; i++) {
        const result = await timedCall(
          { requestType: 'final_image', provider, modelRequested: FINAL_IMAGE_MODEL, request: recorded },
          () => client.systemOne({ state: screenshot, questions, model: FINAL_IMAGE_MODEL }, { headers: { ...IMAGE_HEADER } }),
          opts.now,
        );
        imageCalls.push(result);
        calls.push(result);
      }
      finalImage = summarize('final_image', FINAL_IMAGE_MODEL, sampleCount, imageCalls);
    }
  }

  // Diagnostics: one call each, labelled, outside the latency statistics. Only when the fixture is readable.
  const diagnostics: HarnessCallResult[] = [];
  if (existsSync(fixturePath)) {
    let diagBytes: Buffer | undefined;
    try {
      diagBytes = await readFile(fixturePath);
    } catch {
      diagBytes = undefined;
    }
    if (diagBytes && diagBytes.length > 0) {
      const shot = image(diagBytes);
      const both = {
        done: { type: 'noul' as const, instructions: 'Does the page show that the draft was saved?' },
        subject: { type: 'box' as const, instructions: 'The save confirmation message.' },
      };
      const noulOnly = { done: both.done };
      const boxOnly = { subject: both.subject };
      // Request construction follows SDK 0.7.0 README / api.md: image as `state`, box on jev-preview,
      // header sent per call. Variants change one thing at a time (model, header, question set).
      const variants: Array<{ label: string; model: string; headerOn: boolean; questions: typeof both | typeof noulOnly | typeof boxOnly }> = [
        { label: 'diag: final-image noul+box, pinned model, images header ON', model: NEXT_ACTION_MODEL, headerOn: true, questions: both },
        { label: 'diag: final-image noul+box, pinned model, images header OFF', model: NEXT_ACTION_MODEL, headerOn: false, questions: both },
        { label: 'diag: final-image box only, pinned model, images header ON', model: NEXT_ACTION_MODEL, headerOn: true, questions: boxOnly },
        { label: 'diag: final-image box only, pinned model, images header OFF', model: NEXT_ACTION_MODEL, headerOn: false, questions: boxOnly },
        { label: 'diag: final-image noul only, pinned model, images header ON', model: NEXT_ACTION_MODEL, headerOn: true, questions: noulOnly },
        { label: 'diag: final-image noul only, jev-preview, images header ON', model: FINAL_IMAGE_MODEL, headerOn: true, questions: noulOnly },
      ];
      for (const v of variants) {
        const request = {
          state: { image: 'fixtures/demo-app-screenshot.png', bytes: diagBytes.length, encoding: 'multipart/form-data (SDK)' },
          questions: v.questions,
          model: v.model,
          headers: v.headerOn ? IMAGE_HEADER : {},
        };
        const result = await timedCall(
          { requestType: 'diagnostic', label: v.label, provider, modelRequested: v.model, request },
          () => client.systemOne({ state: shot, questions: v.questions, model: v.model }, v.headerOn ? { headers: { ...IMAGE_HEADER } } : {}),
          opts.now,
        );
        diagnostics.push(result);
        calls.push(result);
      }
    }
  }
  return { budget: STEP_BUDGET, nextAction, finalImage, diagnostics, calls };
}
