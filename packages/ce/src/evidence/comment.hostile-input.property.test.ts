// Feature: github-action-pr-comment, Property 2: Hostile Claim text cannot forge a marker,
// a mention, an issue link, or a second active HTML/Markdown construct.
// **Validates: Requirements 8.2, 10.1, 10.2, 10.3, 10.4, 10.7**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMENT_MARKER, renderPrComment } from './comment.js';
import { hostileCommentInputArb } from './comment.arbitraries.js';

/** Reduce one rendered claim line to what GitHub would treat as active syntax. */
function activeSyntax(line: string): string {
  return line
    .replace(/\\[\s\S]/g, ' ') // backslash-escaped characters (including \`) are inert
    .replace(/`[^`]*`/g, ' ') // the renderer's own code spans for mentions and #refs
    .replace(/\[REDACTED\]/g, ' ') // the renderer's own redaction placeholder
    .replace(/&(?:amp|lt|gt);/g, ' '); // entities the renderer itself produced
}

describe('Property 2: hostile Claim text is inert', () => {
  it('keeps one marker and no active mention, issue link, link, HTML or comment', () => {
    fc.assert(
      fc.property(hostileCommentInputArb, (input) => {
        const body = renderPrComment(input);

        // Exactly one marker, the renderer's own, on the first line (8.2, 10.3).
        expect(body.startsWith(`${COMMENT_MARKER}\n`)).toBe(true);
        expect(body.split(COMMENT_MARKER).length - 1).toBe(1);
        const rest = body.slice(COMMENT_MARKER.length);
        expect(rest).not.toContain('<!--');
        expect(rest).not.toContain('<');

        // Every claim line is free of active syntax (10.1, 10.2, 10.4).
        const claimLines = body.split('\n').filter((l) => l.startsWith('- '));
        expect(claimLines.length).toBeGreaterThan(0);
        for (const line of claimLines) {
          // Drop the renderer's own trailing label, which is not claim text.
          const active = activeSyntax(line.slice(2).replace(/ \(signal: \d\.\d\d\)$/, ''));
          expect(active).not.toMatch(/@\w/);
          expect(active).not.toMatch(/#/);
          expect(active).not.toMatch(/[<>[\]()!`*_|~]/);
          expect(active).not.toMatch(/(?:https?|ftp):\/\//i);
          expect(active).not.toMatch(/www\./i);
        }

        // Claim text never opens a second line (no injected heading, fence or list).
        for (const line of body.split('\n')) {
          expect(line).not.toMatch(/^\s*(?:#|```|>)/);
        }
      }),
      { numRuns: 200 },
    );
  });
});
