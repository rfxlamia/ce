import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHANGE_STOPWORDS } from './constants.js';
import { changeTermsFrom, proximityScore } from './decide.js';

// Feature: observe-decide-execute-loop, Property 5: Change_Terms and Proximity_Score are pure token functions

const wordArb = fc
  .stringMatching(/^[a-z]{3,8}$/)
  .filter((w) => !CHANGE_STOPWORDS.has(w));

describe('Property 5: Change_Terms and Proximity_Score are pure token functions', () => {
  /**
   * **Validates: Requirements 2.8, 12.14**
   */
  it('changeTermsFrom drops short tokens, all-digit tokens and stopwords for arbitrary text', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 80 }),
        fc.string({ maxLength: 80 }),
        (path, addedLine) => {
          const terms = changeTermsFrom([{ path, patch: `+${addedLine}\n` }]);
          for (const term of terms) {
            expect(term.length).toBeGreaterThanOrEqual(3);
            expect(/^[0-9]+$/.test(term)).toBe(false);
            expect(CHANGE_STOPWORDS.has(term)).toBe(false);
            expect(term).toMatch(/^[a-z0-9]+$/);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.8, 12.14**
   */
  it('changeTermsFrom splits camelCase boundaries and drops short and numeric tokens', () => {
    fc.assert(
      fc.property(
        fc.array(wordArb, { minLength: 1, maxLength: 4 }),
        fc.stringMatching(/^[a-z]{1,2}$/),
        fc.stringMatching(/^[0-9]{1,6}$/),
        (words, shortWord, digits) => {
          const camel = words.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('');
          const terms = changeTermsFrom([{ path: `${camel}.${shortWord}.${digits}` }]);
          expect(new Set(terms)).toEqual(new Set(words));
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.8, 12.14**
   */
  it('changeTermsFrom ignores removed lines and uses only added lines', () => {
    fc.assert(
      fc.property(wordArb, wordArb, (added, removed) => {
        fc.pre(added !== removed);
        const terms = changeTermsFrom([{ path: '', patch: `-${removed}\n+${added}\n ${removed}\n` }]);
        expect(new Set(terms)).toEqual(new Set([added]));
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.8, 12.14**
   */
  it('proximityScore counts distinct whole-token matches', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(wordArb, { minLength: 1, maxLength: 6 }),
        fc.array(wordArb, { maxLength: 8 }),
        (terms, others) => {
          const changeTerms = new Set(terms);
          const matchText = [...others, ...terms, ...terms].join(' ');
          const expected = new Set(matchText.split(' ').filter((t) => changeTerms.has(t))).size;
          expect(proximityScore(matchText, changeTerms)).toBe(expected);
          expect(proximityScore(matchText, new Set())).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.8, 12.14**
   */
  it('proximityScore never matches a Change_Term as a substring of a longer token', () => {
    fc.assert(
      fc.property(
        wordArb,
        fc.stringMatching(/^[a-z]{1,4}$/),
        fc.stringMatching(/^[a-z]{1,4}$/),
        (term, prefix, suffix) => {
          const changeTerms = new Set([term]);
          expect(proximityScore(`${term}${suffix}`, changeTerms)).toBe(0);
          expect(proximityScore(`${prefix}${term}`, changeTerms)).toBe(0);
          expect(proximityScore(`${prefix}${term}${suffix}`, changeTerms)).toBe(0);
          expect(proximityScore(`${prefix}-${term}_${suffix}`, changeTerms)).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
