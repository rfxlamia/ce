/**
 * Runtime_Loop (spec observe-decide-execute-loop, Requirements 3, 4, 5, 7, 8, 9).
 *
 * Bounded Observe → Decide → Execute cycle over one Playwright page. The loop returns a
 * `LoopResult`; it never decides the Outcome and never imports `outcome/resolve.ts`.
 * Type-only dependency on Playwright, no import of the Jev SDK, no `fetch`.
 *
 * `finish()` takes the final screenshot and sends the single Final_Image_Request
 * (`state_reached` + `locate_subject`) through the gateway. `subjectBox` holds the Box answer
 * as fractions of the screenshot (`x`, `y` top-left), not pixels.
 */

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { StageError } from '../errors.js';
import { finalImageQuestions } from '../jev/catalog.js';
import { JevImageError, type JevImageErrorReason } from '../jev/errors.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { type EventLogEntry, maskTargetsFor, registerPageHandlers, takeScreenshot, waitForSettle } from './capture.js';
import { REACHED_THRESHOLD, SETTLE_TIMEOUT_MS, loopDeadlineMs } from './constants.js';
import {
  buildDecisionRequest,
  buildOptions,
  mapAnswerToAction,
  type DecidedAction,
  type Option,
  type StepHistoryEntry,
} from './decide.js';
import { execute, isSameOrigin } from './execute.js';
import { computeDomDigest, createRedactor, observe, type Observation } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

export type StopReason = 'done' | 'reached' | 'give_up' | 'max-steps' | 'time-budget' | 'aborted';

export interface StepLogEntry {
  observation: Observation;
  action: DecidedAction;
  /** Probabilities of the Options considered, keyed by Option index, `done` and `give_up`. */
  probabilities: Record<string, number>;
}

export interface LoopResult {
  finalState: 'reached' | 'not_reached';
  observations: Observation[];
  steps: StepLogEntry[];
  eventLog: EventLogEntry[];
  finalScreenshot?: string;
  finalSignals: { stateReachedDom?: number; stateReached?: number };
  subjectBox?: { x: number; y: number; width: number; height: number };
  finalImageModel?: string;
  finalImageError?: JevImageErrorReason | 'time-budget';
  stopReason: StopReason;
}

export interface LoopClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RunLoopInput {
  page: PlaywrightPage;
  gateway: JevGateway;
  claim: string;
  changeTerms: ReadonlySet<string>;
  targetOrigin: string;
  routes: readonly string[];
  fixtures: Readonly<Record<string, string>>;
  maxSteps: number;
  timeBudgetMs: number;
  /** Absolute directory that receives the screenshots. */
  runDir: string;
  signal?: AbortSignal;
  clock?: LoopClock;
  /** Playwright's default call timeout. Default 30 000 ms. */
  playwrightDefaultTimeoutMs?: number;
}

/** `signal.reason` of the loop's own deadline abort; lets callers tell it from an outside abort. */
export class LoopDeadlineReason extends Error {
  constructor() {
    super('runtime loop deadline reached');
    this.name = 'LoopDeadlineReason';
  }
}

/**
 * A `StageError('runtime')` that keeps what the loop had gathered, so a page crash or a
 * screenshot failure does not discard the Observations already captured (Requirement 8.7).
 */
export class LoopStageError extends StageError {
  readonly partial: Pick<LoopResult, 'observations' | 'steps' | 'eventLog'>;

  constructor(cause: unknown, partial: Pick<LoopResult, 'observations' | 'steps' | 'eventLog'>) {
    super('runtime', cause);
    this.name = 'StageError';
    this.partial = partial;
  }
}

export const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 30_000;

const defaultClock: LoopClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    }),
};

const STOPPED = Symbol('loop-stopped');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Probabilities of the `next_action` answer keyed by Option index (position among the
 * non-fixed keys, in request order), `done` and `give_up`. Anything malformed yields `{}`,
 * which maps to a give-up.
 */
function readNextAction(response: Jev_Response): Record<string, number> {
  const answer: unknown = response.answers['next_action'];
  if (!isRecord(answer) || answer['type'] !== 'choice' || !isRecord(answer['probabilities'])) return {};
  const out: Record<string, number> = {};
  let index = 0;
  for (const [key, raw] of Object.entries(answer['probabilities'])) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return {};
    if (key === 'done' || key === 'give_up') out[key] = raw;
    else out[String(index++)] = raw;
  }
  return out;
}

function readStateReachedDom(response: Jev_Response): number | undefined {
  const answer: unknown = response.answers['state_reached_dom'];
  if (!isRecord(answer) || answer['type'] !== 'noul') return undefined;
  const value = answer['noul'];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Normalized box (fractions of the screenshot): `x`, `y` is the top-left corner. */
type SubjectBox = NonNullable<LoopResult['subjectBox']>;

function readNoul(response: Jev_Response, name: string): number | undefined {
  const answer: unknown = response.answers[name];
  if (!isRecord(answer) || answer['type'] !== 'noul') return undefined;
  const value = answer['noul'];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBox(response: Jev_Response, name: string): SubjectBox | undefined {
  const answer: unknown = response.answers[name];
  if (!isRecord(answer) || answer['type'] !== 'box' || !isRecord(answer['box'])) return undefined;
  const { top, bottom, left, right } = answer['box'];
  if (![top, bottom, left, right].every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined;
  const [t, b, l, r] = [top, bottom, left, right] as number[];
  if ((b as number) <= (t as number) || (r as number) <= (l as number)) return undefined;
  return { x: l as number, y: t as number, width: (r as number) - (l as number), height: (b as number) - (t as number) };
}

function describeAction(action: DecidedAction, options: readonly Option[]): string {
  switch (action.kind) {
    case 'click':
      return options.find((o) => o.kind === 'element' && o.ref === action.ref)?.description ?? action.ref;
    case 'fill':
      return (
        options.find((o) => o.kind === 'fill' && o.ref === action.ref && o.fixtureKey === action.fixtureKey)
          ?.description ?? `${action.ref} fill from fixture`
      );
    case 'goto':
      return options.find((o) => o.kind === 'navigation' && o.url === action.url)?.description ?? '';
    default:
      return '';
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/** Absolute, on-origin URL of each route, in routes order. */
function resolveRoutes(routes: readonly string[], targetOrigin: string): string[] {
  const out: string[] = [];
  for (const route of routes) {
    try {
      const url = new URL(route, targetOrigin);
      if (isSameOrigin(url.href, targetOrigin) && !out.includes(url.href)) out.push(url.href);
    } catch {
      // An unresolvable route is not a Navigation_Option.
    }
  }
  return out;
}

export async function runLoop(input: RunLoopInput): Promise<LoopResult> {
  const { page, gateway, claim, changeTerms, targetOrigin, routes, fixtures, maxSteps, timeBudgetMs, runDir } = input;
  const clock = input.clock ?? defaultClock;
  const playwrightDefault = input.playwrightDefaultTimeoutMs ?? DEFAULT_PLAYWRIGHT_TIMEOUT_MS;
  const fixtureValues = Object.values(fixtures);
  const fixtureKeys = Object.keys(fixtures);
  const redact = createRedactor(fixtureValues);

  const startedAt = clock.now();
  const endAt = startedAt + timeBudgetMs;
  const deadlineAt = startedAt + loopDeadlineMs(timeBudgetMs);
  const remainingMs = (): number => endAt - clock.now();
  /** Requirement 9.12: min(Playwright default, time remaining), never below 1 ms. */
  const callTimeout = (): number => Math.max(1, Math.min(playwrightDefault, remainingMs()));

  const observations: Observation[] = [];
  const steps: StepLogEntry[] = [];
  const eventLog: EventLogEntry[] = [];
  const history: StepHistoryEntry[] = [];
  const filledFieldLocators = new Set<string>();
  const routeUrls = resolveRoutes(routes, targetOrigin);
  let currentStep = 0;
  let lastDomText: number | undefined;
  const stateReachedHits: number[] = [];
  let endedWithDone = false;

  const onEvent = (entry: EventLogEntry): void => {
    eventLog.push(entry);
  };

  // One abort covers the loop's own deadline and the caller's signal.
  const loopAbort = new AbortController();
  const deadlineTimer = setTimeout(() => loopAbort.abort(new LoopDeadlineReason()), Math.max(0, deadlineAt - clock.now()));
  deadlineTimer.unref?.();
  const onOuterAbort = (): void => loopAbort.abort(input.signal?.reason);
  if (input.signal?.aborted === true) onOuterAbort();
  else input.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const stopped = new Promise<typeof STOPPED>((resolve) => {
    if (loopAbort.signal.aborted) resolve(STOPPED);
    else loopAbort.signal.addEventListener('abort', () => resolve(STOPPED), { once: true });
  });
  /** Stops waiting on a pending call once the loop is aborted; the call itself cannot be cancelled. */
  const guard = async <T>(pending: Promise<T>): Promise<T | typeof STOPPED> => {
    pending.catch(() => undefined);
    return Promise.race([pending, stopped]);
  };
  const abortReason = (): StopReason =>
    input.signal?.aborted === true && !(loopAbort.signal.reason instanceof LoopDeadlineReason) ? 'aborted' : 'time-budget';

  const fail = (cause: unknown): LoopStageError => new LoopStageError(cause, { observations, steps, eventLog });

  /** Writes one PNG under the Run_Dir and returns its path relative to the Run_Dir. */
  const shoot = async (step: number): Promise<string> => {
    const relative = `step-${step}.png`;
    try {
      await mkdir(runDir, { recursive: true });
      const masks = await maskTargetsFor({ page, filledFieldLocators: [...filledFieldLocators], fixtureValues });
      await takeScreenshot({ page, path: path.join(runDir, relative), masks, timeoutMs: callTimeout() });
    } catch (cause) {
      throw fail(cause);
    }
    return relative;
  };

  /**
   * Copy of an Observation for everything the loop publishes (`observations`, `steps`). The
   * Observer holds no fixture values, so the page text it read (URL, title, names, hrefs and the
   * name-based locator) may still reflect one; the Redactor removes it (Requirement 6.6). The loop
   * keeps working on the unredacted Observation, because the Executor needs the real locator.
   */
  const published = new WeakMap<Observation, Observation>();
  const publish = (source: Observation): Observation => {
    const cached = published.get(source);
    if (cached !== undefined) return cached;
    const copy = redactObservation(source);
    published.set(source, copy);
    return copy;
  };
  const redactObservation = (source: Observation): Observation => ({
    ...source,
    url: redact(source.url),
    title: redact(source.title),
    navigation: source.navigation.map(redact),
    elements: source.elements.map((element) => {
      const copy = { ...element, name: redact(element.name), locator: redact(element.locator) };
      if (element.href !== undefined) copy.href = redact(element.href);
      return copy;
    }),
  });

  const observeRaw = (step: number) => observe({ page, step, targetOrigin, fixtureKeys });

  /** Merges `target.routes` into `navigation` so `execute` accepts a route-based goto. */
  const withRoutes = (navigation: readonly string[]): string[] => {
    const merged = [...navigation];
    for (const url of routeUrls) if (!merged.includes(url)) merged.push(url);
    return merged;
  };

  const settle = async (): Promise<void> => {
    try {
      await guard(
        waitForSettle({
          page,
          computeDigest: async () => computeDomDigest((await observeRaw(currentStep)).elements),
          settleTimeoutMs: Math.max(1, Math.min(SETTLE_TIMEOUT_MS, remainingMs())),
          now: () => clock.now(),
          sleep: (ms) => clock.sleep(ms),
          onEvent,
          step: currentStep,
        }),
      );
    } catch (cause) {
      // A page crash while settling is a runtime failure that keeps what was gathered (8.7).
      if (loopAbort.signal.aborted) return;
      throw fail(cause);
    }
  };

  /**
   * Final screenshot (Requirement 8.5). Returns the path relative to the Run_Dir and the PNG
   * bytes, or `undefined` when the page is gone, off the Target_Origin, or the capture ran out of
   * time (a timeout here is the budget ending, not a write failure). Any other failure raises.
   */
  const finalCapture = async (): Promise<{ relative: string; bytes: Uint8Array } | undefined> => {
    try {
      if (page.isClosed() || !isSameOrigin(page.url(), targetOrigin)) return undefined;
    } catch {
      return undefined;
    }
    if (remainingMs() <= 0) return undefined;
    const relative = `step-${currentStep}-final.png`;
    try {
      await mkdir(runDir, { recursive: true });
      const masks = await maskTargetsFor({ page, filledFieldLocators: [...filledFieldLocators], fixtureValues });
      await takeScreenshot({ page, path: path.join(runDir, relative), masks, timeoutMs: callTimeout() });
    } catch (cause) {
      if (isTimeoutError(cause)) return undefined;
      throw fail(cause);
    }
    try {
      return { relative, bytes: new Uint8Array(await readFile(path.join(runDir, relative))) };
    } catch (cause) {
      throw fail(cause);
    }
  };

  /**
   * One Final_Image_Request (`state_reached` + `locate_subject`) with an AbortSignal that fires at
   * the Time_Budget (Requirement 10.11). Never used for the steps, never sent twice.
   */
  const finalImageRequest = async (
    bytes: Uint8Array,
  ): Promise<
    | { ok: true; stateReached?: number; box?: SubjectBox; model: string }
    | { ok: false; error: JevImageErrorReason | 'time-budget' }
  > => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new LoopDeadlineReason()), Math.max(0, remainingMs()));
    timer.unref?.();
    const aborted = new Promise<typeof STOPPED>((resolve) => {
      if (abort.signal.aborted) resolve(STOPPED);
      else abort.signal.addEventListener('abort', () => resolve(STOPPED), { once: true });
    });
    try {
      const pending = gateway.ask(finalImageQuestions(claim, bytes), { signal: abort.signal });
      pending.catch(() => undefined);
      const response = await Promise.race([pending, aborted]);
      if (response === STOPPED) return { ok: false, error: 'time-budget' };
      const out: { ok: true; stateReached?: number; box?: SubjectBox; model: string } = {
        ok: true,
        model: response.model,
      };
      const stateReached = readNoul(response, 'state_reached');
      if (stateReached !== undefined) out.stateReached = stateReached;
      const box = readBox(response, 'locate_subject');
      if (box !== undefined) out.box = box;
      return out;
    } catch (cause) {
      if (cause instanceof JevImageError) {
        const byDeadline = abort.signal.aborted && abort.signal.reason instanceof LoopDeadlineReason;
        return { ok: false, error: byDeadline ? 'time-budget' : cause.reason };
      }
      throw fail(cause);
    } finally {
      clearTimeout(timer);
    }
  };

  const finish = async (stopReason: StopReason): Promise<LoopResult> => {
    const textReached = stateReachedHits.length > 0 || endedWithDone;
    const finalSignals: LoopResult['finalSignals'] = {};
    if (lastDomText !== undefined) finalSignals.stateReachedDom = lastDomText;
    const result: LoopResult = {
      finalState: textReached ? 'reached' : 'not_reached',
      observations,
      steps,
      eventLog,
      finalSignals,
      stopReason,
    };

    const captured = await finalCapture();
    if (captured === undefined) return result; // no screenshot, no image request (10.9)
    result.finalScreenshot = captured.relative;

    const image = await finalImageRequest(captured.bytes);
    if (!image.ok) {
      result.finalImageError = image.error; // Text_Signals decide; Box stays absent (10.6, 10.7)
      return result;
    }
    result.finalImageModel = image.model;
    if (image.stateReached !== undefined) {
      finalSignals.stateReached = image.stateReached;
      result.finalState = image.stateReached >= REACHED_THRESHOLD ? 'reached' : 'not_reached';
    }
    if (image.box !== undefined) result.subjectBox = image.box;
    return result;
  };

  // Handlers go in before the first Observation so no dialog can block the page.
  const dispose = registerPageHandlers({ page, onEvent, redact, getStep: () => currentStep });
  try {
    // Step 0: initial state and its screenshot, before any decision.
    await settle();
    if (loopAbort.signal.aborted) {
      // Nothing observed yet; the caller gets a failure rather than an empty result.
      throw fail(loopAbort.signal.reason ?? new LoopDeadlineReason());
    }
    let observation: Observation;
    try {
      const raw = await observeRaw(0);
      observation = { ...raw, navigation: withRoutes(raw.navigation), screenshot: '' };
    } catch (cause) {
      throw fail(cause);
    }
    observation.screenshot = await shoot(0);
    observations.push(publish(observation));
    let lastScreenshot = observation.screenshot;
    let actionsExecuted = 0;

    for (;;) {
      if (loopAbort.signal.aborted) return await finish(abortReason());
      if (clock.now() >= deadlineAt) return await finish('time-budget');
      if (actionsExecuted >= maxSteps) return await finish('max-steps');

      // Decide: one text-only request.
      const options = buildOptions({ observation, routes, targetOrigin, fixtures, changeTerms });
      const request = buildDecisionRequest({
        claim,
        observation,
        options,
        history,
        targetOrigin,
        fixtureValues,
      });
      let response: Jev_Response | typeof STOPPED;
      try {
        response = await guard(gateway.ask(request, { signal: loopAbort.signal }));
      } catch (cause) {
        if (loopAbort.signal.aborted) return await finish(abortReason());
        throw fail(cause);
      }
      if (response === STOPPED) return await finish(abortReason());

      const probabilities = readNextAction(response);
      const stateReachedDom = readStateReachedDom(response);
      if (stateReachedDom !== undefined) {
        lastDomText = stateReachedDom;
        if (stateReachedDom >= REACHED_THRESHOLD) stateReachedHits.push(stateReachedDom);
      }

      if (stateReachedDom !== undefined && stateReachedDom >= REACHED_THRESHOLD) {
        // Reached: stop with no Action. Logged as `done`, the Action that was not taken.
        steps.push({ observation: publish(observation), action: { kind: 'done' }, probabilities });
        return await finish('reached');
      }

      const action = mapAnswerToAction({ options, probabilities });
      steps.push({ observation: publish(observation), action, probabilities });
      if (action.kind === 'done') {
        endedWithDone = true;
        return await finish('done');
      }
      if (action.kind === 'give_up') return await finish('give_up');

      // Execute.
      const description = describeAction(action, options);
      let outcome: Awaited<ReturnType<typeof execute>> | typeof STOPPED | 'timeout';
      try {
        outcome = await guard(
          execute({ action, observation, page, targetOrigin, fixtures, callTimeoutMs: callTimeout() }),
        );
      } catch (cause) {
        if (loopAbort.signal.aborted) return await finish(abortReason());
        if (!isTimeoutError(cause)) throw fail(cause);
        outcome = 'timeout';
      }
      if (outcome === STOPPED) return await finish(abortReason());
      actionsExecuted += 1;

      if (outcome === 'timeout') {
        // The element did not become actionable in time: a refused step, not a crash.
        onEvent({ step: currentStep, kind: 'refusal', detail: redact(`action timed out: ${description}`) });
        history.push({ step: observation.step, kind: action.kind, description, result: 'refused' });
      } else if (outcome.status === 'give_up') {
        onEvent({ step: outcome.refusal.step, kind: 'refusal', detail: outcome.refusal.detail });
        history.push({ step: observation.step, kind: action.kind, description, result: 'refused' });
        return await finish('give_up');
      } else {
        if (action.kind === 'fill') {
          const filled = observation.elements.find((e) => e.ref === action.ref);
          if (filled !== undefined) filledFieldLocators.add(filled.locator);
        }
      }

      // Capture: settle, then re-observe on the page the loop started on.
      await settle();
      if (loopAbort.signal.aborted) return await finish(abortReason());
      if (!isSameOrigin(page.url(), targetOrigin)) {
        // Off-origin page: no observation, no screenshot; the last on-origin screenshot stays.
        onEvent({ step: currentStep, kind: 'refusal', detail: 'page left the target origin' });
        return await finish('give_up');
      }

      const previous = observation;
      const nextStep = previous.step + 1;
      let raw: Omit<Observation, 'screenshot'>;
      try {
        const observed = await guard(observeRaw(nextStep));
        if (observed === STOPPED) return await finish(abortReason());
        raw = observed;
      } catch (cause) {
        throw fail(cause);
      }
      const changed = raw.domDigest !== previous.domDigest || raw.url !== previous.url;
      const next: Observation = { ...raw, navigation: withRoutes(raw.navigation), screenshot: lastScreenshot };
      if (outcome !== 'timeout' && changed) {
        lastScreenshot = await shoot(nextStep);
        next.screenshot = lastScreenshot;
      }
      if (outcome !== 'timeout') {
        history.push({ step: previous.step, kind: action.kind, description, result: changed ? 'changed' : 'unchanged' });
      }
      observations.push(publish(next));
      observation = next;
      currentStep = nextStep;
    }
  } finally {
    clearTimeout(deadlineTimer);
    input.signal?.removeEventListener('abort', onOuterAbort);
    dispose();
  }
}
