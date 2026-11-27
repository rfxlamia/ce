import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { OUTCOMES } from '../outcome/types.js';
import { runRecordArb } from './arbitraries.js';
import type { RunRecord } from './schema.js';
import { buildSummary, type SummaryInput } from './summary.js';

const longText = fc.string({ minLength: 150, maxLength: 400 });
const anyText = fc.oneof(fc.string({ maxLength: 60 }), longText);

/** A record whose claims are replaced by arbitrary texts (the summary reads only `claims[].text`). */
const recordWithClaimsArb = fc
  .tuple(runRecordArb, fc.array(anyText, { maxLength: 4 }))
  .map(([record, texts]): RunRecord => {
    const template = record.claims[0];
    const claims = texts.map((text, i) =>
      template ? { ...template, id: `c${i}`, text } : ({ id: `c${i}`, text, probability: null, provenance: [] } as never),
    );
    return { ...record, claims } as RunRecord;
  });

const bundleInputArb: fc.Arbitrary<SummaryInput> = fc
  .tuple(recordWithClaimsArb, fc.string({ minLength: 1, maxLength: 300 }))
  .map(([record, reportPath]) => ({ kind: 'bundle' as const, record, reportPath: reportPath.replace(/\s+/g, '_') }));

const noBundleInputArb: fc.Arbitrary<SummaryInput> = fc
  .record({
    outcome: fc.constantFrom(...OUTCOMES),
    claimTexts: fc.option(fc.array(anyText, { maxLength: 4 }), { nil: undefined }),
    failureFields: fc.option(fc.array(fc.string({ maxLength: 40 }), { maxLength: 15 }), { nil: undefined }),
    stepCount: fc.option(fc.nat(50), { nil: undefined }),
  })
  .map((r) => ({ kind: 'no_bundle' as const, reason: 'stage-error' as const, ...r }));

const summaryInputArb = fc.oneof(bundleInputArb, noBundleInputArb);

describe('Terminal_Summary structure', () => {
  // **Validates: Requirements 8.1, 8.2, 8.3, 8.15**
  it('Feature: evidence-bundle, Property 25: Terminal_Summary structure, ordering and claim-line truncation', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        const text = buildSummary(input);
        const lines = text.replace(/\n$/, '').split('\n');
        expect(lines.length).toBeLessThanOrEqual(10);
        expect(lines.length).toBe(4);

        const outcome = input.kind === 'bundle' ? input.record.outcome : input.outcome;
        expect(lines[0]).toBe(`Outcome: ${outcome}`);
        expect(lines[1]).toMatch(/^Claim: /);
        expect(lines[2]).toMatch(/^Why: /);
        expect(lines[3]).toMatch(/^Report: /);
        for (const line of lines.slice(0, 3)) expect(line.length).toBeLessThanOrEqual(200);

        // The Report_Path is printed in full.
        if (input.kind === 'bundle') expect(lines[3]).toBe(`Report: ${input.reportPath}`);

        // Claim-line truncation.
        const texts =
          input.kind === 'bundle' ? input.record.claims.map((c) => c.text) : (input.claimTexts ?? []);
        if (texts.length > 0) {
          const collapsed = (texts[0] ?? '').replace(/\s+/g, ' ').trim();
          const suffix = texts.length > 1 ? ` (+${texts.length - 1} more)` : '';
          const natural = `Claim: ${collapsed}${suffix}`;
          if (natural.length > 200) {
            expect(lines[1]?.length).toBe(200);
            expect(lines[1]?.endsWith(`…${suffix}`)).toBe(true);
          } else {
            expect(lines[1]).toBe(natural);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
