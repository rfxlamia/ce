import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { COMMENT_MARKER, renderPrComment } from './comment.js';
import { commentInputArb, hostileCommentInputArb } from './comment.arbitraries.js';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('PR comment marker', () => {
  // **Validates: Requirements 8.2, 8.16, 10.3**
  it('Feature: github-action-pr-comment, Property 1: The Comment_Marker appears exactly once, on the first line', () => {
    fc.assert(
      fc.property(fc.oneof(commentInputArb, hostileCommentInputArb), (input) => {
        const body = renderPrComment(input);
        expect(body.split('\n')[0]).toBe(COMMENT_MARKER);
        expect(count(body, COMMENT_MARKER)).toBe(1);
        // No other HTML comment opener exists anywhere in the body.
        expect(count(body, '<!--')).toBe(1);
      }),
      { numRuns: 200 },
    );
  });
});
