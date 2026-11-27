/**
 * Constants of the Observe → Decide → Execute loop (spec observe-decide-execute-loop).
 * Pure module: no import of `playwright`.
 */

export { MAX_NEXT_ACTION_OPTIONS } from '../jev/catalog.js';

/** State_Reached_DOM probability that counts as "reached". Not configurable in v0. */
export const REACHED_THRESHOLD = 0.7;

/** Upper bound of one settle wait, in milliseconds. */
export const SETTLE_TIMEOUT_MS = 3000;

/** Upper bound of the Final_Reserve, in milliseconds. */
const FINAL_RESERVE_CAP_MS = 10_000;

/** Fraction of the Time_Budget that bounds the Final_Reserve. */
const FINAL_RESERVE_FRACTION = 0.2;

/** Tokens that carry no change meaning; dropped from Change_Terms. */
export const CHANGE_STOPWORDS: ReadonlySet<string> = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'import',
  'export',
  'from',
  'default',
  'class',
  'extends',
  'new',
  'this',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'type',
  'interface',
  'string',
  'number',
  'boolean',
  'async',
  'await',
  'else',
  'for',
  'while',
  'div',
  'span',
  'px',
  'rem',
  'auto',
  'none',
  'flex',
  'block',
  'inline',
  'src',
  'index',
  'test',
  'spec',
  'tsx',
  'jsx',
  'css',
  'html',
  'json',
  'node',
  'modules',
  'packages',
  'diff',
  'git',
  'the',
  'and',
]);

/** Final_Reserve: the smaller of 10 000 ms and 20 percent of the Time_Budget. */
export function finalReserveMs(timeBudgetMs: number): number {
  return Math.min(FINAL_RESERVE_CAP_MS, FINAL_RESERVE_FRACTION * timeBudgetMs);
}

/** Loop_Deadline: Time_Budget minus Final_Reserve. No new step starts after it. */
export function loopDeadlineMs(timeBudgetMs: number): number {
  return timeBudgetMs - finalReserveMs(timeBudgetMs);
}
