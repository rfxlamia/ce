// Feature: inline-screenshot-in-pr, Property 3: Image_URL build and parse round-trip, and distinguish every input dimension
// Feature: inline-screenshot-in-pr, Property 4: parseImageUrl accepts only a URL matching the expected repository context, and rejects adversarial strings
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 9.5**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildImageUrl, parseImageUrl, type ImageUrlParts } from './url.js';

const NUM_RUNS = 100;

const shaArb = fc.stringMatching(/^[0-9a-f]{40}$/);
const prArb = fc.integer({ min: 1, max: 1_000_000 });
const nameArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/);
const serverArb = fc.constantFrom('https://github.com', 'https://ghe.example.com', 'https://git.corp.example:8443');

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const validSegment = (s: string): boolean =>
  s !== '' && s !== '.' && !s.includes('/') && !s.includes('..') && !CONTROL.test(s);

// Unicode-capable segments without lone surrogates; include characters that need percent-encoding.
const segmentArb = fc
  .string({ unit: 'grapheme', minLength: 1, maxLength: 24 })
  .filter(validSegment);

const partsArb: fc.Arbitrary<ImageUrlParts> = fc.record({
  serverUrl: serverArb,
  owner: nameArb,
  repo: nameArb,
  sha: shaArb,
  prNumber: prArb,
  runId: segmentArb,
  file: segmentArb,
});

const ctx = (p: ImageUrlParts) => ({
  serverUrl: p.serverUrl,
  owner: p.owner,
  repo: p.repo,
  prNumber: p.prNumber,
});

describe('Property 3: buildImageUrl / parseImageUrl round-trip', () => {
  it('round-trips and is deterministic', () => {
    fc.assert(
      fc.property(partsArb, (p) => {
        const url = buildImageUrl(p);
        expect(buildImageUrl(p)).toBe(url);
        expect(parseImageUrl(url, ctx(p))).toEqual({ sha: p.sha, runId: p.runId, file: p.file });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('names the commit SHA and the pr path, never the branch name', () => {
    fc.assert(
      fc.property(partsArb, (p) => {
        const url = buildImageUrl(p);
        expect(url.startsWith(`${p.serverUrl}/${p.owner}/${p.repo}/raw/${p.sha}/pr-${p.prNumber}/`)).toBe(true);
        expect(url).not.toContain('ce-evidence');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws for an invalid sha', () => {
    const badSha = fc.oneof(
      fc.string({ maxLength: 60 }).filter((s) => !/^[0-9a-f]{40}$/.test(s)),
      fc.stringMatching(/^[0-9A-F]{40}$/).filter((s) => /[A-F]/.test(s)),
    );
    fc.assert(
      fc.property(partsArb, badSha, (p, sha) => {
        expect(() => buildImageUrl({ ...p, sha })).toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws for a pull request number that is not a positive integer', () => {
    const badPr = fc.oneof(
      fc.integer({ max: 0 }),
      fc.double({ noInteger: true, noNaN: true, min: 0.01, max: 1000 }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY),
    );
    fc.assert(
      fc.property(partsArb, badPr, (p, prNumber) => {
        expect(() => buildImageUrl({ ...p, prNumber })).toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws for an unsafe runId or file segment', () => {
    const badSegment = fc.oneof(
      fc.constant(''),
      fc.tuple(fc.string({ maxLength: 5 }), fc.string({ maxLength: 5 })).map(([a, b]) => `${a}/${b}`),
      fc.tuple(fc.string({ maxLength: 5 }), fc.string({ maxLength: 5 })).map(([a, b]) => `${a}..${b}`),
      fc
        .tuple(fc.string({ maxLength: 5 }), fc.integer({ min: 0, max: 0x1f }), fc.string({ maxLength: 5 }))
        .map(([a, c, b]) => `${a}${String.fromCharCode(c)}${b}`),
    );
    fc.assert(
      fc.property(partsArb, badSegment, fc.boolean(), (p, seg, useRunId) => {
        const bad = useRunId ? { ...p, runId: seg } : { ...p, file: seg };
        expect(() => buildImageUrl(bad)).toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives different URLs when any single dimension differs', () => {
    fc.assert(
      fc.property(partsArb, partsArb, (a, b) => {
        const same =
          a.serverUrl === b.serverUrl &&
          a.owner === b.owner &&
          a.repo === b.repo &&
          a.sha === b.sha &&
          a.prNumber === b.prNumber &&
          a.runId === b.runId &&
          a.file === b.file;
        fc.pre(!same);
        expect(buildImageUrl(a)).not.toBe(buildImageUrl(b));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives different URLs for the same file at different SHAs (Requirement 6.5)', () => {
    fc.assert(
      fc.property(partsArb, shaArb, (p, otherSha) => {
        fc.pre(otherSha !== p.sha);
        expect(buildImageUrl({ ...p, sha: otherSha })).not.toBe(buildImageUrl(p));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('honours a GitHub Enterprise Server host and tolerates a trailing slash', () => {
    const p: ImageUrlParts = {
      serverUrl: 'https://ghe.example.com/',
      owner: 'o',
      repo: 'r',
      sha: 'a'.repeat(40),
      prNumber: 7,
      runId: 'run-2026-11-26T09-47-54-277Z',
      file: 'final.png',
    };
    expect(buildImageUrl(p)).toBe(
      `https://ghe.example.com/o/r/raw/${'a'.repeat(40)}/pr-7/run-2026-11-26T09-47-54-277Z/final.png`,
    );
  });
});

describe('Property 4: parseImageUrl rejects anything but the exact expected URL', () => {
  it('rejects a valid URL parsed against a different owner, repo, server, or PR number', () => {
    fc.assert(
      fc.property(partsArb, partsArb, (p, q) => {
        const url = buildImageUrl(p);
        fc.pre(
          q.owner !== p.owner || q.repo !== p.repo || q.serverUrl !== p.serverUrl || q.prNumber !== p.prNumber,
        );
        expect(parseImageUrl(url, ctx(q))).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('whenever it accepts a string, that string is the canonical built URL', () => {
    const noise = fc.oneof(
      fc.string({ maxLength: 200 }),
      fc.stringMatching(/^[A-Za-z0-9._~%/:-]{0,200}$/),
      partsArb.chain((p) =>
        fc
          .tuple(fc.nat({ max: buildImageUrl(p).length }), fc.string({ maxLength: 6 }))
          .map(([i, ins]) => ({ p, url: buildImageUrl(p).slice(0, i) + ins + buildImageUrl(p).slice(i) })),
      ),
    );
    fc.assert(
      fc.property(partsArb, noise, (base, n) => {
        const url = typeof n === 'string' ? n : n.url;
        const context = typeof n === 'string' ? ctx(base) : ctx(n.p);
        const parsed = parseImageUrl(url, context);
        if (parsed !== undefined) {
          expect(buildImageUrl({ ...context, ...parsed })).toBe(url);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects javascript:, data:, extra segments, other schemes, and disallowed characters', () => {
    fc.assert(
      fc.property(partsArb, fc.string({ minLength: 1, maxLength: 8 }), (p, extra) => {
        const url = buildImageUrl(p);
        const c = ctx(p);
        expect(parseImageUrl(`javascript:${url}`, c)).toBeUndefined();
        expect(parseImageUrl(`data:text/html,${url}`, c)).toBeUndefined();
        expect(parseImageUrl(`${url}/${encodeURIComponent(extra)}`, c)).toBeUndefined();
        expect(parseImageUrl(url.replace(/^https:/, 'http:'), c)).toBeUndefined();
        for (const bad of [' ', '"', '<', '>', '\n', '?', '#', '(', ')', '\\', "'"]) {
          expect(parseImageUrl(`${url}${bad}`, c)).toBeUndefined();
          expect(parseImageUrl(url.replace('/raw/', `/raw/${bad}`), c)).toBeUndefined();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a non-canonical percent encoding and a traversal segment', () => {
    const sha = 'b'.repeat(40);
    const c = { serverUrl: 'https://github.com', owner: 'o', repo: 'r', prNumber: 3 };
    const base = `https://github.com/o/r/raw/${sha}/pr-3`;
    expect(parseImageUrl(`${base}/run-1/final.png`, c)).toEqual({ sha, runId: 'run-1', file: 'final.png' });
    expect(parseImageUrl(`${base}/run%2D1/final.png`, c)).toBeUndefined(); // lowercase-safe char encoded
    expect(parseImageUrl(`${base}/%2e%2e/final.png`, c)).toBeUndefined();
    expect(parseImageUrl(`${base}/run-1/%2F.png`, c)).toBeUndefined();
    expect(parseImageUrl(`${base}/run-1/%00.png`, c)).toBeUndefined();
    expect(parseImageUrl(`${base}/run-1/%E0%A4%A.png`, c)).toBeUndefined(); // malformed escape
    expect(parseImageUrl(`https://github.com/o/r/raw/${'B'.repeat(40)}/pr-3/run-1/final.png`, c)).toBeUndefined();
    expect(parseImageUrl(`${base.replace('pr-3', 'pr-03')}/run-1/final.png`, c)).toBeUndefined();
  });
});
