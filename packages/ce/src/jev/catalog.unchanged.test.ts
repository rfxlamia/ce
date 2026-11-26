import { describe, expect, it } from 'vitest';
import { computeCatalogDigests, readSnapshot } from '../scripts/update-catalog-snapshot.js';

// Requirement 16.10: the claims/assessment entries stay at version 1 and the
// stored snapshot is not regenerated for this feature.
describe('catalog unchanged', () => {
  const stored = readSnapshot();
  const computed = computeCatalogDigests();
  const entries = [
    'claim.is_behavior',
    'assess.runtime_observable',
    'assess.checks_adequate',
    'assess.surface',
  ];

  it.each(entries)('%s is at version 1 and matches the snapshot digest', (id) => {
    const key = `${id}@1`;
    expect(stored[key]).toBeDefined();
    expect(computed[key]).toBe(stored[key]);
    const versions = Object.keys(computed).filter((k) => k.startsWith(`${id}@`));
    expect(versions).toEqual([key]);
  });

  it('has exactly the stored snapshot keys, with identical digests', () => {
    expect(computed).toEqual(stored);
  });
});
