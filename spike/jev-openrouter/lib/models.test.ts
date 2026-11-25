import { describe, expect, it } from 'vitest';
import { aggregateModelIds } from './models.js';

describe('aggregateModelIds', () => {
  it('counts all calls under one id', () => {
    const calls = Array.from({ length: 3 }, () => ({ requestType: 'choice', ok: true, modelReturned: 'm1' }));
    expect(aggregateModelIds(calls)).toEqual({ choice: { m1: 3 } });
  });

  it('splits two distinct ids evenly', () => {
    const calls = [
      { requestType: 'score', ok: true, modelReturned: 'm1' },
      { requestType: 'score', ok: true, modelReturned: 'm2' },
      { requestType: 'score', ok: true, modelReturned: 'm1' },
      { requestType: 'score', ok: true, modelReturned: 'm2' },
    ];
    expect(aggregateModelIds(calls)).toEqual({ score: { m1: 2, m2: 2 } });
  });

  it('ignores failed calls mixed with successes', () => {
    const calls = [
      { requestType: 'noul', ok: true, modelReturned: 'm1' },
      { requestType: 'noul', ok: false, modelReturned: 'm1' },
      { requestType: 'noul', ok: false, modelReturned: null },
      { requestType: 'noul', ok: true, modelReturned: 'm1' },
    ];
    expect(aggregateModelIds(calls)).toEqual({ noul: { m1: 2 } });
  });
});
