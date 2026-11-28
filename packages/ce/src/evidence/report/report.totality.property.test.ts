/**
 * Feature: report-html-evidence-page, Property 12: `render` never throws on any schema-accepted record.
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evidencedRunRecordArb, runRecordArb } from '../arbitraries.js';
import { RunRecordSchema } from '../schema.js';
import type { RunRecord } from '../schema.js';
import { render } from './render.js';

const SECTION_IDS = ['banner', 'claims', 'assessment', 'timeline', 'final', 'logs', 'raw'] as const;

function assertTotal(record: RunRecord): void {
  expect(RunRecordSchema.safeParse(record).success).toBe(true);
  let html = '';
  expect(() => {
    html = render(record);
  }).not.toThrow();
  expect(typeof html).toBe('string');
  expect(html.length).toBeGreaterThan(0);
  for (const id of SECTION_IDS) {
    expect(html, `section ${id}`).toMatch(new RegExp(`<section\\b[^>]*\\sid="${id}"`));
  }
}

const minimalRecord: RunRecord = {
  schemaVersion: '2',
  ceVersion: '0.0.0',
  jevModels: [],
  outcome: 'ERROR',
  outcomeReason: 'stage-error',
  artifacts: [],
  timings: {
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 0,
    stages: { config: null, context: null, assessment: null, runtime: null },
  },
  config: null,
  context: null,
  claims: [],
  assessment: null,
  subject: null,
  steps: [],
  eventLog: [],
  finalImage: null,
  runtime: null,
  finalState: null,
  error: { stage: 'config', reason: 'stage-error', causeName: null, fields: [] },
} as RunRecord;

/** Replace each string leaf with '' where the schema still accepts it. */
function blankStrings(record: RunRecord): RunRecord {
  const root = JSON.parse(JSON.stringify(record)) as unknown;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach((_, i) => visit(node, i));
    } else if (node !== null && typeof node === 'object') {
      for (const k of Object.keys(node)) visit(node as Record<string, unknown>, k);
    }
  };
  const visit = (parent: unknown, k: string | number): void => {
    const p = parent as Record<string | number, unknown>;
    const v = p[k];
    if (typeof v === 'string') {
      p[k] = '';
      if (!RunRecordSchema.safeParse(root).success) p[k] = v;
    } else {
      walk(v);
    }
  };
  walk(root);
  return root as RunRecord;
}

describe('Feature: report-html-evidence-page, Property 12', () => {
  it('renders every schema-accepted record without throwing', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        assertTotal(record);
      }),
      { numRuns: 100 },
    );
  });

  it('renders a Minimal_Record (ERROR with nullable fields null)', () => {
    assertTotal(minimalRecord);
  });

  it('renders records whose strings are all empty where the schema allows', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        assertTotal(blankStrings(record));
      }),
      { numRuns: 50 },
    );
    assertTotal(blankStrings(minimalRecord));
  });

  it('renders a record with a large step count', () => {
    fc.assert(
      fc.property(
        evidencedRunRecordArb,
        fc.array(fc.nat(), { minLength: 1, maxLength: 1 }),
        (record, _seed) => {
          const base = record.steps[0]!;
          const steps = Array.from({ length: 200 }, (_, i) => ({ ...base, step: i + 1 }));
          assertTotal({ ...record, steps } as RunRecord);
        },
      ),
      { numRuns: 10 },
    );
  });
});
