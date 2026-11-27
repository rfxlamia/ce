/**
 * Decider of the Observe → Decide → Execute loop (spec observe-decide-execute-loop).
 * Pure module: no import of `playwright`, no question text (it lives in `jev/catalog.ts`).
 */

import { CATALOG } from '../jev/catalog.js';
import type { Jev_Request } from '../jev/types.js';
import { CHANGE_STOPWORDS, MAX_NEXT_ACTION_OPTIONS } from './constants.js';
import { createRedactor, PATH_TEXT_LIMIT, sanitizeText, type Observation } from './observe.js';

/** One entry of the `runtime.next_action` question. */
export interface Option {
  kind: 'element' | 'fill' | 'navigation';
  /** Sanitized_Text description, e.g. `e12: button "Menu"`. */
  description: string;
  /** Element and fill Options only. */
  ref?: string;
  /** Fill Options only. */
  fixtureKey?: string;
  /** Navigation Options only. */
  url?: string;
  proximityScore: number;
}

export type DecidedAction =
  | { kind: 'click'; ref: string }
  | { kind: 'fill'; ref: string; fixtureKey: string }
  | { kind: 'goto'; url: string }
  | { kind: 'done' }
  /** `reason` is `invalid-answer` for any give-up the Decider produces, including an answer of `give_up`. */
  | { kind: 'give_up'; reason: 'invalid-answer' };

export interface StepHistoryEntry {
  step: number;
  kind: DecidedAction['kind'];
  /** Sanitized_Text Option description. */
  description: string;
  result: 'changed' | 'unchanged' | 'refused';
}

const MIN_TOKEN_LENGTH = 3;

/**
 * Split text into lower-case word tokens: maximal runs of ASCII letters and digits,
 * after splitting camelCase boundaries. No filtering.
 */
function splitTokens(text: string): string[] {
  const runs = text.match(/[A-Za-z0-9]+/g) ?? [];
  const tokens: string[] = [];
  for (const run of runs) {
    const spaced = run
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    for (const part of spaced.split(' ')) {
      if (part !== '') tokens.push(part.toLowerCase());
    }
  }
  return tokens;
}

function isChangeTerm(token: string): boolean {
  return token.length >= MIN_TOKEN_LENGTH && !/^[0-9]+$/.test(token) && !CHANGE_STOPWORDS.has(token);
}

/** Added (`+`) lines of a patch, without the `+` marker and excluding the `+++` file header. */
function addedLines(patch: string): string[] {
  const out: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) out.push(line.slice(1));
  }
  return out;
}

/**
 * Change_Terms: tokens of the changed file paths and of the added lines of their patches,
 * minus tokens shorter than 3 characters, all-digit tokens and Change_Stopwords.
 */
export function changeTermsFrom(files: readonly { path: string; patch?: string }[]): Set<string> {
  const terms = new Set<string>();
  const add = (text: string): void => {
    for (const token of splitTokens(text)) {
      if (isChangeTerm(token)) terms.add(token);
    }
  };
  for (const file of files) {
    add(file.path);
    if (file.patch) {
      for (const line of addedLines(file.patch)) add(line);
    }
  }
  return terms;
}

/**
 * Proximity_Score: the number of distinct Change_Terms that equal a token of the Match_Text.
 * Whole-token equality only, never a substring match.
 */
export function proximityScore(matchText: string, changeTerms: ReadonlySet<string>): number {
  if (changeTerms.size === 0) return 0;
  let score = 0;
  const seen = new Set<string>();
  for (const token of splitTokens(matchText)) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (changeTerms.has(token)) score += 1;
  }
  return score;
}

// ---------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------

function originOf(url: string): string | undefined {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

function normalizeUrl(url: string): string | undefined {
  try {
    return new URL(url).href;
  } catch {
    return undefined;
  }
}

function escapeQuoted(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** `[data-testid="x"]` or `[id="x"]` locators carry the attribute value used for Match_Text. */
function attributeOfLocator(locator: string): string {
  const match = /^\[(?:data-testid|id)="((?:[^"\\]|\\.)*)"\]$/.exec(locator);
  return match?.[1]?.replace(/\\(.)/g, '$1') ?? '';
}

/**
 * Builds the ordered Option list of one step. Pure and deterministic. Never reads a fixture
 * value into a description: fill Options carry the key only.
 */
export function buildOptions(input: {
  observation: Observation;
  routes: readonly string[];
  targetOrigin: string;
  fixtures: Readonly<Record<string, string>>;
  changeTerms: ReadonlySet<string>;
}): Option[] {
  const { observation, routes, targetOrigin, fixtures, changeTerms } = input;
  const redact = createRedactor(Object.values(fixtures));
  const origin = originOf(targetOrigin);
  const fixtureKeys = new Set(Object.keys(fixtures));
  const options: Option[] = [];

  for (const element of observation.elements) {
    if (!element.visible || !element.enabled) continue;
    if (element.href !== undefined && (origin === undefined || originOf(element.href) !== origin)) continue;
    const name = redact(element.name);
    const score = proximityScore(`${element.role} ${name} ${attributeOfLocator(element.locator)}`, changeTerms);
    const base = `${element.ref}: ${element.role} "${name}"`;
    options.push({ kind: 'element', description: base, ref: element.ref, proximityScore: score });
    for (const key of element.fixtureKeys) {
      if (!fixtureKeys.has(key)) continue;
      options.push({
        kind: 'fill',
        description: `${base} fill from fixture "${escapeQuoted(key)}"`,
        ref: element.ref,
        fixtureKey: key,
        proximityScore: score,
      });
    }
  }

  const observedHrefs = new Set<string>();
  for (const element of observation.elements) {
    const href = element.href === undefined ? undefined : normalizeUrl(element.href);
    if (href !== undefined) observedHrefs.add(href);
  }
  // `Observation.navigation` holds link hrefs only, so routes are merged here (Requirement 2.3).
  const seenRoutes = new Set<string>();
  for (const route of routes) {
    if (origin === undefined) break;
    let resolved: URL;
    try {
      resolved = new URL(route, origin);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    if (observedHrefs.has(resolved.href) || seenRoutes.has(resolved.href)) continue;
    seenRoutes.add(resolved.href);
    const path = sanitizeText(`${resolved.pathname}${resolved.search}${resolved.hash}`, {
      maxLength: PATH_TEXT_LIMIT,
      fixtureValues: Object.values(fixtures),
    });
    options.push({
      kind: 'navigation',
      description: `go to ${path}`,
      url: resolved.href,
      proximityScore: proximityScore(path, changeTerms),
    });
  }

  // Array.prototype.sort is stable: ties keep document order, then routes order.
  const ranked = options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => b.option.proximityScore - a.option.proximityScore || a.index - b.index)
    .map((entry) => entry.option);
  return ranked.slice(0, MAX_NEXT_ACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------
// State text and request
// ---------------------------------------------------------------------------------------

/** Removes scheme, host and port from an absolute URL, leaving path, query and fragment. */
function toRelativePath(url: string): string {
  const stripped = url.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\s]*/, '');
  return stripped === '' || /^[?#]/.test(stripped) ? `/${stripped}` : stripped;
}

/**
 * Pure state text of the decision request. Nothing in it varies between runs of the same
 * scenario: the page is a path (never scheme, host or port) and the history is a fixed format.
 */
export function buildStateText(input: {
  claim: string;
  path: string;
  title: string;
  history: readonly StepHistoryEntry[];
}): string {
  const lines = [`claim: ${input.claim}`, `page: ${input.path}`, `title: ${input.title}`, 'history:'];
  for (const entry of input.history) {
    lines.push(`step ${entry.step}: ${entry.kind} ${entry.description} -> ${entry.result}`);
  }
  return lines.join('\n');
}

/**
 * Builds the one text-only request of a step: `next_action` and `state_reached_dom`.
 * Question text comes from the catalog only. No image asset is attached.
 */
export function buildDecisionRequest(input: {
  claim: string;
  observation: Observation;
  options: readonly Option[];
  history: readonly StepHistoryEntry[];
  targetOrigin: string;
  /** Redactor input only; never embedded in the text. */
  fixtureValues: readonly string[];
}): Jev_Request {
  const redact = createRedactor(input.fixtureValues);
  const state = buildStateText({
    claim: redact(input.claim.replace(/[\s\p{Cc}]+/gu, ' ').trim()),
    path: redact(toRelativePath(input.observation.url)),
    title: redact(input.observation.title),
    history: input.history.map((entry) => ({ ...entry, description: redact(entry.description) })),
  });
  return {
    stage: 'runtime',
    state,
    questions: {
      next_action: CATALOG.runtimeNextAction.built(input.options.map((option) => option.description)),
      state_reached_dom: CATALOG.runtimeStateReachedDom.built(),
    },
  };
}

// ---------------------------------------------------------------------------------------
// Answer mapping
// ---------------------------------------------------------------------------------------

function optionIndex(key: string, optionCount: number): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return undefined;
  const index = Number(key);
  return index < optionCount ? index : undefined;
}

/**
 * Maps the `next_action` probabilities to exactly one Action. The highest probability wins;
 * on a tie the lowest Option index, then `give_up`, then `done`. A winning key that is
 * not an Option index, `done` or `give_up` maps to `give_up` with reason `invalid-answer`.
 */
export function mapAnswerToAction(input: {
  options: readonly Option[];
  probabilities: Readonly<Record<string, number>>;
}): DecidedAction {
  const { options, probabilities } = input;
  let top = -Infinity;
  for (const value of Object.values(probabilities)) {
    if (Number.isFinite(value) && value > top) top = value;
  }
  const tied = Object.entries(probabilities)
    .filter(([, value]) => Number.isFinite(value) && value === top)
    .map(([key]) => key);
  if (tied.length === 0) return { kind: 'give_up', reason: 'invalid-answer' };

  const indexes = tied
    .map((key) => optionIndex(key, options.length))
    .filter((index): index is number => index !== undefined);
  if (indexes.length > 0) {
    const option = options[Math.min(...indexes)]!;
    if (option.kind === 'fill') return { kind: 'fill', ref: option.ref!, fixtureKey: option.fixtureKey! };
    if (option.kind === 'navigation') return { kind: 'goto', url: option.url! };
    return { kind: 'click', ref: option.ref! };
  }
  if (tied.includes('give_up')) return { kind: 'give_up', reason: 'invalid-answer' };
  if (tied.includes('done')) return { kind: 'done' };
  return { kind: 'give_up', reason: 'invalid-answer' };
}
