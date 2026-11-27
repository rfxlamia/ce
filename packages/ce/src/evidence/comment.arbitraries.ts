// fast-check arbitraries for the PR comment renderer (test-only).
import fc from 'fast-check';
import { COMMENT_MARKER } from './comment.js';
import type { CommentInput, UnavailableRecord } from './comment.js';
import { runRecordArb } from './arbitraries.js';

/** Secret values the hostile text may embed. Long enough to avoid accidental matches. */
export const secretValueArb: fc.Arbitrary<string> = fc.stringMatching(/^[A-Za-z0-9]{12,24}$/);

const hostileFragments = [
  COMMENT_MARKER,
  '<!--',
  '-->',
  '@user',
  '@org/team',
  '#12',
  '[x](http://e)',
  '![i](http://e/i.png)',
  'http://example.com',
  '<script>alert(1)</script>',
  '<img src=x onerror=1>',
  '# heading',
  '```',
  '*bold*',
  '_it_',
  '\\',
  '|',
  '\n',
  '\r\n',
];

/** Claim text built from hostile fragments, filler and optionally a secret. */
export const hostileClaimTextArb = (secrets: readonly string[] = []): fc.Arbitrary<string> =>
  fc
    .array(
      fc.oneof(
        fc.constantFrom(...hostileFragments),
        fc.string({ maxLength: 30 }),
        ...(secrets.length > 0 ? [fc.constantFrom(...secrets)] : []),
      ),
      { minLength: 1, maxLength: 8 },
    )
    .map((parts) => parts.join(' '));

/** An UnavailableRecord with any integer exit code. */
export const unavailableRecordArb: fc.Arbitrary<UnavailableRecord> = fc.record({
  kind: fc.constant('unavailable' as const),
  exitCode: fc.integer({ min: -1, max: 255 }),
});

export const artifactLinkArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc
    .stringMatching(/^[a-z0-9]{1,12}$/)
    .map((id) => `https://github.com/o/r/actions/runs/1/artifacts/${id}`),
);

/** CommentInput over valid run records or unavailable records, with any secret list. */
export const commentInputArb: fc.Arbitrary<CommentInput> = fc.record({
  record: fc.oneof(runRecordArb, unavailableRecordArb),
  artifactLink: artifactLinkArb,
  secrets: fc.array(secretValueArb, { maxLength: 3 }),
});

/** CommentInput whose claims are hostile and may contain the given secrets. */
export const hostileCommentInputArb: fc.Arbitrary<CommentInput> = fc
  .array(secretValueArb, { maxLength: 3 })
  .chain((secrets) =>
    fc
      .tuple(
        runRecordArb,
        fc.array(hostileClaimTextArb(secrets), { minLength: 1, maxLength: 15 }),
        artifactLinkArb,
      )
      .map(([record, texts, artifactLink]) => ({
        record: {
          ...record,
          claims: texts.map((text, i) => ({
            id: `c${i}`,
            text,
            probability: i % 2 === 0 ? 0.5 : null,
            provenance: { provider: 'cli' as const },
          })),
        } as typeof record,
        artifactLink,
        secrets,
      })),
  );
