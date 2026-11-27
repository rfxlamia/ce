// Feature: github-action-pr-comment, Property 9: The Cache_Key is a pure function that distinguishes every input dimension
// **Validates: Requirements 4.2, 4.9, 15.4**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildCacheKey } from './cache.js';

const NUM_RUNS = 100;

// Include '-' heavily so separator collisions are exercised.
const partArb = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.stringMatching(/^[a-z0-9.\-]{0,8}$/),
  fc.constantFrom('linux', 'darwin', 'win32', 'x64', 'arm64', '1.50.0', '1.50.0-beta', 'a-b', 'a', 'b'),
);
const tripleArb = fc.tuple(partArb, partArb, partArb);

describe('Property 9: Cache_Key', () => {
  it('is deterministic for one triple', () => {
    fc.assert(
      fc.property(tripleArb, ([os, arch, v]) => {
        expect(buildCacheKey(os, arch, v)).toBe(buildCacheKey(os, arch, v));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns different keys for triples that differ in at least one component', () => {
    fc.assert(
      fc.property(tripleArb, tripleArb, (a, b) => {
        fc.pre(a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]);
        expect(buildCacheKey(...a)).not.toBe(buildCacheKey(...b));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('distinguishes components that move a hyphen across a boundary', () => {
    expect(buildCacheKey('a-b', 'c', 'v')).not.toBe(buildCacheKey('a', 'b-c', 'v'));
    expect(buildCacheKey('os', 'a-b', 'c')).not.toBe(buildCacheKey('os', 'a', 'b-c'));
  });
});
