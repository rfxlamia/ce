import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildArtifactName, sanitizeArtifactNamePart } from './artifact.js';

// Feature: github-action-pr-comment, Property 10: Artifact name sanitizing is total and position-preserving
// **Validates: Requirements 7.2, 15.7**

const FORBIDDEN = ['"', ':', '<', '>', '|', '*', '?', '\\', '/', '\r', '\n'];
const hasForbidden = (s: string): boolean => FORBIDDEN.some((c) => s.includes(c));

// Mix arbitrary text with the forbidden characters so every one of them is exercised often.
const part = fc
  .array(
    fc.oneof(fc.constantFrom(...FORBIDDEN), fc.string({ maxLength: 3 })),
    { maxLength: 12 },
  )
  .map((xs) => xs.join(''));

describe('Property 10: artifact name sanitizing', () => {
  it('sanitizeArtifactNamePart removes forbidden characters and keeps length', () => {
    fc.assert(
      fc.property(part, (s) => {
        const out = sanitizeArtifactNamePart(s);
        expect(hasForbidden(out)).toBe(false);
        expect(out.length).toBe(s.length);
      }),
      { numRuns: 200 },
    );
  });

  it('sanitizeArtifactNamePart only changes forbidden positions', () => {
    fc.assert(
      fc.property(part, (s) => {
        const out = sanitizeArtifactNamePart(s);
        for (let i = 0; i < s.length; i++) {
          const c = s[i] as string;
          expect(out[i]).toBe(FORBIDDEN.includes(c) ? '-' : c);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('buildArtifactName (generated) is clean and keeps every part at its position', () => {
    fc.assert(
      fc.property(part, part, part, part, (runId, runAttempt, job, runDirName) => {
        const name = buildArtifactName({
          explicitName: '',
          runId,
          runAttempt,
          job,
          runDirName,
        });
        expect(hasForbidden(name)).toBe(false);
        const parts = [runId, runAttempt, job, runDirName];
        expect(name.length).toBe(
          'ce-evidence'.length + parts.reduce((n, p) => n + 1 + p.length, 0),
        );
        expect(name).toBe(
          ['ce-evidence', ...parts.map(sanitizeArtifactNamePart)].join('-'),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('buildArtifactName (explicit) is the sanitized explicit name', () => {
    fc.assert(
      fc.property(
        part.filter((s) => s !== ''),
        part,
        (explicitName, other) => {
          const name = buildArtifactName({
            explicitName,
            runId: other,
            runAttempt: other,
            job: other,
            runDirName: other,
          });
          expect(hasForbidden(name)).toBe(false);
          expect(name).toBe(sanitizeArtifactNamePart(explicitName));
          expect(name.length).toBe(explicitName.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
