// Reading and validating Jev answers. Shared by claims.ts, assess.ts and eval/run.ts
// so that every caller reads an answer exactly the same way.
//
// Malformed answers throw: TypeError for a wrong shape or `type`, RangeError for a
// probability outside 0..1. Callers wrap these into StageError.

import { SURFACE_LABELS } from '../jev/catalog.js';
import type { Surface } from './types.js';

function describe(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

function checkProbability(value: unknown, where: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError(`${where} must be a number, got ${describe(value)}`);
  }
  if (value < 0 || value > 1) {
    throw new RangeError(`${where} must be within 0 to 1, got ${value}`);
  }
  return value;
}

/** Read the yes-probability of a Noul answer. */
export function readNoul(answer: unknown): number {
  if (typeof answer !== 'object' || answer === null) {
    throw new TypeError(`Noul answer must be an object, got ${describe(answer)}`);
  }
  const a = answer as { type?: unknown; noul?: unknown };
  if (a.type !== 'noul') {
    throw new TypeError(`expected answer type "noul", got ${String(a.type)}`);
  }
  return checkProbability(a.noul, 'noul probability');
}

/**
 * Read the probabilities of a Choice answer. Every label in `labels` must be present.
 * The result holds exactly the given labels, in the order of `labels`.
 */
export function readChoice<L extends string>(
  answer: unknown,
  labels: readonly L[],
): Record<L, number> {
  if (typeof answer !== 'object' || answer === null) {
    throw new TypeError(`Choice answer must be an object, got ${describe(answer)}`);
  }
  const a = answer as { type?: unknown; probabilities?: unknown };
  if (a.type !== 'choice') {
    throw new TypeError(`expected answer type "choice", got ${String(a.type)}`);
  }
  if (typeof a.probabilities !== 'object' || a.probabilities === null) {
    throw new TypeError(`Choice probabilities must be an object, got ${describe(a.probabilities)}`);
  }
  const source = a.probabilities as Record<string, unknown>;
  const result = {} as Record<L, number>;
  for (const label of labels) {
    if (!Object.prototype.hasOwnProperty.call(source, label)) {
      throw new TypeError(`Choice answer is missing label "${label}"`);
    }
    result[label] = checkProbability(source[label], `probability of "${label}"`);
  }
  return result;
}

/**
 * Pick the surface with the highest probability. A tie goes to the label that
 * appears earliest in SURFACE_LABELS.
 */
export function argmaxSurface(probabilities: Record<Surface, number>): {
  surface: Surface;
  confidence: number;
} {
  let best: Surface = SURFACE_LABELS[0];
  let bestP = probabilities[best];
  for (const label of SURFACE_LABELS) {
    const p = probabilities[label];
    if (p > bestP) {
      best = label;
      bestP = p;
    }
  }
  return { surface: best, confidence: bestP };
}
