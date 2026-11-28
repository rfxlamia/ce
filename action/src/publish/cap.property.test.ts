import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCaps, type CappableImage } from './cap.js';

// Feature: inline-screenshot-in-pr, Property 2: Capping preserves the arithmetic invariant and the ordering, regardless of cap size
// **Validates: Requirements 8.1, 8.4, 8.6, 8.9**

interface Img extends CappableImage {
  id: number;
}

/** Requirement 4.1 order: optional final first, then steps in ascending index. */
const imageList = fc
  .record({
    hasFinal: fc.boolean(),
    sizes: fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 20 }),
    finalSize: fc.integer({ min: 0, max: 100 }),
  })
  .map(({ hasFinal, sizes, finalSize }): Img[] => {
    const list: Img[] = [];
    let id = 0;
    if (hasFinal) list.push({ id: id++, origin: { kind: 'final' }, sizeBytes: finalSize });
    sizes.forEach((sizeBytes, index) => list.push({ id: id++, origin: { kind: 'step', index }, sizeBytes }));
    return list;
  });

describe('Property 2: applyCaps', () => {
  it('keeps min(within-bytes count, cap), balances the count, keeps order and the final screenshot', () => {
    fc.assert(
      fc.property(
        imageList,
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 100 }),
        (images, imageCap, byteCap) => {
          const { kept, skippedCount } = applyCaps(images, imageCap, byteCap);
          const within = images.filter((i) => i.sizeBytes <= byteCap);

          expect(kept.length).toBe(Math.min(within.length, imageCap));
          expect(kept.length + skippedCount).toBe(images.length);
          expect(kept.every((i) => i.sizeBytes <= byteCap)).toBe(true);

          // Order is a subsequence of the input order.
          const ids = kept.map((i) => i.id);
          expect([...ids].sort((a, b) => a - b)).toEqual(ids);

          // Final screenshot within the byte cap is always published.
          const final = within.find((i) => i.origin.kind === 'final');
          if (final !== undefined) expect(kept).toContain(final);

          // Steps kept are the last ones among those within the byte cap.
          const keptSteps = kept.filter((i) => i.origin.kind === 'step');
          const withinSteps = within.filter((i) => i.origin.kind === 'step');
          expect(keptSteps).toEqual(withinSteps.slice(withinSteps.length - keptSteps.length));
        },
      ),
    );
  });
});

describe('applyCaps examples', () => {
  const step = (index: number, sizeBytes = 10): Img => ({
    id: index + 1,
    origin: { kind: 'step', index },
    sizeBytes,
  });
  const final: Img = { id: 0, origin: { kind: 'final' }, sizeBytes: 10 };

  it('default cap 6 keeps the final screenshot and the last 5 steps', () => {
    const images = [final, ...Array.from({ length: 9 }, (_, i) => step(i))];
    const { kept, skippedCount } = applyCaps(images, 6, 5242880);
    expect(kept.map((i) => i.id)).toEqual([0, 5, 6, 7, 8, 9]);
    expect(skippedCount).toBe(4);
  });

  it('counts an oversize image as skipped without using a cap slot', () => {
    const images = [final, step(0, 999), step(1), step(2)];
    const { kept, skippedCount } = applyCaps(images, 3, 100);
    expect(kept.map((i) => i.id)).toEqual([0, 2, 3]);
    expect(skippedCount).toBe(1);
  });

  it('drops an oversize final screenshot and fills its slot with steps', () => {
    const big: Img = { ...final, sizeBytes: 999 };
    const { kept, skippedCount } = applyCaps([big, step(0), step(1)], 2, 100);
    expect(kept.map((i) => i.id)).toEqual([1, 2]);
    expect(skippedCount).toBe(1);
  });

  it('returns nothing for an empty list', () => {
    expect(applyCaps([], 6, 100)).toEqual({ kept: [], skippedCount: 0 });
  });
});
