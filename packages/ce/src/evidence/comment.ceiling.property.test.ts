// Feature: inline-screenshot-in-pr, Property 14: Length and count ceilings drop step thumbnails before Claims, and never drop a required anchor
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { COMMENT_MARKER, renderPrComment } from './comment.js';
import type { CommentInput } from './comment.js';
import { artifactLinkArb } from './comment.arbitraries.js';
import { runRecordArb } from './arbitraries.js';
import { buildImageUrl } from './image-url.js';
import { rationaleLine } from './summary.js';

const NUM_RUNS = 15;
const MAX_BODY = 60000;

const CONTEXT = { serverUrl: 'https://github.com', owner: 'o', repo: 'r', prNumber: 7 } as const;
const REPOSITORY = `${CONTEXT.owner}/${CONTEXT.repo}`;

const shaArb = fc.stringMatching(/^[0-9a-f]{40}$/);
const runIdArb = fc.stringMatching(/^run-[A-Za-z0-9-]{1,40}$/);

interface Scenario {
  input: CommentInput;
  thumbCount: number;
  skippedCount: number;
  claimCount: number;
}

/** A published result with many step thumbnails and a record with many Claims. */
const scenarioArb = (thumbs: fc.Arbitrary<number>): fc.Arbitrary<Scenario> =>
  fc
    .tuple(
      runRecordArb,
      shaArb,
      runIdArb,
      thumbs,
      fc.integer({ min: 0, max: 20 }),
      fc.integer({ min: 0, max: 30 }),
      artifactLinkArb,
    )
    .map(([record, sha, runId, thumbCount, skippedCount, claimCount, artifactLink]) => {
      const url = (file: string): string => buildImageUrl({ ...CONTEXT, sha, runId, file });
      const imageUrls = [url('final.png'), ...Array.from({ length: thumbCount }, (_, i) => url(`step-${i}.png`))];
      const claims = Array.from({ length: claimCount }, (_, i) => ({
        id: `c${i}`,
        text: `claim number ${i}`,
        probability: null,
        provenance: { provider: 'cli' as const },
      }));
      const input: CommentInput = {
        record: { ...record, claims } as typeof record,
        artifactLink,
        secrets: [],
        publishResult: {
          kind: 'published',
          sha,
          imageUrls,
          finalIncluded: true,
          stepNumbers: Array.from({ length: thumbCount }, (_, i) => i + 1),
          skippedCount,
        },
        repository: REPOSITORY,
        serverUrl: CONTEXT.serverUrl,
        prNumber: CONTEXT.prNumber,
      };
      return { input, thumbCount, skippedCount, claimCount };
    });

/** Mix of small counts (no overflow) and counts large enough to overflow 60000. */
const anyThumbCountArb = fc.oneof(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 400, max: 600 }));
const overflowThumbCountArb = fc.integer({ min: 500, max: 600 });

function assertAnchors(input: CommentInput, body: string): void {
  const lines = body.split('\n');
  expect(lines[0]).toBe(COMMENT_MARKER);
  expect(lines.some((l) => l.startsWith('Outcome: '))).toBe(true);
  expect(lines.some((l) => l.startsWith('Artifact: '))).toBe(true);
  if (input.artifactLink === '') {
    expect(lines).toContain('Artifact: the evidence artifact is unavailable.');
  }
  expect(lines.some((l) => /^!\[final screenshot\]\(https:\/\/github\.com\/o\/r\/raw\/[0-9a-f]{40}\/pr-7\/[^)]+\/final\.png\)$/.test(l))).toBe(
    true,
  );
  const r = input.record;
  if (!('kind' in r)) {
    const line = rationaleLine({
      outcome: r.outcome,
      reason: r.outcomeReason,
      stage: r.error?.stage,
      surface: r.assessment?.surface,
      decidedBy: r.assessment?.decidedBy,
      finalState: r.finalState,
      stepCount: r.steps.length,
    });
    if (/^[A-Za-z0-9 _.:,()-]*$/.test(line) && line.trim() !== '') expect(lines).toContain(line);
  }
}

function shownThumbs(body: string): number {
  return body.split('\n').filter((l) => l.startsWith('<img ')).length;
}

function shownClaims(body: string): number {
  return body.split('\n').filter((l) => /^- claim number \d+$/.test(l)).length;
}

function moreScreenshots(body: string): number | undefined {
  const m = body.match(/^\(\+(\d+) more screenshots in the artifact\)$/m);
  return m === null ? undefined : Number(m[1]);
}

describe('Property 14: length and count ceilings with thumbnails', () => {
  it('stays within 60000 characters and keeps every required anchor', () => {
    fc.assert(
      fc.property(scenarioArb(anyThumbCountArb), ({ input }) => {
        const body = renderPrComment(input);
        expect(body.length).toBeLessThanOrEqual(MAX_BODY);
        assertAnchors(input, body);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('drops thumbnails before Claims and reports them in N', () => {
    fc.assert(
      fc.property(scenarioArb(anyThumbCountArb), ({ input, thumbCount, skippedCount, claimCount }) => {
        const body = renderPrComment(input);
        const thumbs = shownThumbs(body);
        const claims = shownClaims(body);
        expect(thumbs).toBeLessThanOrEqual(thumbCount);

        // Every dropped thumbnail is counted in N, together with the skipped count.
        const expectedMore = skippedCount + (thumbCount - thumbs);
        expect(moreScreenshots(body) ?? 0).toBe(expectedMore);

        // A Claim is dropped only after every thumbnail is gone.
        if (claims < Math.min(10, claimCount)) expect(thumbs).toBe(0);
        // Claims are not dropped at all when thumbnails alone can be shed to fit.
        expect(claims).toBe(Math.min(10, claimCount));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('actually sheds thumbnails when the naive body would overflow', () => {
    fc.assert(
      fc.property(scenarioArb(overflowThumbCountArb), ({ input, thumbCount, skippedCount }) => {
        const body = renderPrComment(input);
        expect(body.length).toBeLessThanOrEqual(MAX_BODY);
        const thumbs = shownThumbs(body);
        expect(thumbs).toBeLessThan(thumbCount);
        expect(moreScreenshots(body)).toBe(skippedCount + (thumbCount - thumbs));
        assertAnchors(input, body);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
