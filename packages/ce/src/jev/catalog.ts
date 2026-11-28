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
import type { Cut } from '../assessment/types.js';
import {
  REQUEST_HEADROOM_TOKENS,
  STATE_BUDGET_TOKENS,
  estimateTokens,
  fitCheckResults,
  isTestFile,
  truncateToTokens,
} from '../context/budget.js';
import type { ChangeContext } from '../context/types.js';
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

/** The `instructions` text of one entry's built question. `runtime.next_action` is built with no options. */
function questionTextOf(e: (typeof CATALOG)[keyof typeof CATALOG]): string {
  const question: Question =
    e.idVersion === CATALOG.runtimeNextAction.idVersion
      ? CATALOG.runtimeNextAction.build([])
      : (e as CatalogEntry<Question, []>).build();
  // Every catalog entry passes a string; the SDK type merely allows other shapes.
  return typeof question.instructions === 'string' ? question.instructions : '';
}

const BY_ID_VERSION: ReadonlyMap<string, string> = new Map(
  Object.values(CATALOG).map((e) => [e.idVersion, questionTextOf(e)] as const),
);

/**
 * Read-only question text for one catalog entry, keyed by `idVersion`.
 * Returns `undefined` for an unknown or retired version; callers show a fallback.
 */
export function questionTextFor(idVersion: string): string | undefined {
  return BY_ID_VERSION.get(idVersion);
}

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

const filesSummary = (context: ChangeContext): string =>
  context.change.files.map((f) => `${f.path} ${f.status}`).join('\n');

/** Shortens `text` by exactly the `excess` tokens it must give up (never below empty). */
function shortenBy(text: string, excess: number): string {
  return truncateToTokens(text, Math.max(0, estimateTokens(text) - excess)).text;
}

/**
 * Builds the Classification_Request: one `claim.is_behavior` question about one
 * Claim_Candidate. Only the title and files summary is shortened to fit the state
 * budget; the candidate text is never touched. State labels are not question text.
 */
export function buildClassificationRequest(
  context: ChangeContext,
  candidate: { id: string; text: string },
): { request: Jev_Request; cuts: Cut[] } {
  let title = context.change.title ?? '';
  let files = filesSummary(context);
  const render = (): string => `candidate: ${candidate.text}\ntitle: ${title}\nfiles: ${files}`;
  const over = (): number => estimateTokens(render()) - STATE_BUDGET_TOKENS;
  const cuts: Cut[] = [];

  if (over() > 0 && files.length > 0) {
    while (over() > 0 && files.length > 0) files = shortenBy(files, over());
    cuts.push({ file: '<files>', reason: 'truncated', isTest: false });
  }
  if (over() > 0 && title.length > 0) {
    while (over() > 0 && title.length > 0) title = shortenBy(title, over());
    cuts.push({ file: '<title>', reason: 'truncated', isTest: false });
  }
  if (over() > 0) {
    throw new Error(
      `claim.is_behavior: candidate ${candidate.id} alone exceeds the state budget of ${STATE_BUDGET_TOKENS} tokens`,
    );
  }

  return {
    request: {
      stage: 'assessment',
      state: render(),
      questions: { is_behavior: CATALOG.claimIsBehavior.built() },
    },
    cuts,
  };
}

/**
 * Builds the Assessment_Request: the three assessment questions about one Subject.
 * Check results are capped with `fitCheckResults`. When the state is over budget,
 * patches are cut one file at a time, non-test files first, last file to first
 * (Decision D21). State labels are not question text.
 */
export function buildAssessmentRequest(
  context: ChangeContext,
  subject: { id: string; text: string },
): { request: Jev_Request; cuts: Cut[] } {
  const cuts: Cut[] = [];

  const { kept } = fitCheckResults(context.checks, REQUEST_HEADROOM_TOKENS);
  const keptSet = new Set(kept);
  context.checks.forEach((check, n) => {
    if (!keptSet.has(check)) cuts.push({ file: `check:${n}`, reason: 'check-cap', isTest: false });
  });

  const files = context.change.files;
  const patches = files.map((f) => f.patch);
  const filesText = filesSummary(context);
  const checksText = kept.map((c) => `${c.name} ${c.status}`).join('\n');
  const render = (): string =>
    `claim: ${subject.text}\nfiles: ${filesText}\npatches:\n` +
    files.map((f, i) => `${f.path}\n${patches[i]}`).join('\n') +
    `\nchecks: ${checksText}`;
  const over = (): number => estimateTokens(render()) - STATE_BUDGET_TOKENS;

  if (over() > 0) {
    const indexes = files.map((_, i) => i);
    const order = [
      ...indexes.filter((i) => !isTestFile(files[i]!.path)).reverse(),
      ...indexes.filter((i) => isTestFile(files[i]!.path)).reverse(),
    ];
    for (const i of order) {
      if (over() <= 0) break;
      if (patches[i]!.length === 0) continue;
      while (over() > 0 && patches[i]!.length > 0) patches[i] = shortenBy(patches[i]!, over());
      cuts.push({
        file: files[i]!.path,
        reason: patches[i]!.length === 0 ? 'dropped' : 'truncated',
        isTest: isTestFile(files[i]!.path),
      });
    }
    if (over() > 0) {
      throw new Error(
        `assessment request for ${subject.id} exceeds the state budget of ${STATE_BUDGET_TOKENS} tokens with all patches empty`,
      );
    }
  }

  return {
    request: {
      stage: 'assessment',
      state: render(),
      questions: {
        runtime_observable: CATALOG.assessRuntimeObservable.built(),
        checks_adequate: CATALOG.assessChecksAdequate.built(),
        surface: CATALOG.assessSurface.built(),
      },
    },
    cuts,
  };
}
