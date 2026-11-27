import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildProbeUrl, classifyStatus, probeTimeoutMs, redactUrl } from './target.js';

const segmentArb = fc.stringMatching(/^[a-z0-9]{1,6}$/);
const segmentsArb = fc.array(segmentArb, { minLength: 0, maxLength: 4 });
const originArb = fc.constantFrom('http://h', 'https://example.test', 'http://127.0.0.1:3000');
const queryArb = fc.option(fc.stringMatching(/^[a-z0-9=&]{1,8}$/), { nil: undefined });
const fragmentArb = fc.option(fc.stringMatching(/^[a-z0-9]{1,8}$/), { nil: undefined });

describe('buildProbeUrl properties', () => {
  // Feature: runtime-target, Property 4: `buildProbeUrl` is slash-insensitive and keeps the base path as a prefix
  // **Validates: Requirements 3.2, 8.5**
  it('Property 4: is slash-insensitive, keeps the base path as a prefix, and drops query and fragment', () => {
    fc.assert(
      fc.property(
        originArb,
        segmentsArb,
        segmentsArb,
        queryArb,
        fragmentArb,
        (origin, baseSegs, readySegs, query, fragment) => {
          const basePath = baseSegs.length > 0 ? `/${baseSegs.join('/')}` : '';
          const readyPath = readySegs.join('/');
          const suffix = `${query === undefined ? '' : `?${query}`}${fragment === undefined ? '' : `#${fragment}`}`;

          const results = [false, true].flatMap((trailingBaseSlash) =>
            [false, true].map((leadingReadySlash) => {
              const base = `${origin}${basePath}${trailingBaseSlash || basePath === '' ? '/' : ''}${suffix}`;
              const ready = `${leadingReadySlash ? '/' : ''}${readyPath}`;
              return buildProbeUrl(base, ready);
            }),
          );

          // Same logical path, same probe URL for all four slash combinations.
          expect(new Set(results).size).toBe(1);

          const parsed = new URL(results[0]!);
          const expectedPath = `${basePath}/${readyPath}`;
          // Base path kept as prefix, followed directly by the normalized ready path.
          expect(parsed.pathname).toBe(expectedPath);
          expect(parsed.pathname.startsWith(`${basePath}/`)).toBe(true);
          // No query or fragment carried over from base.
          expect(parsed.search).toBe('');
          expect(parsed.hash).toBe('');
          expect(results[0]).not.toContain('?');
          expect(results[0]).not.toContain('#');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('classifyStatus properties', () => {
  // Feature: runtime-target, Property 5: `classifyStatus` is ready exactly for 200–399
  // **Validates: Requirements 3.3, 3.5, 8.6**
  it('Property 5: returns ready if and only if 200 <= status <= 399, for all integers 100-599', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 599 }), (status) => {
        expect(classifyStatus(status)).toBe(status >= 200 && status <= 399 ? 'ready' : 'not-ready');
      }),
      { numRuns: 100 },
    );
  });
});

describe('probeTimeoutMs properties', () => {
  // Feature: runtime-target, Property 6: Per-probe timeout is the minimum of 2000 ms and the remaining Ready_Timeout
  // **Validates: Requirements 3.6**
  it('Property 6: equals min(2000, remainingMs) for any non-negative remainingMs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (remainingMs) => {
        expect(probeTimeoutMs(remainingMs)).toBe(Math.min(2000, remainingMs));
      }),
      { numRuns: 100 },
    );
  });
});

describe('redactUrl properties', () => {
  // Uppercase-leading credentials cannot collide with the lowercase hosts and paths generated below.
  const credArb = fc.stringMatching(/^[A-Z][A-Za-z0-9]{7,10}$/);
  const pathArb = segmentsArb.map((segs) => (segs.length > 0 ? `/${segs.join('/')}` : ''));
  const schemeArb = fc.constantFrom('http', 'https');
  const hostArb = fc.constantFrom('h', 'example.test', '127.0.0.1:3000');

  // Feature: runtime-target, Property 7: `redactUrl` removes userinfo and is a no-op without it
  // **Validates: Requirements 4.7, 8.7**
  it('Property 7: removes username and password, replaces them with ***, and is a no-op without userinfo', () => {
    fc.assert(
      fc.property(
        schemeArb,
        hostArb,
        pathArb,
        credArb,
        credArb,
        fc.boolean(),
        (scheme, host, path, user, pass, withPassword) => {
          const userinfo = withPassword ? `${user}:${pass}` : user;
          const redacted = redactUrl(`${scheme}://${userinfo}@${host}${path}`);
          expect(redacted).not.toContain(user);
          if (withPassword) expect(redacted).not.toContain(pass);
          expect(redacted).toContain('***');
          expect(new URL(redacted).username).toBe('***');
          expect(new URL(redacted).host).toBe(new URL(`${scheme}://${host}`).host);

          const plain = `${scheme}://${host}${path}`;
          expect(redactUrl(plain)).toBe(plain);
        },
      ),
      { numRuns: 100 },
    );
  });
});
