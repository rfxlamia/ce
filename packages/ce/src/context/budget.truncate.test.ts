import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { estimateTokens, fitCheckResults, truncateToTokens } from './budget.js';

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

// Text pieces: astral characters (surrogate pairs), BMP characters, and newlines.
const piece = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('😀', '𝒳', '\u{1F600}', '𠮷') },
  { weight: 4, arbitrary: fc.constantFrom('a', 'b', 'é', '中', ' ') },
  { weight: 1, arbitrary: fc.constant('\n') },
);
const textArb = fc.array(piece, { minLength: 0, maxLength: 80 }).map((p) => p.join(''));

describe('Feature: ce-context-resolver, Property 9: Truncation never splits a UTF-16 surrogate pair', () => {
  // **Validates: Requirements 7.16**
  it('never ends in a high surrogate whose low surrogate was cut off', () => {
    fc.assert(
      fc.property(textArb, fc.integer({ min: -2, max: 30 }), (text, maxTokens) => {
        const out = truncateToTokens(text, maxTokens);
        expect(text.startsWith(out.text)).toBe(true);
        if (out.text.length > 0) {
          expect(isHigh(out.text.charCodeAt(out.text.length - 1))).toBe(false);
        }
        if (out.text.length < text.length) {
          // A cut was made: the next code unit must not be an orphaned low surrogate.
          const next = text.charCodeAt(out.text.length);
          const prev = out.text.length > 0 ? out.text.charCodeAt(out.text.length - 1) : 0;
          expect(isLow(next) && isHigh(prev)).toBe(false);
        }
        expect(out.truncated).toBe(estimateTokens(text) > maxTokens);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps pairs whole when the cut point falls between them (example)', () => {
    // 3 tokens = 9 code units; the pair occupies indexes 8 and 9.
    const text = 'abcdefgh😀tail';
    const out = truncateToTokens(text, 3);
    expect(out.text).toBe('abcdefgh');
    expect(out.truncated).toBe(true);
  });
});

type Status = 'passed' | 'failed' | 'skipped';
const checkArb = fc.record({
  name: fc.string({ minLength: 0, maxLength: 12 }),
  status: fc.constantFrom<Status>('passed', 'failed', 'skipped'),
});

describe('Feature: ce-context-resolver, Property 10: Check_Result capping keeps failed results first', () => {
  // **Validates: Requirements 7.14, 7.15, 11.16**
  it('keeps failed before skipped before passed, preserves order, counts dropped', () => {
    fc.assert(
      fc.property(
        fc.array(checkArb, { minLength: 201, maxLength: 260 }),
        fc.integer({ min: 0, max: 200 }),
        (raw, maxTokens) => {
          const checks = raw.map((c, i) => ({ ...c, idx: i }));
          const { kept, droppedCount } = fitCheckResults(checks, maxTokens);

          expect(droppedCount).toBe(checks.length - kept.length);
          expect(kept.reduce((s, c) => s + estimateTokens(c.name), 0)).toBeLessThanOrEqual(maxTokens);

          // Original relative order preserved.
          for (let i = 1; i < kept.length; i++) {
            expect(kept[i]!.idx).toBeGreaterThan(kept[i - 1]!.idx);
          }

          // Priority: if any result of a status is dropped, no lower-priority one is kept.
          const keptIdx = new Set(kept.map((c) => c.idx));
          const rank = (s: Status): number => (s === 'failed' ? 0 : s === 'skipped' ? 1 : 2);
          const dropped = checks.filter((c) => !keptIdx.has(c.idx));
          if (dropped.length > 0 && kept.length > 0) {
            const worstKept = Math.max(...kept.map((k) => rank(k.status)));
            const bestDropped = Math.min(...dropped.map((d) => rank(d.status)));
            expect(worstKept).toBeLessThanOrEqual(bestDropped);
          }

          // Every failed result is kept whenever all failed results fit together.
          const failed = checks.filter((c) => c.status === 'failed');
          const failedCost = failed.reduce((s, c) => s + estimateTokens(c.name), 0);
          if (failedCost <= maxTokens) {
            for (const f of failed) expect(keptIdx.has(f.idx)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
