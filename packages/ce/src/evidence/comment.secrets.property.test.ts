// Feature: github-action-pr-comment, Property 3: Every Secret_Value is absent from the rendered and the written body
// **Validates: Requirements 10.5, 15.1**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { renderPrComment, stripCommentMarker } from './comment.js';
import type { CommentInput } from './comment.js';
import { hostileCommentInputArb, secretValueArb } from './comment.arbitraries.js';

/** Secrets that appear inside the artifact link as well as inside Claim text. */
const withSecretLinkArb: fc.Arbitrary<CommentInput> = fc
  .tuple(hostileCommentInputArb, secretValueArb, fc.boolean())
  .map(([input, secret, useLink]) =>
    useLink
      ? {
          ...input,
          artifactLink: `https://github.com/o/r/actions/runs/1/artifacts/${secret}`,
          secrets: [...input.secrets, secret],
        }
      : input,
  );

describe('Property 3: secret values never reach the rendered or the written body', () => {
  it('no Secret_Value appears in the body or in the job-summary text', () => {
    fc.assert(
      fc.property(withSecretLinkArb, (input) => {
        const body = renderPrComment(input);
        // The written body is the job-summary text: the body without the marker line.
        const written = stripCommentMarker(body);
        for (const secret of input.secrets) {
          expect(body).not.toContain(secret);
          expect(written).not.toContain(secret);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('a Secret_Value inside Claim text is replaced, not dropped silently with the line', () => {
    fc.assert(
      fc.property(secretValueArb, (secret) => {
        const input = {
          record: {
            kind: 'unavailable' as const,
            exitCode: 1,
          },
          artifactLink: `https://example.com/${secret}`,
          secrets: [secret],
        };
        const body = renderPrComment(input);
        expect(body).not.toContain(secret);
        expect(stripCommentMarker(body)).not.toContain(secret);
      }),
      { numRuns: 100 },
    );
  });
});
