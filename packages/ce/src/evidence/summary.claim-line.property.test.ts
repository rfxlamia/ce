import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildSummary } from './summary.js';

// Short, single-line texts keep the line under the 200-character limit so
// that the content rules are checked without truncation.
const claimText = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 .,]{0,39}$/).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 0);

function claimLineOf(claimTexts: string[]): string {
  const text = buildSummary({ kind: 'no_bundle', outcome: 'SKIPPED', reason: 'stage-error', claimTexts });
  const line = text.split('\n')[1];
  if (line === undefined) throw new Error('no claim line');
  return line;
}

describe('Terminal_Summary claim line', () => {
  // **Validates: Requirements 8.4, 8.5**
  it('Feature: evidence-bundle, Property 26: Claim line content matches claim count exactly', () => {
    fc.assert(
      fc.property(fc.array(claimText, { maxLength: 6 }), (texts) => {
        const line = claimLineOf(texts);
        if (texts.length === 0) {
          expect(line).toBe('Claim: no claim was identified');
        } else if (texts.length === 1) {
          expect(line).toBe(`Claim: ${texts[0]}`);
          expect(line).not.toContain('more)');
        } else {
          expect(line).toBe(`Claim: ${texts[0]} (+${texts.length - 1} more)`);
        }
      }),
      { numRuns: 200 },
    );
  });
});
