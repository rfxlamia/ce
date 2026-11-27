import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { shouldCloseOnBackdropClick, type Rect } from '../src/lib/dialog';

const coord = fc.integer({ min: -1000, max: 1000 });

const rectArb: fc.Arbitrary<Rect> = fc
  .tuple(coord, coord, coord, coord)
  .map(([a, b, c, d]) => ({
    left: Math.min(a, b),
    right: Math.max(a, b),
    top: Math.min(c, d),
    bottom: Math.max(c, d),
  }));

describe('dialog backdrop click', () => {
  // Feature: landing-page-skeleton, Property 4
  // Validates: Requirements 8.8
  it('closes iff the target is the dialog and the point is strictly outside the rectangle', () => {
    fc.assert(
      fc.property(fc.boolean(), coord, coord, rectArb, (targetIsDialog, x, y, rect) => {
        const outside = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
        expect(shouldCloseOnBackdropClick(targetIsDialog, x, y, rect)).toBe(targetIsDialog && outside);
      }),
      { numRuns: 200 },
    );
  });

  it('returns false for any point when the target is not the dialog', () => {
    fc.assert(
      fc.property(coord, coord, rectArb, (x, y, rect) => {
        expect(shouldCloseOnBackdropClick(false, x, y, rect)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('returns false for (0, 0) when targetIsDialog is false, even outside the rectangle', () => {
    expect(shouldCloseOnBackdropClick(false, 0, 0, { left: 10, right: 20, top: 10, bottom: 20 })).toBe(false);
  });
});
