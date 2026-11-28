import { describe, expect, it } from 'vitest';
import { CATALOG, questionTextFor } from './catalog.js';

// Requirement 5.4
describe('questionTextFor', () => {
  it('resolves every catalog entry to non-empty text', () => {
    for (const e of Object.values(CATALOG)) {
      const text = questionTextFor(e.idVersion);
      expect(text, e.idVersion).toBeTypeOf('string');
      expect(text!.trim().length, e.idVersion).toBeGreaterThan(0);
    }
  });

  it('returns undefined for an unknown or retired idVersion', () => {
    expect(questionTextFor('claim.is_behavior@0')).toBeUndefined();
    expect(questionTextFor('claim.is_behavior@999')).toBeUndefined();
    expect(questionTextFor('retired.question@1')).toBeUndefined();
    expect(questionTextFor('')).toBeUndefined();
  });
});
