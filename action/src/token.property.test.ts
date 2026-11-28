// Feature: inline-screenshot-in-pr, Property 5: Run_Token resolution follows the fixed priority regardless of which inputs are empty
// **Validates: Requirements 1.4**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveRunToken } from './token.js';

const NUM_RUNS = 100;

// Mix empty and non-empty strings so every empty/non-empty combination is exercised.
const inputArb = fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 16 }));

describe('Property 5: resolveRunToken priority', () => {
  it('returns token, else githubToken, else defaultToken', () => {
    fc.assert(
      fc.property(inputArb, inputArb, inputArb, (token, githubToken, defaultToken) => {
        const expected =
          token !== '' ? token : githubToken !== '' ? githubToken : defaultToken;
        expect(resolveRunToken(token, githubToken, defaultToken)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('uses github-token alone when only it is set (Requirement 1.4 example)', () => {
    expect(resolveRunToken('', 'app-token', 'default')).toBe('app-token');
  });
});
