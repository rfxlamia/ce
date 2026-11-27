// Feature: github-action-pr-comment, Property 6: Rendering is deterministic
// **Validates: Requirements 8.17**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { renderPrComment } from './comment.js';
import type { CommentInput } from './comment.js';
import { commentInputArb, hostileCommentInputArb } from './comment.arbitraries.js';

const NUM_RUNS = 100;

describe('Property 6: rendering is deterministic', () => {
  it('returns byte-identical bodies for the same input rendered twice', () => {
    fc.assert(
      fc.property(fc.oneof(commentInputArb, hostileCommentInputArb), (input) => {
        expect(renderPrComment(input)).toBe(renderPrComment(input));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns the same body for a structurally equal deep copy of the input', () => {
    fc.assert(
      fc.property(fc.oneof(commentInputArb, hostileCommentInputArb), (input) => {
        const copy = structuredClone(input) as CommentInput;
        expect(renderPrComment(copy)).toBe(renderPrComment(input));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not mutate the input, so repeated renders stay equal', () => {
    fc.assert(
      fc.property(fc.oneof(commentInputArb, hostileCommentInputArb), (input) => {
        const before = JSON.stringify(input);
        const first = renderPrComment(input);
        expect(JSON.stringify(input)).toBe(before);
        expect(renderPrComment(input)).toBe(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
