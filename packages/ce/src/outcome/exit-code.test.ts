import { describe, expect, it } from 'vitest';
import { exitCodeFor, type FailOnEntry } from './exit-code.js';
import type { Resolution } from './types.js';

const error: Resolution = { outcome: 'ERROR', reason: 'stage-error', errorStage: 'runtime' };
const unsupported: Resolution = { outcome: 'UNSUPPORTED', reason: 'surface-unsupported' };
const notReached: Resolution = {
  outcome: 'EVIDENCED',
  reason: 'no-observation',
  finalState: 'not_reached',
};
const all: FailOnEntry[] = ['error', 'unsupported', 'evidenced-not-reached'];

describe('exitCodeFor', () => {
  it('uses three non-zero codes distinct from each other and from 0', () => {
    const codes = [
      exitCodeFor(error, all),
      exitCodeFor(unsupported, all),
      exitCodeFor(notReached, all),
    ];
    expect(codes).toEqual([1, 2, 3]);
    expect(new Set([0, ...codes]).size).toBe(4);
  });

  it('returns 1 for ERROR with the default list (undefined)', () => {
    expect(exitCodeFor(error, undefined)).toBe(1);
  });

  it('returns 0 for ERROR with an empty list', () => {
    expect(exitCodeFor(error, [])).toBe(0);
  });

  it('ignores order and duplicates in the list', () => {
    expect(exitCodeFor(unsupported, ['error', 'unsupported', 'unsupported'])).toBe(2);
    expect(exitCodeFor(unsupported, ['unsupported', 'error'])).toBe(2);
  });
});
