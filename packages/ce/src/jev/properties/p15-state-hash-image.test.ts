import { image, withAssets } from '@typesafe-ai/sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { finalImageQuestions } from '../catalog.js';
import { stateHash } from '../hash.js';

// NOTE for architecture test (task 13.3): this test file calls image/withAssets
// directly to build multi-image states. Test files must be excluded from the
// "only jev/catalog.ts may call image/withAssets" check.

const bytes = fc.uint8Array({ minLength: 1, maxLength: 64 });

function flip(data: Uint8Array, index: number): Uint8Array {
  const copy = Uint8Array.from(data);
  const i = index % copy.length;
  copy[i] = (copy[i] ?? 0) ^ 0xff;
  return copy;
}

describe('jev-gateway properties', () => {
  // Feature: jev-gateway, Property 15: stateHash depends on image bytes and position, never on the asset reference
  // **Validates: Requirements 10.3, 10.8**
  it('Property 15: stateHash ignores random asset references and tracks image bytes and position', () => {
    fc.assert(
      fc.property(fc.string(), bytes, bytes, fc.nat(), (claim, a, b, at) => {
        // Catalog builder: separately constructed assets, same bytes, different random references.
        const s1 = finalImageQuestions(claim, a).state;
        const s2 = finalImageQuestions(claim, Uint8Array.from(a)).state;
        expect(stateHash(s1)).toBe(stateHash(s2));

        // Changing the bytes changes the hash.
        const changed = finalImageQuestions(claim, flip(a, at)).state;
        expect(stateHash(changed)).not.toBe(stateHash(s1));

        // Two images: equal bytes give equal hashes despite distinct references.
        const two = (x: Uint8Array, y: Uint8Array) => {
          const ix = image(Uint8Array.from(x));
          const iy = image(Uint8Array.from(y));
          return withAssets`${claim}\nfirst: ${ix}\nsecond: ${iy}`;
        };
        expect(stateHash(two(a, b))).toBe(stateHash(two(a, b)));
        expect(stateHash(two(flip(a, at), b))).not.toBe(stateHash(two(a, b)));
        expect(stateHash(two(a, flip(b, at)))).not.toBe(stateHash(two(a, b)));

        // Position: swapping differing images changes the hash.
        fc.pre(Buffer.compare(a, b) !== 0);
        expect(stateHash(two(b, a))).not.toBe(stateHash(two(a, b)));
      }),
      { numRuns: 100 },
    );
  });
});
