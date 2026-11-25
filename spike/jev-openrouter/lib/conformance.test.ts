import { describe, expect, it } from 'vitest';
import { diffAnswer } from './conformance.js';

describe('diffAnswer', () => {
  it('returns no entries for a conformant choice answer', () => {
    const answer = { type: 'choice', choice: 'a', confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } };
    expect(diffAnswer('choice', answer)).toEqual([]);
  });

  it('names a missing field with observedValue undefined', () => {
    const answer = { type: 'choice', choice: 'a', probabilities: { a: 1 } };
    const entries = diffAnswer('choice', answer);
    expect(entries).toEqual([{ field: 'confidence', expectedType: 'number', observedValue: undefined }]);
  });

  it('names a wrong-typed field with its observed value', () => {
    const answer = { type: 'noul', noul: 'high' };
    const entries = diffAnswer('noul', answer);
    expect(entries).toEqual([{ field: 'noul', expectedType: 'number', observedValue: 'high' }]);
  });
});
