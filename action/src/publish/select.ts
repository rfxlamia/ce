// Image selection and published-name assignment (Requirement 4).
// Pure functions: a Run_Record and a directory listing in, a list out. No I/O,
// no logging. The caller turns `dropped` into warnings (Requirement 4.7).

import type { RunRecord } from 'continuous-evidence';
import { isAbsolute } from 'node:path';

export interface SelectedImage {
  /** Bundle-relative path, exactly as it appeared in the Run_Record. */
  relativePath: string;
  /** The final screenshot, or the Step's zero-based index in `record.steps`. */
  origin: { kind: 'final' } | { kind: 'step'; index: number };
}

export interface DirectoryEntry {
  /** Bundle-relative path of the entry inside the Run_Dir. */
  relativePath: string;
  /** True only for a regular file after symbolic links were resolved. */
  isFile: boolean;
  sizeBytes: number;
}

/** A candidate that was rejected because its path is not a Bundle_Relative_Path. */
export interface DroppedImage {
  /** Identifies the candidate by origin only. Never carries the path text. */
  origin: SelectedImage['origin'];
}

export interface Selection {
  selected: SelectedImage[];
  /** Candidates dropped for an unsafe path (absolute, `..`, NUL, drive letter). */
  dropped: DroppedImage[];
}

/** True for a relative path that stays inside the bundle (Bundle_Relative_Path). */
function isBundleRelativePath(path: string): boolean {
  if (path === '' || path.includes('\0')) return false;
  if (isAbsolute(path) || path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).some((segment) => segment === '..');
}

/**
 * Selects the images to publish (Requirement 4.1 to 4.5, 4.7, 4.8): the final
 * screenshot first, then the screenshot of every executed Step in Step order.
 * Duplicates keep their first occurrence. Only existing regular `.png` files
 * with a Bundle_Relative_Path are kept. `undefined` record gives nothing.
 */
export function selectImagesDetailed(
  record: RunRecord | undefined,
  listing: readonly DirectoryEntry[],
): Selection {
  if (record === undefined) return { selected: [], dropped: [] };

  const byPath = new Map<string, DirectoryEntry>();
  for (const entry of listing) byPath.set(entry.relativePath, entry);

  const candidates: SelectedImage[] = [];
  const finalPath = record.finalImage?.screenshot ?? null;
  if (finalPath !== null) candidates.push({ relativePath: finalPath, origin: { kind: 'final' } });
  record.steps.forEach((step, index) => {
    if (step.executed) candidates.push({ relativePath: step.screenshot, origin: { kind: 'step', index } });
  });

  const seen = new Set<string>();
  const selected: SelectedImage[] = [];
  const dropped: DroppedImage[] = [];
  for (const candidate of candidates) {
    const path = candidate.relativePath;
    if (!isBundleRelativePath(path)) {
      dropped.push({ origin: candidate.origin });
      continue;
    }
    if (seen.has(path)) continue;
    const entry = byPath.get(path);
    if (entry === undefined || !entry.isFile || !/\.png$/i.test(path)) continue;
    seen.add(path);
    selected.push(candidate);
  }
  return { selected, dropped };
}

/** The selected images only. See `selectImagesDetailed` for dropped candidates. */
export function selectImages(
  record: RunRecord | undefined,
  listing: readonly DirectoryEntry[],
): SelectedImage[] {
  return selectImagesDetailed(record, listing).selected;
}

/** Base name of a Bundle_Relative_Path (the part after the last separator). */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Assigns the file name each image gets on the Evidence_Path (Requirement 4.9).
 * Result is parallel to `images`, and every name is unique.
 *
 * The names are already unique in practice because `runtime/loop.ts` writes
 * `step-N.png` and `step-N-final.png`. The prefix rule below is a safeguard:
 * the later image of a same-base-name pair gets its zero-based position and a
 * hyphen in front.
 */
export function assignPublishedNames<T extends { relativePath: string }>(
  images: readonly T[],
): Array<T & { publishedName: string }> {
  const used = new Set<string>();
  return images.map((image, position) => {
    let name = baseName(image.relativePath);
    // Safeguard: see the comment above. Repeats only if a prefixed name collides too.
    while (used.has(name)) name = `${position}-${name}`;
    used.add(name);
    return { ...image, publishedName: name };
  });
}
