/**
 * Feature: report-html-evidence-page, Property 10:
 * The step timeline always orders steps correctly and marks the taken alternative.
 *
 * **Validates: Requirements 6.1, 6.2, 6.4, 6.5**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evidencedRunRecordArb } from '../../arbitraries.js';
import type { RunRecord } from '../../schema.js';
import { renderTimeline } from './timeline.js';

type Step = RunRecord['steps'][number];

const text = fc.string({ maxLength: 20 });
const segment = fc.stringMatching(/^[a-z0-9_-]{1,8}$/);
const bundlePath = fc.array(segment, { minLength: 1, maxLength: 3 }).map((s) => s.join('/'));
const key = segment.map((s) => `k${s}`);
const prob = fc.double({ noNaN: true, min: 0, max: 1 }).map((n) => (n === 0 ? 0 : n));

/** Alternative keys include the reserved `done` / `give_up` so the taken lookup is exercised. */
const altKey = fc.oneof(key, fc.constantFrom('done', 'give_up'));

const stepArb: fc.Arbitrary<Step> = fc.record({
  step: fc.nat({ max: 1000 }),
  url: text,
  title: text,
  action: fc.record({
    kind: fc.oneof(text, fc.constantFrom('click', 'done', 'give_up')),
    description: text,
  }),
  executed: fc.boolean(),
  screenshot: bundlePath,
  probabilities: fc.dictionary(key, fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }).map((n) => (n === 0 ? 0 : n)), { maxKeys: 3 }),
  alternatives: fc.array(fc.record({ key: altKey, description: text, probability: prob }), { maxLength: 5 }),
});

const recordArb = fc
  .tuple(evidencedRunRecordArb, fc.array(stepArb, { maxLength: 16 }))
  .map(([record, steps]) => ({ ...record, steps }) as RunRecord);

/** One chunk per `<li class="step">`; these tags cannot be forged by escaped record text. */
function stepChunks(html: string): string[] {
  return html.split('<li class="step"').slice(1);
}

describe('Feature: report-html-evidence-page, Property 10', () => {
  it('orders steps ascending, alternatives descending, marks exactly one taken', () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        const html = renderTimeline(record);
        const chunks = stepChunks(html);
        expect(chunks).toHaveLength(record.steps.length);

        // 6.1: ascending step order.
        const numbers = chunks.map((c) => Number(/^ id="step-(\d+)"/.exec(c)?.[1]));
        expect(numbers).toEqual([...record.steps.map((s) => s.step)].sort((a, b) => a - b));

        // Stable ascending order; ties keep recorded order.
        const ordered = record.steps
          .map((s, i) => ({ s, i }))
          .sort((a, b) => a.s.step - b.s.step || a.i - b.i)
          .map((e) => e.s);
        const collapsed = record.steps.length > 12;
        for (const [index, chunk] of chunks.entries()) {
          const step = ordered[index] as Step;
          if (step.alternatives.length === 0) {
            // 6.5
            expect(chunk).toContain('no alternatives recorded');
            expect(chunk).not.toContain('taken-mark');
            expect(chunk).not.toContain('<details');
            continue;
          }
          expect(chunk).not.toContain('no alternatives recorded');
          // 6.4: descending probability.
          const vals = [...chunk.matchAll(/class="val">([^<]*)</g)].map((m) => Number(m[1]));
          expect(vals).toHaveLength(step.alternatives.length);
          for (let i = 1; i < vals.length; i++) expect(vals[i]!).toBeLessThanOrEqual(vals[i - 1]!);
          // 6.2: exactly one taken marker.
          expect(chunk.match(/<span class="taken-mark">/g)?.length ?? 0).toBe(1);
          expect(chunk.match(/class="alt taken"/g)?.length ?? 0).toBe(1);
          // Collapsed only when over 12 steps.
          expect(/<details class="alternatives" open>/.test(chunk)).toBe(!collapsed);
          expect(/<details class="alternatives">/.test(chunk)).toBe(collapsed);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('shows the empty-steps message when there are no steps', () => {
    fc.assert(
      fc.property(evidencedRunRecordArb, (record) => {
        const html = renderTimeline({ ...record, steps: [] } as RunRecord);
        expect(html).toContain('No runtime steps were recorded');
        expect(stepChunks(html)).toHaveLength(0);
      }),
      { numRuns: 20 },
    );
  });
});
