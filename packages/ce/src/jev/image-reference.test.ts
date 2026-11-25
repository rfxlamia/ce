import { describe, expect, it } from 'vitest';
import type { TextWithAssets } from '@typesafe-ai/sdk';
import { finalImageQuestions } from './catalog.js';

// Requirements 10.9, 19.17. Uses the real SDK `image` helper through the catalog; no SDK stub.
describe('image reference format', () => {
  it('matches ^<image:[0-9a-f]{32}>$ exactly', () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 9, 8, 7);
    const state = finalImageQuestions('claim', png).state as TextWithAssets;
    expect(state.assets).toHaveLength(1);
    const reference = String(state.assets[0]);
    expect(reference).toMatch(/^<image:[0-9a-f]{32}>$/);
    expect(state.text).toContain(reference);
  });
});
