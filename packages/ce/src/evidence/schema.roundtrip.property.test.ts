import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { RunRecordSchema } from './schema.js';
import { runRecordArb } from './arbitraries.js';

describe('Run_Schema round trip', () => {
  // Feature: evidence-bundle, Property 4: Round-trip through the Run_Schema is lossless
  // **Validates: Requirements 3.8**
  it('Feature: evidence-bundle, Property 4: Round-trip through the Run_Schema is lossless', () => {
    fc.assert(
      fc.property(runRecordArb, (r) => {
        const first = RunRecordSchema.parse(r);
        const again = RunRecordSchema.parse(JSON.parse(JSON.stringify(first)));
        expect(again).toEqual(r);
      }),
      { numRuns: 200 },
    );
  });
});
