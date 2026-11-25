import { describe, expect, it } from 'vitest';
import { computeCatalogDigests, readSnapshot } from '../scripts/update-catalog-snapshot.js';

// Requirements 9.10, 9.12, 19.16
describe('catalog snapshot', () => {
  const stored = readSnapshot();
  const computed = computeCatalogDigests();

  it('has a snapshot key for every id@version of the catalog', () => {
    const missing = Object.keys(computed).filter((key) => !(key in stored));
    expect(
      missing,
      `Catalog entries without a snapshot key: ${missing.join(', ')}. Run npm run update:catalog-snapshot.`,
    ).toEqual([]);
  });

  it('matches the stored digest of every built question', () => {
    for (const [key, digest] of Object.entries(computed)) {
      if (!(key in stored)) continue;
      expect(
        digest,
        `Catalog entry ${key} changed but its version was not incremented. ` +
          'The version must be incremented when the question text changes.',
      ).toBe(stored[key]);
    }
  });
});
