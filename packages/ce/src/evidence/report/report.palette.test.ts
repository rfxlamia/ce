import { describe, expect, it } from 'vitest';
import { PALETTE, bannerColors } from './palette.js';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const TONES = Object.entries(PALETTE.outcomeTones);
const BACKGROUNDS = { bg: PALETTE.bg, surface: PALETTE.surface, surface2: PALETTE.surface2 };

describe('report palette contrast', () => {
  it.each(
    (['text', 'muted', 'link'] as const).flatMap((fg) =>
      Object.entries(BACKGROUNDS).map(([name, bg]) => [fg, name, PALETTE[fg], bg] as const),
    ),
  )('text %s on %s is at least 4.5:1', (_fg, _name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('non-text pairs are at least 3:1', () => {
    expect(contrast(PALETTE.bar, PALETTE.barTrack)).toBeGreaterThanOrEqual(3);
    expect(contrast(PALETTE.bar, PALETTE.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(PALETTE.box, PALETTE.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(PALETTE.focus, PALETTE.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(PALETTE.focus, PALETTE.surface)).toBeGreaterThanOrEqual(3);
  });

  it('SKIPPED and UNSUPPORTED hues are at least 30 degrees apart', () => {
    const d = Math.abs(hue(PALETTE.outcomeTones.SKIPPED) - hue(PALETTE.outcomeTones.UNSUPPORTED));
    expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(30);
  });

  it('logoDominant vs bg is at least 3:1', () => {
    expect(contrast(PALETTE.logoDominant, PALETTE.bg)).toBeGreaterThanOrEqual(3);
  });

  describe.each(TONES)('tinted Banner for %s', (_name, tone) => {
    const c = bannerColors(tone);
    it('Outcome word, icon and border are at least 3:1 on the tinted background', () => {
      expect(contrast(tone, c.background)).toBeGreaterThanOrEqual(3);
      expect(contrast(c.border, c.background)).toBeGreaterThanOrEqual(3);
    });
    it('explanation, reason, Lead_Facts and Meta_Row text are at least 4.5:1', () => {
      expect(contrast(PALETTE.text, c.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(PALETTE.muted, c.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.onToneMuted, c.background)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
