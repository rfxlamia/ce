// Feature: report-html-evidence-page, Property 9
// Claims and candidates are shown without fabrication or leaked patch text.
// **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 4.6, 4.8**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runRecordArb } from '../../arbitraries.js';
import type { RunRecord } from '../../schema.js';
import { escapeHtml } from '../escape.js';
import { renderClaims } from './claims.js';

const PATCH_MARK = 'PATCHLEAK\u00a7diff--git';
const COMMIT_MARK = 'COMMITLEAK\u00a7message';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Make claims and assessment.claimStatus coherent, and add leak bait to the context. */
function shape(record: RunRecord, withBait: boolean): RunRecord {
  const r = { ...record } as RunRecord;
  if (r.assessment !== null) {
    r.assessment = {
      ...r.assessment,
      claimStatus: r.claims.length === 0 ? 'not_identified' : 'identified',
    };
  }
  if (withBait && r.context !== null) {
    const files = r.context.change.files.map((f) => ({ ...f, patch: PATCH_MARK }));
    r.context = {
      ...r.context,
      change: { ...r.context.change, files, commitMessages: [COMMIT_MARK], commits: r.context.change.commits },
    } as never;
  }
  return r;
}

const caseArb = fc.tuple(runRecordArb, fc.boolean()).map(([rec, bait]) => shape(rec, bait));

describe('Feature: report-html-evidence-page, Property 9', () => {
  it('shows every Claim, its chip and signal, without fabrication or patch text', () => {
    fc.assert(
      fc.property(caseArb, (record) => {
        const html = renderClaims(record);

        // 4.1 every claim: id, text, provider chip; nothing extra.
        expect(count(html, 'data-claim-id="')).toBe(record.claims.length);
        for (const c of record.claims) {
          expect(html).toContain(`data-claim-id="${escapeHtml(c.id)}"`);
          expect(html).toContain(escapeHtml(c.text));
          expect(html).toContain(`<b>${escapeHtml(c.provenance.provider)}</b>`);
          for (const v of [c.provenance.ref, c.provenance.location]) {
            if (typeof v === 'string' && v !== '') expect(html).toContain(escapeHtml(v));
          }
          // 4.3 probability is a signal, null is declared.
          if (c.probability === null) expect(html).toContain('declared, no classifier signal');
        }
        expect(count(html, 'claim-declared')).toBe(record.claims.filter((c) => c.probability === null).length);

        // 4.4 "No claim identified" exactly when the assessment says so.
        expect(html.includes('No claim identified')).toBe(record.assessment?.claimStatus === 'not_identified');
        if (record.assessment?.claimStatus === 'not_identified') {
          expect(count(html, 'data-claim-id="')).toBe(0);
        }

        // 4.5 candidates are listed as candidates, never as Claims.
        const candidates = record.context?.candidates ?? [];
        expect(count(html, 'data-candidate-id="')).toBe(candidates.length);
        expect(html.includes('(candidates, not Claims)')).toBe(candidates.length > 0);
        for (const c of candidates) expect(html).toContain(escapeHtml(c.text));

        // 4.6 files and checks listed; no patch or commit message text.
        for (const f of record.context?.change.files ?? []) {
          expect(html).toContain(escapeHtml(f.path));
          expect(html).toContain(escapeHtml(f.status));
        }
        for (const c of record.context?.checks ?? []) {
          expect(html).toContain(escapeHtml(c.name));
          expect(html).toContain(escapeHtml(c.status));
        }
        expect(html).not.toContain(PATCH_MARK);
        expect(html).not.toContain(COMMIT_MARK);

        // 4.8 null context is stated, and no files/checks tables appear.
        expect(html.includes('context-null')).toBe(record.context === null);
        if (record.context === null) {
          expect(html).not.toContain('<table');
          expect(html).not.toContain('data-candidate-id');
        }
      }),
      { numRuns: 100 },
    );
  });
});
