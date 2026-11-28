import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { COMMENT_MARKER, renderPrComment } from './comment.js';
import type { CommentInput } from './comment.js';
import { hostileCommentInputArb } from './comment.arbitraries.js';
import { buildImageUrl, parseImageUrl } from './image-url.js';
import { fallbackNote } from './publish-types.js';
import type { FallbackReason, PublishResult } from './publish-types.js';

const REASONS: readonly FallbackReason[] = [
  'fork-pr',
  'no-pr-number',
  'no-images',
  'token-lacks-write',
  'push-blocked',
  'push-conflict-exhausted',
  'ref-guard',
  'git-error',
];

const CONTEXT = { serverUrl: 'https://github.com', owner: 'o', repo: 'r', prNumber: 7 };
const SHA = 'b'.repeat(40);

const validUrlArb: fc.Arbitrary<string> = fc
  .tuple(fc.stringMatching(/^[a-z0-9-]{1,12}$/), fc.stringMatching(/^[a-z0-9-]{1,12}$/))
  .map(([run, name]) => buildImageUrl({ ...CONTEXT, sha: SHA, runId: `run-${run}`, file: `${name}.png` }));

const hostileUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'https://evil.example/x.png',
    'javascript:alert(1)',
    `https://github.com/o/r/raw/${SHA}/pr-8/run-1/a.png`,
    `https://github.com/o/r/raw/${SHA}/pr-7/run-1/a.png" onerror="x`,
    `https://github.com/other/r/raw/${SHA}/pr-7/run-1/a.png`,
    '',
  ),
  fc.string({ maxLength: 40 }),
);

const publishResultArb: fc.Arbitrary<PublishResult> = fc.oneof(
  fc.constant<PublishResult>({ kind: 'not-attempted' }),
  fc.constantFrom(...REASONS).map((reason): PublishResult => ({ kind: 'fallback', reason })),
  fc
    .record({
      imageUrls: fc.array(fc.oneof(validUrlArb, hostileUrlArb), { maxLength: 8 }),
      skippedCount: fc.integer({ min: 0, max: 20 }),
    })
    .map((r): PublishResult => ({ kind: 'published', sha: SHA, ...r })),
);

const inputArb: fc.Arbitrary<CommentInput> = fc
  .tuple(hostileCommentInputArb, publishResultArb)
  .map(([base, publishResult]) => ({
    ...base,
    publishResult,
    repository: 'o/r',
    serverUrl: CONTEXT.serverUrl,
    prNumber: CONTEXT.prNumber,
  }));

const VERDICT_WORDS = /\b(passed|failed|verified|correct)\b/i;

/** Renderer-authored text: drops escaped Claim lines, the artifact line, and the allowed "failed at stage". */
function rendererText(body: string): string {
  return body
    .split('\n')
    .filter((line) => !line.startsWith('- ') && !line.startsWith('Artifact: '))
    .join('\n')
    .split('failed at stage')
    .join('');
}

const FINAL_IMG = /^!\[final screenshot\]\(([^)]*)\)$/;
const THUMB_IMG = /^<img src="([^"]*)" alt="(step \d+ screenshot)" width="160">$/;

describe('renderPrComment by publishResult.kind', () => {
  // **Validates: Requirements 9.1, 9.2, 9.4, 9.6, 9.9, 9.11, 9.14, 9.15, 10.2**
  it('Feature: inline-screenshot-in-pr, Property 13: Comment rendering by publishResult.kind always produces the required structural anchors and never a forged marker, verdict word, or mismatched URL', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const body = renderPrComment(input);
        const result = input.publishResult!;

        // Marker exactly once, on the first line.
        expect(body.startsWith(`${COMMENT_MARKER}\n`)).toBe(true);
        expect(body.split(COMMENT_MARKER).length - 1).toBe(1);

        // Determinism.
        expect(renderPrComment(input)).toBe(body);

        // Image markup only when published with at least one surviving URL.
        const lines = body.split('\n');
        const finals = lines.filter((l) => l.startsWith('![')).map((l) => FINAL_IMG.exec(l));
        const imgLines = lines.filter((l) => l.startsWith('<img'));
        const thumbs = imgLines.map((l) => THUMB_IMG.exec(l));
        const hasMarkup = finals.length > 0 || imgLines.length > 0 || body.includes('<details>');

        const survives = (u: string): boolean => parseImageUrl(u, CONTEXT) !== undefined;
        const expectMarkup = result.kind === 'published' && result.imageUrls.some(survives);
        expect(hasMarkup).toBe(expectMarkup);

        // Every image reference is well formed, uses a validated URL, and a fixed alt.
        for (const m of finals) {
          expect(m).not.toBeNull();
          expect(survives(m![1]!)).toBe(true);
        }
        for (const m of thumbs) {
          expect(m).not.toBeNull();
          expect(survives(m![1]!)).toBe(true);
          expect(m![2]).toMatch(/^step \d+ screenshot$/);
        }
        expect(body.match(/<img/g)?.length ?? 0).toBe(imgLines.length);
        expect(body.match(/!\[final screenshot\]/g)?.length ?? 0).toBe(finals.length);
        // Markdown image syntax appears only in the fixed final-screenshot form.
        expect(body.match(/(?<!\\)!\[/g)?.length ?? 0).toBe(finals.length);

        // Fallback note verbatim iff fallback; no other kind carries a publish note.
        if (result.kind === 'fallback') {
          expect(body).toContain(fallbackNote(result.reason));
        } else {
          expect(body).not.toContain('publish skipped:');
        }
        if (result.kind !== 'published') expect(hasMarkup).toBe(false);

        // Artifact line is kept in every case.
        expect(body).toContain('Artifact: ');

        // No verdict words in renderer-authored text.
        expect(VERDICT_WORDS.test(rendererText(body))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('not-attempted renders exactly as when publishResult is omitted', () => {
    fc.assert(
      fc.property(hostileCommentInputArb, (base) => {
        const withField = renderPrComment({ ...base, publishResult: { kind: 'not-attempted' } });
        const without = renderPrComment(base);
        expect(withField).toBe(without);
      }),
      { numRuns: 50 },
    );
  });
});
