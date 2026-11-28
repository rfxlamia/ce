/**
 * The one declared palette of report.html. `document.ts` renders it as the `:root`
 * custom-property block, and `report.palette.test.ts` reads the same object to check
 * WCAG contrast (4.5:1 for text, 3:1 for non-text UI). Dark theme only.
 */
export const PALETTE = {
  bg: '#0d1117',
  surface: '#161b22',
  surface2: '#1c232d',
  border: '#3d4654',
  text: '#e6edf3',
  muted: '#a6b0bd',
  link: '#79b8ff',
  focus: '#ffd33d',
  outcomeTones: {
    SKIPPED: '#58a6ff',
    EVIDENCED: '#3fb950',
    UNSUPPORTED: '#e3b341',
    ERROR: '#ff7b72',
  },
  bar: '#79b8ff',
  barTrack: '#2a323d',
  box: '#ff9bce',
  /** Declared dominant color of the committed Logo_Asset. */
  logoDominant: '#7490b8',
} as const;

export type Palette = typeof PALETTE;

/**
 * Blend `fg` over `bg` in sRGB: `pct` percent `fg`, the rest `bg`. Same result as CSS
 * `color-mix(in srgb, fg pct%, bg)`. Shared by `document.ts` (emitting Banner colors)
 * and `report.palette.test.ts` (checking their contrast). Returns `#rrggbb`.
 */
export function blendSrgb(fg: string, bg: string, pct: number): string {
  const parse = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(fg);
  const b = parse(bg);
  const w = pct / 100;
  return (
    '#' +
    a
      .map((c, i) =>
        Math.round(c * w + (b[i] as number) * (1 - w))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Banner tint recipe, as in the approved mockup. */
export const BANNER_MIX = {
  backgroundTonePct: 13,
  borderTonePct: 55,
  mutedTonePct: 28,
  mutedBase: '#d4dbe3',
} as const;

/** Resolved Banner colors for one Outcome tone. */
export function bannerColors(tone: string, p: Palette = PALETTE) {
  return {
    background: blendSrgb(tone, p.surface, BANNER_MIX.backgroundTonePct),
    border: blendSrgb(tone, p.border, BANNER_MIX.borderTonePct),
    onToneMuted: blendSrgb(tone, BANNER_MIX.mutedBase, BANNER_MIX.mutedTonePct),
  };
}
