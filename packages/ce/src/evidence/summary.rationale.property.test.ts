// Feature: evidence-bundle, Property 27: Rationale line matches the outcome's required content
// **Validates: Requirements 8.6, 8.7, 8.8, 8.9, 8.10**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  errorRunRecordArb,
  evidencedRunRecordArb,
  runRecordArb,
  skippedRunRecordArb,
  unsupportedRunRecordArb,
} from './arbitraries.js';
import { buildSummary } from './summary.js';
import type { RunRecord } from './schema.js';

type WithAssessment = { assessment: { decidedBy: string; surface: string } };

const rationaleOf = (record: RunRecord): string => {
  const lines = buildSummary({ kind: 'bundle', record, reportPath: 'run.json' }).split('\n');
  return lines[2] ?? '';
};

describe('Property 27: rationale line matches the outcome', () => {
  it('SKIPPED names evidence-not-required and decidedBy', () => {
    fc.assert(
      fc.property(skippedRunRecordArb, (record) => {
        const line = rationaleOf(record);
        expect(line).toContain('not required');
        expect(line).toContain((record as unknown as WithAssessment).assessment.decidedBy);
      }),
      { numRuns: 100 },
    );
  });

  it('UNSUPPORTED states evidence was required and names the surface', () => {
    fc.assert(
      fc.property(unsupportedRunRecordArb, (record) => {
        const line = rationaleOf(record);
        expect(line).toContain('required');
        expect(line).toContain((record as unknown as WithAssessment).assessment.surface);
        expect(line).toContain('no capability');
      }),
      { numRuns: 100 },
    );
  });

  it('EVIDENCED states finalState and the step count', () => {
    fc.assert(
      fc.property(evidencedRunRecordArb, (record) => {
        const line = rationaleOf(record);
        expect(line).toContain(String(record.finalState));
        expect(line).toContain(`${record.steps.length} steps`);
      }),
      { numRuns: 100 },
    );
  });

  it('ERROR states the Failed_Stage and the reason', () => {
    fc.assert(
      fc.property(errorRunRecordArb, (record) => {
        const line = rationaleOf(record);
        expect(line).toContain(record.error.stage);
        expect(line).toContain(record.outcomeReason);
      }),
      { numRuns: 100 },
    );
  });

  it('never uses verified, passed or correct in the rationale line', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        expect(rationaleOf(record)).not.toMatch(/verified|passed|correct/i);
      }),
      { numRuns: 100 },
    );
  });
});
