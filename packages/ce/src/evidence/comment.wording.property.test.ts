import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { renderPrComment } from './comment.js';
import { commentInputArb, hostileCommentInputArb } from './comment.arbitraries.js';
import { OUTCOMES } from '../outcome/types.js';

const VERDICT_WORDS = /\b(passed|failed|verified|correct)\b/i;
const OUTCOME_TOKEN = new RegExp(`\\b(${OUTCOMES.join('|')})\\b`, 'g');

/**
 * The renderer-authored text: drops the escaped untrusted Claim lines and the
 * artifact line (its URL id is arbitrary), and the one allowed phrase
 * "failed at stage", which describes the CE process (Requirements 8.10, 9.2).
 */
function rendererText(body: string): string {
  return body
    .split('\n')
    .filter((line) => !line.startsWith('- ') && !line.startsWith('Artifact: '))
    .join('\n')
    .split('failed at stage')
    .join('');
}

describe('PR comment wording', () => {
  // **Validates: Requirements 8.3, 8.8, 8.12, 8.16, 9.4**
  it('Feature: github-action-pr-comment, Property 4: The rendered body never uses a verdict word, and never states an Outcome the input did not carry', () => {
    fc.assert(
      fc.property(fc.oneof(commentInputArb, hostileCommentInputArb), (input) => {
        const body = renderPrComment(input);
        const text = rendererText(body);

        expect(VERDICT_WORDS.test(text)).toBe(false);

        const stated = new Set(text.match(OUTCOME_TOKEN) ?? []);
        const carried = 'kind' in input.record ? [] : [input.record.outcome];
        for (const word of stated) expect(carried).toContain(word);

        if ('kind' in input.record) {
          expect(body).toContain('Outcome: unknown (no run record)');
        } else {
          expect(body).toContain(`Outcome: ${input.record.outcome}`);
        }
      }),
      { numRuns: 200 },
    );
  });
});
