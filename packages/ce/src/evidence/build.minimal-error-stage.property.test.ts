// Feature: evidence-bundle, Property 8: Minimal_Bundle error.stage follows the documented mapping
// **Validates: Requirements 5.2, 5.3, 5.4**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Resolution } from '../outcome/types.js';
import { buildRunRecordInputArb } from './arbitraries.js';
import { buildMinimalRunRecord } from './build.js';

const EXPECTED_STAGE = {
  'assessment-missing': 'assessment',
  'no-observation': 'runtime',
  'evidence-incomplete': 'runtime',
} as const;

type MappedReason = keyof typeof EXPECTED_STAGE;

const isMapped = (r: string): r is MappedReason => r in EXPECTED_STAGE;

describe('Feature: evidence-bundle, Property 8: Minimal_Bundle error.stage follows the documented mapping', () => {
  it('uses the Resolution errorStage when present', () => {
    fc.assert(
      fc.property(
        buildRunRecordInputArb,
        fc.constantFrom('config', 'context', 'assessment', 'runtime', 'evidence' as const),
        (input, errorStage) => {
          const resolution: Resolution = { outcome: 'ERROR', reason: 'stage-error', errorStage };
          const record = buildMinimalRunRecord({ ...input, resolution });
          expect(record.error?.stage).toBe(errorStage);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('maps assessment-missing, no-observation and evidence-incomplete without errorStage, with causeName null', () => {
    fc.assert(
      fc.property(
        buildRunRecordInputArb,
        fc.constantFrom<MappedReason>('assessment-missing', 'no-observation', 'evidence-incomplete'),
        (input, reason) => {
          const resolution: Resolution = { outcome: 'ERROR', reason };
          // These reasons carry no StageError, so no cause exists.
          const record = buildMinimalRunRecord({ ...input, resolution, error: null });
          expect(isMapped(reason)).toBe(true);
          expect(record.error?.stage).toBe(EXPECTED_STAGE[reason]);
          expect(record.error?.causeName).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
