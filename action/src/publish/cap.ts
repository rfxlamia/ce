/**
 * Image_Cap and Image_Byte_Cap (Requirement 8).
 *
 * Structural minimum of a selected image; `SelectedImage` from `select.ts`
 * plus a size satisfies it, and extra fields pass through untouched.
 */
export interface CappableImage {
  origin: { kind: 'final' } | { kind: 'step'; index: number };
  sizeBytes: number;
}

export interface CapResult<T extends CappableImage> {
  kept: T[];
  skippedCount: number;
}

/**
 * Drops images larger than `byteCapBytes` first (they use no Image_Cap slot),
 * then keeps the final screenshot (when present) plus the last steps so the
 * total is at most `imageCap`. Output keeps the input order, which is the
 * Requirement 4.1 order (final first, then steps in order).
 * `skippedCount` is the number of input images not kept.
 */
export function applyCaps<T extends CappableImage>(
  images: readonly T[],
  imageCap: number,
  byteCapBytes: number,
): CapResult<T> {
  const withinBytes = images.filter((image) => image.sizeBytes <= byteCapBytes);
  const finals = withinBytes.filter((image) => image.origin.kind === 'final');
  const steps = withinBytes.filter((image) => image.origin.kind === 'step');

  const cap = Math.max(0, Math.floor(imageCap));
  const keptFinals = finals.slice(0, cap);
  const stepSlots = cap - keptFinals.length;
  const keptSteps = stepSlots > 0 ? steps.slice(-stepSlots) : [];

  const keptSet = new Set<T>([...keptFinals, ...keptSteps]);
  const kept = images.filter((image) => keptSet.has(image));
  return { kept, skippedCount: images.length - kept.length };
}
