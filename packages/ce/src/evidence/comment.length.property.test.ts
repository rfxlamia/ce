// Feature: github-action-pr-comment, Property 5: The body respects the length and Claim-count ceilings without losing the required lines
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { COMMENT_MARKER, renderPrComment } from './comment.js';
import type { CommentInput } from './comment.js';
import { artifactLinkArb, hostileClaimTextArb, secretValueArb, unavailableRecordArb } from './comment.arbitraries.js';
import { runRecordArb } from './arbitraries.js';
import { rationaleLine } from './summary.js';

const NUM_RUNS = 100;

/** Claim text: plain filler, hostile fragments, or a long run well past 200 code points. */
const claimTextArb: fc.Arbitrary<string> = fc.oneof(
  hostileClaimTextArb(),
  fc.string({ minLength: 1, maxLength: 400 }),
  fc.integer({ min: 201, max: 3000 }).map((n) => 'a'.repeat(n)),
  fc.integer({ min: 201, max: 600 }).map((n) => '😀'.repeat(n)),
);

/** A run record with an arbitrary number of Claims of arbitrary length. */
const manyClaimsInputArb: fc.Arbitrary<CommentInput> = fc
  .tuple(
    runRecordArb,
    fc.array(claimTextArb, { minLength: 0, maxLength: 40 }),
    artifactLinkArb,
    fc.array(secretValueArb, { maxLength: 2 }),
  )
  .map(([record, texts, artifactLink, secrets]) => ({
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
  }));

/** Many large Claims, so the naive rendering is far over 60000 characters. */
const hugeClaimsInputArb: fc.Arbitrary<CommentInput> = fc
  .tuple(runRecordArb, fc.integer({ min: 100, max: 400 }), artifactLinkArb)
  .map(([record, count, artifactLink]) => ({
    record: {
      ...record,
      claims: Array.from({ length: count }, (_, i) => ({
        id: `c${i}`,
        text: `${i} ${'x'.repeat(5000)}`,
        probability: null,
        provenance: { provider: 'cli' as const },
      })),
    } as typeof record,
    artifactLink,
    secrets: [],
  }));

const mixedInputArb: fc.Arbitrary<CommentInput> = fc.oneof(
  manyClaimsInputArb,
  hugeClaimsInputArb,
  fc.record({ record: unavailableRecordArb, artifactLink: artifactLinkArb, secrets: fc.constant([] as string[]) }),
);

/** Claim bullet lines: the lines between `Claims:` and the next blank line. */
function claimBullets(body: string): string[] {
  const lines = body.split('\n');
  const start = lines.indexOf('Claims:');
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== ''; i++) {
    if (lines[i]!.startsWith('- ')) out.push(lines[i]!);
  }
  return out;
}

function claimTextOf(bullet: string): string {
  return bullet.slice(2).replace(/ \(signal: \d+\.\d\d\)$/, '');
}

function assertRequiredLines(input: CommentInput, body: string): void {
  const lines = body.split('\n');
  expect(lines[0]).toBe(COMMENT_MARKER);
  expect(lines.some((l) => l.startsWith('Outcome: '))).toBe(true);
  expect(lines.some((l) => l.startsWith('Artifact: '))).toBe(true);
  if (input.artifactLink === '') {
    expect(lines).toContain('Artifact: the evidence artifact is unavailable.');
  }
  if ('kind' in input.record) {
    expect(lines).toContain('Why: no run record was available');
  } else {
    const r = input.record;
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

describe('Property 5: length and Claim-count ceilings', () => {
  it('keeps the body within 60000 characters and keeps the required lines', () => {
    fc.assert(
      fc.property(mixedInputArb, (input) => {
        const body = renderPrComment(input);
        expect(body.length).toBeLessThanOrEqual(60000);
        assertRequiredLines(input, body);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('lists at most 10 Claims of at most 200 code points, and counts the rest', () => {
    fc.assert(
      fc.property(mixedInputArb, (input) => {
        const body = renderPrComment(input);
        const bullets = claimBullets(body);
        expect(bullets.length).toBeLessThanOrEqual(10);
        for (const b of bullets) {
          expect(Array.from(claimTextOf(b)).length).toBeLessThanOrEqual(200);
        }
        if (!('kind' in input.record)) {
          const total = input.record.claims.length;
          const more = body.match(/^\(\+(\d+) more claims\)$/m);
          if (total > 10 && bullets.length === Math.min(10, total)) {
            expect(more?.[1]).toBe(String(total - bullets.length));
          }
          if (total > 0) expect(bullets.length).toBeGreaterThan(0);
          if (total <= 10) expect(more).toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('ends a cut Claim with the ellipsis', () => {
    fc.assert(
      fc.property(
        runRecordArb,
        fc.integer({ min: 201, max: 3000 }),
        fc.constantFrom('a', '😀', 'word '),
        (record, n, unit) => {
          const text = unit.repeat(n);
          const input: CommentInput = {
            record: {
              ...record,
              claims: [{ id: 'c0', text, probability: null, provenance: { provider: 'cli' as const } }],
            } as typeof record,
            artifactLink: '',
            secrets: [],
          };
          const bullets = claimBullets(renderPrComment(input));
          expect(bullets).toHaveLength(1);
          const shown = claimTextOf(bullets[0]!);
          expect(shown.endsWith('…')).toBe(true);
          expect(Array.from(shown).length).toBeLessThanOrEqual(200);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
