// Feature: github-action-pr-comment, Property 11: Run_Dir selection picks the one new entry, or the newest of several, or none
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 15.5**
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickNewRunDir } from './run-dir.js';

const NUM_RUNS = 100;

const nameArb = fc.stringMatching(/^[a-z0-9]{1,6}$/);

/** before names, added names (disjoint from before), and distinct mtimes per added name. */
const scenarioArb = fc
  .tuple(
    fc.uniqueArray(nameArb, { maxLength: 5 }),
    fc.uniqueArray(nameArb, { maxLength: 5 }),
  )
  .chain(([stale, candidates]) => {
    const added = candidates.filter((n) => !stale.includes(n));
    return fc.record({
      before: fc.constant(stale),
      added: fc.constant(added),
      // Distinct whole-second offsets so mtime ordering is unambiguous.
      times: fc.shuffledSubarray(
        Array.from({ length: 50 }, (_, i) => i + 1),
        { minLength: added.length, maxLength: added.length },
      ),
      // Whether `after` also repeats a stale name (collision with a pre-existing entry).
      keepStale: fc.boolean(),
    });
  });

describe('Property 11: Run_Dir selection', () => {
  let root: string;
  let counter = 0;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ce-run-dir-prop-'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns none, the one new entry, or the newest of several', () => {
    fc.assert(
      fc.property(scenarioArb, ({ before, added, times, keepStale }) => {
        const dir = join(root, `case-${counter++}`);
        mkdirSync(dir);
        const base = 1_700_000_000;
        for (const name of before) {
          mkdirSync(join(dir, name));
          // Stale entries are the newest on disk; they must still never be picked.
          utimesSync(join(dir, name), base + 1000, base + 1000);
        }
        added.forEach((name, i) => {
          mkdirSync(join(dir, name));
          utimesSync(join(dir, name), base + times[i]!, base + times[i]!);
        });
        const after = [...(keepStale ? before : []), ...added];

        const picked = pickNewRunDir(dir, before, after);

        if (added.length === 0) {
          expect(picked).toBeUndefined();
        } else if (added.length === 1) {
          expect(picked).toBe(join(dir, added[0]!));
        } else {
          let newest = 0;
          times.forEach((t, i) => {
            if (t > times[newest]!) newest = i;
          });
          expect(picked).toBe(join(dir, added[newest]!));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
