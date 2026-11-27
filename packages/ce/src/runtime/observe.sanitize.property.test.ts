import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sanitizeText } from './observe.js';

// Fixture values are upper-case alphanumerics so they can never be a substring of the
// lower-case `[redacted]` marker, and contain no whitespace so collapsing cannot alter them.
const fixtureValueArb = fc.stringMatching(/^[A-Z0-9]{3,8}$/);
const fixtureValuesArb = fc.array(fixtureValueArb, { minLength: 0, maxLength: 4 });

const noiseArb = fc.oneof(
  fc.string({ maxLength: 60, unit: 'grapheme' }),
  fc.stringMatching(/^[a-z "\\\n\t\r\u0000\u0007\u00a0 ]{0,60}$/),
);

// Raw text that mixes noise with embedded fixture values.
const rawArb = (fixtures: string[]) =>
  fc
    .array(fixtures.length > 0 ? fc.oneof(noiseArb, fc.constantFrom(...fixtures)) : noiseArb, {
      maxLength: 12,
    })
    .map((parts) => parts.join(''));

const inputArb = fc.tuple(fixtureValuesArb, fc.integer({ min: 1, max: 200 })).chain(([fixtures, limit]) =>
  rawArb(fixtures).map((raw) => ({ raw, fixtures, limit })),
);

/** Removes every escape pair `\\` and `\"`. What remains must contain no `\` and no `"`. */
function stripEscapes(text: string): string {
  return text.replace(/\\[\\"]/g, '');
}

/** Reverses the final escaping step, giving the text as it was before escaping. */
function unescape(text: string): string {
  return text.replace(/\\([\\"])/g, '$1');
}

describe('sanitizeText properties', () => {
  // Feature: observe-decide-execute-loop, Property 3: Sanitized_Text is bounded, single-line and fixture-free
  // **Validates: Requirements 1.9, 6.6**
  it('Property 3: result is bounded, single-line, escaped and free of every fixture value', () => {
    fc.assert(
      fc.property(inputArb, ({ raw, fixtures, limit }) => {
        const out = sanitizeText(raw, { maxLength: limit, fixtureValues: fixtures });

        // Escaping runs after truncation, so bound the length before escaping.
        expect(unescape(out).length).toBeLessThanOrEqual(limit);

        // Single line: no control characters, no whitespace other than single inner spaces.
        expect(out).not.toMatch(/\p{Cc}/u);
        expect(out).not.toMatch(/[^\S ]/u);
        expect(out).not.toMatch(/ {2}/);
        expect(out).toBe(out.trim());

        // Every `"` and `\` is part of an escape pair.
        expect(stripEscapes(out)).not.toMatch(/["\\]/);

        // No fixture value survives, in the escaped or the unescaped form.
        for (const value of fixtures) {
          expect(out).not.toContain(value);
          expect(unescape(out)).not.toContain(value);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('redacts a fixture value that appears in the raw text', () => {
    expect(sanitizeText('token SECRET123 here', { fixtureValues: ['SECRET123'] })).toBe(
      'token [redacted] here',
    );
  });

  it('truncates to the limit with the ellipsis counted, then escapes', () => {
    const out = sanitizeText('a"'.repeat(100), { maxLength: 10, fixtureValues: [] });
    expect(unescape(out)).toHaveLength(10);
    expect(unescape(out).endsWith('…')).toBe(true);
  });
});
