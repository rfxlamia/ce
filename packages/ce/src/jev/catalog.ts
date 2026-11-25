import {
  box,
  choice,
  image,
  noul,
  withAssets,
  type BoxQuestion,
  type ChoiceQuestion,
  type NoulQuestion,
  type Question,
} from '@typesafe-ai/sdk';
import type { BuiltCatalogQuestion, Jev_Request } from './types.js';

/**
 * Question_Catalog. The only module that contains Jev question text and the
 * only module that calls `noul`, `choice`, `score`, `box`, `image` or
 * `withAssets`. Changing question text requires incrementing the entry version
 * (guarded by `catalog.snapshot.json`).
 */

export interface CatalogEntry<Q extends Question, A extends unknown[] = []> {
  readonly id: string;
  readonly version: number;
  /** `${id}@${version}` */
  readonly idVersion: string;
  readonly type: Q['type'];
  readonly requiresImage: boolean;
  readonly labelsFixed: boolean;
  build(...args: A): Q;
  /** `build` plus the entry metadata, for use in a Jev_Request. */
  built(...args: A): BuiltCatalogQuestion;
}

function entry<Q extends Question, A extends unknown[]>(
  meta: { id: string; version: number; type: Q['type']; requiresImage: boolean; labelsFixed: boolean },
  build: (...args: A) => Q,
): CatalogEntry<Q, A> {
  const idVersion = `${meta.id}@${meta.version}`;
  return {
    ...meta,
    idVersion,
    build,
    built: (...args: A) => ({
      id: meta.id,
      version: meta.version,
      idVersion,
      type: meta.type,
      requiresImage: meta.requiresImage,
      labelsFixed: meta.labelsFixed,
      question: build(...args),
    }),
  };
}

/** Largest number of options `runtime.next_action` accepts. Ranking and truncation belong to the runtime. */
export const MAX_NEXT_ACTION_OPTIONS = 240;

export const SURFACE_LABELS = [
  'browser_ui',
  'http_api',
  'cli',
  'backend_internal',
  'native_app',
  'non_runtime',
] as const;

export const NEXT_ACTION_FIXED_OPTIONS = ['done', 'give_up'] as const;

export const CATALOG = {
  claimIsBehavior: entry<NoulQuestion, []>(
    { id: 'claim.is_behavior', version: 1, type: 'noul', requiresImage: false, labelsFixed: false },
    () =>
      noul(
        'Does `candidate` describe behaviour that the changed software should exhibit when it is run? ' +
          'Answer no if it describes only internal structure, tooling, documentation or process.',
      ),
  ),

  assessRuntimeObservable: entry<NoulQuestion, []>(
    { id: 'assess.runtime_observable', version: 1, type: 'noul', requiresImage: false, labelsFixed: false },
    () => noul('Would the behaviour described in `claim` be observable by running the application?'),
  ),

  assessChecksAdequate: entry<NoulQuestion, []>(
    { id: 'assess.checks_adequate', version: 1, type: 'noul', requiresImage: false, labelsFixed: false },
    () =>
      noul(
        'Do the passing `checks` already exercise the behaviour in `claim` as it actually renders or executes?',
      ),
  ),

  assessSurface: entry<ChoiceQuestion, []>(
    { id: 'assess.surface', version: 1, type: 'choice', requiresImage: false, labelsFixed: true },
    () =>
      choice('Where would the behaviour described in `claim` be observed?', {
        browser_ui: 'In a web browser, through the rendered user interface',
        http_api: 'Through an HTTP API, by sending requests and reading responses',
        cli: 'Through a command-line program, by its arguments, output or exit code',
        backend_internal: 'Only inside backend code, with no direct external interface',
        native_app: 'In a native mobile or desktop application',
        non_runtime: 'Not at run time, for example documentation, comments or build metadata',
      }),
  ),

  runtimeNextAction: entry<ChoiceQuestion, [options: readonly string[]]>(
    { id: 'runtime.next_action', version: 1, type: 'choice', requiresImage: false, labelsFixed: false },
    (options) => {
      if (options.length > MAX_NEXT_ACTION_OPTIONS) {
        throw new RangeError(
          `runtime.next_action: option list exceeds ${MAX_NEXT_ACTION_OPTIONS} items (got ${options.length})`,
        );
      }
      const criteria: Record<string, string> = {};
      options.forEach((description, index) => {
        criteria[String(index)] = description;
      });
      criteria['done'] = 'The page already shows the state described in `claim`; no further action is needed';
      criteria['give_up'] = 'No available action moves the page toward the state described in `claim`';
      return choice(
        'Which action moves the page toward the state described in `claim`?',
        criteria,
      );
    },
  ),

  runtimeStateReachedDom: entry<NoulQuestion, []>(
    { id: 'runtime.state_reached_dom', version: 1, type: 'noul', requiresImage: false, labelsFixed: false },
    () => noul('Does the observed page state match the state described in `claim`?'),
  ),

  runtimeStateReached: entry<NoulQuestion, []>(
    { id: 'runtime.state_reached', version: 1, type: 'noul', requiresImage: true, labelsFixed: false },
    () => noul('Does the screenshot show the state described in `claim`?'),
  ),

  runtimeLocateSubject: entry<BoxQuestion, []>(
    { id: 'runtime.locate_subject', version: 1, type: 'box', requiresImage: true, labelsFixed: false },
    () => box('Where is the subject of `claim` in the screenshot?'),
  ),
} as const;

/**
 * Builds the Final_Image_Request: the screenshot as an image asset inside the
 * state text, with `runtime.state_reached` and `runtime.locate_subject`.
 * The runtime and the Probe_Library call this builder and build no image request themselves.
 */
export function finalImageQuestions(claim: string, pngBytes: Uint8Array): Jev_Request {
  const screenshot = image(pngBytes);
  const state = withAssets`claim: ${claim}\nscreenshot: ${screenshot}`;
  return {
    stage: 'runtime',
    state,
    questions: {
      state_reached: CATALOG.runtimeStateReached.built(),
      locate_subject: CATALOG.runtimeLocateSubject.built(),
    },
  };
}
