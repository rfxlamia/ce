// Feature: inline-screenshot-in-pr, Property 1: Selected_Images is ordered, deduplicated, and filtered to real, path-safe PNGs
// Feature: inline-screenshot-in-pr, Property 12: Published file names are always unique, and collision-free names are left unchanged
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 4.9**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { RunRecord } from 'continuous-evidence';
import {
  assignPublishedNames,
  selectImages,
  selectImagesDetailed,
  type DirectoryEntry,
} from './select.js';

const NUM_RUNS = 100;

interface FakeStep {
  screenshot: string;
  executed: boolean;
}

function record(finalPath: string | null, steps: FakeStep[]): RunRecord {
  return {
    outcome: 'EVIDENCED',
    steps,
    finalImage: finalPath === null ? null : { screenshot: finalPath },
  } as unknown as RunRecord;
}

function entry(relativePath: string, isFile = true, sizeBytes = 10): DirectoryEntry {
  return { relativePath, isFile, sizeBytes };
}

function isSafe(path: string): boolean {
  return (
    path !== '' &&
    !path.includes('\0') &&
    !path.startsWith('/') &&
    !path.startsWith('\\') &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split(/[\\/]/).some((s) => s === '..')
  );
}

// Small pool so duplicates, missing files, non-PNGs and escapes all occur often.
const pathArb = fc.constantFrom(
  'step-0.png',
  'step-1.png',
  'step-2.png',
  'step-2-final.png',
  'shots/a.png',
  'UPPER.PNG',
  'notes.txt',
  'a.png.txt',
  'dir.png',
  '../escape.png',
  'shots/../../escape.png',
  '/abs/evil.png',
  'C:\\evil.png',
  'missing.png',
);

const listingArb = fc.array(
  fc.record({ relativePath: pathArb, isFile: fc.boolean(), sizeBytes: fc.nat(1000) }),
  { maxLength: 14 },
);

const stepArb = fc.record({ screenshot: pathArb, executed: fc.boolean() });
const recordArb = fc.option(
  fc.record({ finalPath: fc.option(pathArb, { nil: null }), steps: fc.array(stepArb, { maxLength: 8 }) }),
  { nil: undefined },
);

describe('Property 1: selectImages ordering, dedup and filtering', () => {
  it('returns a deduplicated, ordered list of real, path-safe PNGs', () => {
    fc.assert(
      fc.property(recordArb, listingArb, (spec, listing) => {
        const rec = spec === undefined ? undefined : record(spec.finalPath, spec.steps);
        const result = selectImages(rec, listing);

        if (rec === undefined) {
          expect(result).toEqual([]);
          return;
        }

        const paths = result.map((r) => r.relativePath);
        expect(new Set(paths).size).toBe(paths.length);

        // First element is the final screenshot when present; the rest are steps in ascending index order.
        result.forEach((r, i) => {
          if (r.origin.kind === 'final') expect(i).toBe(0);
        });
        const stepIndexes = result.flatMap((r) => (r.origin.kind === 'step' ? [r.origin.index] : []));
        expect([...stepIndexes].sort((a, b) => a - b)).toEqual(stepIndexes);
        expect(new Set(stepIndexes).size).toBe(stepIndexes.length);

        // Every kept path is safe, a PNG, and a regular file in the listing.
        // A later listing entry with the same path overrides an earlier one.
        const byPath = new Map<string, DirectoryEntry>(listing.map((e) => [e.relativePath, e]));
        for (const p of paths) {
          expect(isSafe(p)).toBe(true);
          expect(/\.png$/i.test(p)).toBe(true);
          expect(byPath.get(p)?.isFile).toBe(true);
        }

        // Nothing valid is lost: every valid candidate path appears.
        const candidates = [
          ...(spec?.finalPath != null ? [spec.finalPath] : []),
          ...spec!.steps.filter((s) => s.executed).map((s) => s.screenshot),
        ];
        const expected = new Set(
          candidates.filter((p) => isSafe(p) && /\.png$/i.test(p) && byPath.get(p)?.isFile === true),
        );
        expect(new Set(paths)).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 12: assignPublishedNames uniqueness', () => {
  const dirArb = fc.constantFrom('', 'a/', 'b/', 'a/b/');
  const baseArb = fc.constantFrom('step-3.png', 'step-4.png', 'final.png', 'x.png');
  const imagesArb = fc.array(
    fc.record({ dir: dirArb, base: baseArb }).map((p) => ({ relativePath: `${p.dir}${p.base}`, base: p.base })),
    { maxLength: 12 },
  );

  it('gives every image a unique name and leaves non-colliding names unchanged', () => {
    fc.assert(
      fc.property(imagesArb, (images) => {
        const result = assignPublishedNames(images);
        expect(result).toHaveLength(images.length);
        const names = result.map((r) => r.publishedName);
        expect(new Set(names).size).toBe(names.length);

        result.forEach((r, i) => {
          const earlierBases = images.slice(0, i).map((x) => x.base);
          if (!earlierBases.includes(images[i]!.base)) {
            expect(r.publishedName).toBe(images[i]!.base);
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('selectImages examples', () => {
  const listing = [
    entry('step-0.png'),
    entry('step-1.png'),
    entry('final.png'),
    entry('log.txt'),
    entry('folder.png', false),
  ];

  it('puts the final screenshot first, then executed steps in order', () => {
    const rec = record('final.png', [
      { screenshot: 'step-0.png', executed: true },
      { screenshot: 'step-1.png', executed: true },
    ]);
    expect(selectImages(rec, listing).map((s) => s.relativePath)).toEqual([
      'final.png',
      'step-0.png',
      'step-1.png',
    ]);
  });

  it('skips steps that were not executed', () => {
    const rec = record(null, [
      { screenshot: 'step-0.png', executed: false },
      { screenshot: 'step-1.png', executed: true },
    ]);
    expect(selectImages(rec, listing)).toEqual([
      { relativePath: 'step-1.png', origin: { kind: 'step', index: 1 } },
    ]);
  });

  it('keeps the first occurrence of a duplicate path', () => {
    const rec = record('step-0.png', [{ screenshot: 'step-0.png', executed: true }]);
    expect(selectImages(rec, listing)).toEqual([
      { relativePath: 'step-0.png', origin: { kind: 'final' } },
    ]);
  });

  it('drops non-PNG files, directory entries, and files missing from the listing', () => {
    const rec = record(null, [
      { screenshot: 'log.txt', executed: true },
      { screenshot: 'folder.png', executed: true },
      { screenshot: 'missing.png', executed: true },
    ]);
    expect(selectImages(rec, listing)).toEqual([]);
  });

  it('accepts an uppercase .PNG extension', () => {
    const rec = record('SHOT.PNG', []);
    expect(selectImages(rec, [entry('SHOT.PNG')])).toHaveLength(1);
  });

  it('drops a path outside the Run_Dir and reports its origin without the path text', () => {
    const rec = record(null, [
      { screenshot: 'step-0.png', executed: true },
      { screenshot: '../escape.png', executed: true },
    ]);
    const result = selectImagesDetailed(rec, [entry('step-0.png'), entry('../escape.png')]);
    expect(result.selected.map((s) => s.relativePath)).toEqual(['step-0.png']);
    expect(result.dropped).toEqual([{ origin: { kind: 'step', index: 1 } }]);
    expect(JSON.stringify(result.dropped)).not.toContain('escape');
  });

  it('returns [] for an unavailable record and for zero images', () => {
    expect(selectImages(undefined, listing)).toEqual([]);
    expect(selectImages(record(null, []), listing)).toEqual([]);
  });
});

describe('assignPublishedNames examples', () => {
  it('uses base names unchanged when they are unique', () => {
    const out = assignPublishedNames([{ relativePath: 'a/step-0.png' }, { relativePath: 'step-1.png' }]);
    expect(out.map((o) => o.publishedName)).toEqual(['step-0.png', 'step-1.png']);
  });

  it('prefixes the later image of a same-base-name pair with its position and a hyphen', () => {
    const out = assignPublishedNames([{ relativePath: 'a/x.png' }, { relativePath: 'b/x.png' }]);
    expect(out.map((o) => o.publishedName)).toEqual(['x.png', '1-x.png']);
  });
});
