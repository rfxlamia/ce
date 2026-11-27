// Feature: evidence-bundle, Property 28: Report_Path line reflects bundle and report-file state
// **Validates: Requirements 8.11, 8.12, 8.13, 8.16**
// Also covers the Terminal_Summary part of Property 11 (no generated secret in the summary text).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolutionArb, runRecordArb } from './arbitraries.js';
import { redactRunRecord } from './redact.js';
import { buildSummary } from './summary.js';
import type { SummaryInput } from './summary.js';

const dirArb = fc
  .array(fc.stringMatching(/^[a-z0-9_-]{1,40}$/), { minLength: 1, maxLength: 6 })
  .map((s) => `.ce/runs/${s.join('/')}`);

const reportLine = (text: string): string => text.split('\n')[3] ?? '';

describe('Property 28: Report_Path line', () => {
  it('bundle input prints the given path in full (report.html when it exists, else run.json)', () => {
    fc.assert(
      fc.property(runRecordArb, dirArb, fc.boolean(), (record, dir, hasReport) => {
        const reportPath = `${dir}/${hasReport ? 'report.html' : 'run.json'}`;
        const text = buildSummary({ kind: 'bundle', record, reportPath });
        expect(reportLine(text)).toBe(`Report: ${reportPath}`);
        expect(reportLine(text).endsWith(hasReport ? 'report.html' : 'run.json')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('no_bundle input states that no bundle was written', () => {
    fc.assert(
      fc.property(
        resolutionArb,
        fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }),
        fc.array(fc.stringMatching(/^[a-z.]{1,12}$/), { maxLength: 4 }),
        (resolution, claimTexts, failureFields) => {
          const input: SummaryInput = {
            kind: 'no_bundle',
            outcome: resolution.outcome,
            reason: resolution.reason,
            claimTexts,
            failureFields,
          };
          const text = buildSummary(input);
          expect(text.startsWith(`Outcome: ${resolution.outcome}\n`)).toBe(true);
          expect(reportLine(text)).toMatch(/^Report: no bundle was written/);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 11 (Terminal_Summary part): no secret value in the summary', () => {
  const secretsArb = fc
    .uniqueArray(fc.stringMatching(/^[0-9a-f]{12}$/), { minLength: 1, maxLength: 3 })
    .map((ids) => ids.map((id) => `SECRETVALUE${id}`));

  it('summary of a redacted record contains no generated secret', () => {
    fc.assert(
      fc.property(runRecordArb, secretsArb, dirArb, (record, secrets, dir) => {
        const secret = secrets[0] as string;
        const seeded = {
          ...record,
          claims: [{ ...(record.claims[0] ?? { id: 'c', probability: null, provenance: { provider: 'cli' } }), text: `see ${secret} here` }, ...record.claims.slice(1)],
        } as typeof record;
        const redacted = redactRunRecord(seeded, secrets);
        const text = buildSummary({ kind: 'bundle', record: redacted, reportPath: `${dir}/run.json` });
        for (const s of secrets) expect(text).not.toContain(s);
      }),
      { numRuns: 100 },
    );
  });
});
