import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { argmaxSurface } from './answers.js';
import type { Surface } from './types.js';

// Feature: claims-assessment-eval, Property 9: Surface argmax tie-break
// **Validates: Requirements 5.3, 5.4**

const prob = fc.double({ min: 0, max: 1, noNaN: true });

// Small discrete grid so that ties for the maximum occur often.
const gridProb = fc.constantFrom(0, 0.25, 0.5, 0.75, 1);

function distribution(p: fc.Arbitrary<number>): fc.Arbitrary<Record<Surface, number>> {
  return fc
    .array(p, { minLength: SURFACE_LABELS.length, maxLength: SURFACE_LABELS.length })
    .map((values) => {
      const record = {} as Record<Surface, number>;
      SURFACE_LABELS.forEach((label, i) => {
        record[label] = values[i]!;
      });
      return record;
    });
}

function check(dist: Record<Surface, number>): void {
  const max = Math.max(...SURFACE_LABELS.map((l) => dist[l]));
  const expected = SURFACE_LABELS.find((l) => dist[l] === max)!;
  const result = argmaxSurface(dist);
  expect(result.confidence).toBe(max);
  expect(result.surface).toBe(expected);
}

describe('Feature: claims-assessment-eval, Property 9: Surface argmax tie-break', () => {
  it('returns the max-probability label, earliest in SURFACE_LABELS on ties (continuous)', () => {
    fc.assert(
      fc.property(distribution(prob), check),
      { numRuns: 100 },
    );
  });

  it('returns the earliest label among ties (discrete grid, frequent ties)', () => {
    fc.assert(
      fc.property(distribution(gridProb), check),
      { numRuns: 200 },
    );
  });

  it('returns the first label when all probabilities are equal', () => {
    fc.assert(
      fc.property(prob, (p) => {
        const dist = {} as Record<Surface, number>;
        for (const label of SURFACE_LABELS) dist[label] = p;
        expect(argmaxSurface(dist)).toEqual({ surface: SURFACE_LABELS[0], confidence: p });
      }),
      { numRuns: 100 },
    );
  });
});
