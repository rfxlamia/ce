import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runRecordArb } from './arbitraries.js';
import { RunRecordSchema } from './schema.js';

const schemaUrl = new URL('../../../../schemas/run.schema.json', import.meta.url);
const jsonSchema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
// `format` is not checked (date-time, uri) and `strict: false` tolerates
// annotation keywords, as in the config schema agreement test.
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
const validateJson = ajv.compile(jsonSchema);

type Rec = Record<string, unknown>;

const clone = (r: unknown): Rec => JSON.parse(JSON.stringify(r)) as Rec;

const stepSample = {
  step: 0,
  url: 'http://localhost/',
  title: 't',
  action: { kind: 'click', description: 'd' },
  executed: true,
  screenshot: 'step-0.png',
  probabilities: {},
  alternatives: [],
};
const errorSample = { stage: 'runtime', reason: 'stage-error', causeName: null, fields: [] };

/**
 * Each mutation takes a valid record and returns a changed copy. `violates`
 * says whether the mutation is known to break the Requirement 2.16 presence
 * table or strictness for the record's outcome (so both validators must
 * reject it). Mutations that may produce a still-valid record (outcome swaps)
 * only need the two validators to agree.
 */
interface Mutation {
  name: string;
  apply: (r: Rec) => Rec | undefined;
  violates: boolean;
}

const set = (key: string, value: unknown) => (r: Rec): Rec => {
  r[key] = value;
  return r;
};

const mutations: Mutation[] = [
  // Extra properties (strict objects), top level and nested.
  { name: 'extra top-level key', violates: true, apply: set('unexpected', 1) },
  {
    name: 'extra key in timings',
    violates: true,
    apply: (r) => {
      (r.timings as Rec).unexpected = 1;
      return r;
    },
  },
  {
    name: 'extra key in artifacts[0]',
    violates: true,
    apply: (r) => {
      const a = r.artifacts as Rec[];
      if (a.length === 0) a.push({ path: 'a.png', kind: 'screenshot' });
      a[0]!.unexpected = 1;
      return r;
    },
  },
  // Outcome literal.
  { name: 'outcome outside OUTCOMES', violates: true, apply: set('outcome', 'PASSED') },
  { name: 'outcome lowercase', violates: true, apply: set('outcome', 'evidenced') },
  { name: 'outcome null', violates: true, apply: set('outcome', null) },
  { name: 'outcome missing', violates: true, apply: (r) => (delete r.outcome, r) },
  {
    name: 'outcome swapped to another valid literal',
    violates: false,
    apply: (r) => {
      const order = ['SKIPPED', 'EVIDENCED', 'UNSUPPORTED', 'ERROR'];
      r.outcome = order[(order.indexOf(r.outcome as string) + 1) % 4];
      return r;
    },
  },
  {
    name: 'outcome swapped to EVIDENCED/ERROR from the other family',
    violates: false,
    apply: (r) => {
      r.outcome = r.outcome === 'ERROR' ? 'SKIPPED' : 'ERROR';
      return r;
    },
  },
  // Presence cells: wrong nullability for the outcome.
  {
    name: 'not-run outcome with non-null subject, or evidenced with null subject',
    violates: true,
    apply: (r) => {
      if (r.outcome === 'ERROR') return undefined;
      r.subject = r.outcome === 'EVIDENCED' ? null : 'http://localhost/';
      return r;
    },
  },
  {
    name: 'not-run outcome with non-empty steps, or evidenced with empty steps',
    violates: true,
    apply: (r) => {
      if (r.outcome === 'ERROR') return undefined;
      r.steps = r.outcome === 'EVIDENCED' ? [] : [stepSample];
      return r;
    },
  },
  {
    name: 'not-run outcome with non-null finalState, or evidenced with null finalState',
    violates: true,
    apply: (r) => {
      if (r.outcome === 'ERROR') return undefined;
      r.finalState = r.outcome === 'EVIDENCED' ? null : 'reached';
      return r;
    },
  },
  {
    name: 'ERROR with non-null finalState',
    violates: true,
    apply: (r) => {
      if (r.outcome !== 'ERROR') return undefined;
      r.finalState = 'reached';
      return r;
    },
  },
  {
    name: 'ERROR with null error',
    violates: true,
    apply: (r) => {
      if (r.outcome !== 'ERROR') return undefined;
      r.error = null;
      return r;
    },
  },
  {
    name: 'non-ERROR with non-null error',
    violates: true,
    apply: (r) => {
      if (r.outcome === 'ERROR') return undefined;
      r.error = errorSample;
      return r;
    },
  },
  {
    name: 'not-run outcome with non-null runtime',
    violates: true,
    apply: (r) => {
      if (r.outcome !== 'SKIPPED' && r.outcome !== 'UNSUPPORTED') return undefined;
      r.runtime = { stopReason: 'done' };
      return r;
    },
  },
  {
    name: 'not-run outcome with non-null finalImage',
    violates: true,
    apply: (r) => {
      if (r.outcome !== 'SKIPPED' && r.outcome !== 'UNSUPPORTED') return undefined;
      r.finalImage = {
        model: null,
        error: null,
        screenshot: null,
        box: null,
        signals: { stateReachedDom: null, stateReached: null },
      };
      return r;
    },
  },
  {
    name: 'not-run outcome with non-null eventLog',
    violates: true,
    apply: (r) => {
      if (r.outcome !== 'SKIPPED' && r.outcome !== 'UNSUPPORTED') return undefined;
      r.eventLog = [{ step: 0, kind: 'dialog', detail: 'd' }];
      return r;
    },
  },
  {
    name: 'not-run outcome with null assessment',
    violates: true,
    apply: (r) => {
      if (r.outcome === 'ERROR') return undefined;
      r.assessment = null;
      return r;
    },
  },
  {
    name: 'not-run outcome with null config',
    violates: true,
    apply: (r) => {
      if (r.outcome === 'ERROR') return undefined;
      r.config = null;
      return r;
    },
  },
  { name: 'wrong schemaVersion', violates: true, apply: set('schemaVersion', '1') },
  { name: 'bundle-relative path escapes run dir', violates: true, apply: (r) => {
      const a = r.artifacts as Rec[];
      a.push({ path: '../outside.png', kind: 'screenshot' });
      return r;
    } },
  { name: 'absolute artifact path', violates: true, apply: (r) => {
      const a = r.artifacts as Rec[];
      a.push({ path: '/etc/passwd', kind: 'log' });
      return r;
    } },
];

const stepAlt = (r: Rec): Rec | undefined => {
  const steps = r.steps as Rec[];
  return steps.length === 0 ? undefined : steps[0]!;
};
const finalImageOf = (r: Rec): Rec | undefined =>
  r.finalImage === null || r.finalImage === undefined ? undefined : (r.finalImage as Rec);

/** Mutations of the fields added in schema version 2 (alternatives, box, signals). */
const extendedMutations: Mutation[] = [
  {
    name: 'step without alternatives',
    violates: true,
    apply: (r) => {
      const s = stepAlt(r);
      if (!s) return undefined;
      delete s.alternatives;
      return r;
    },
  },
  {
    name: 'alternative probability above 1',
    violates: true,
    apply: (r) => {
      const s = stepAlt(r);
      if (!s) return undefined;
      s.alternatives = [{ key: 'k', description: 'd', probability: 1.5 }];
      return r;
    },
  },
  {
    name: 'alternative probability below 0',
    violates: true,
    apply: (r) => {
      const s = stepAlt(r);
      if (!s) return undefined;
      s.alternatives = [{ key: 'k', description: 'd', probability: -0.1 }];
      return r;
    },
  },
  {
    name: 'extra key in alternative',
    violates: true,
    apply: (r) => {
      const s = stepAlt(r);
      if (!s) return undefined;
      s.alternatives = [{ key: 'k', description: 'd', probability: 0.5, extra: 1 }];
      return r;
    },
  },
  {
    name: 'finalImage without signals',
    violates: true,
    apply: (r) => {
      const f = finalImageOf(r);
      if (!f) return undefined;
      delete f.signals;
      return r;
    },
  },
  {
    name: 'finalImage signals null',
    violates: true,
    apply: (r) => {
      const f = finalImageOf(r);
      if (!f) return undefined;
      f.signals = null;
      return r;
    },
  },
  {
    name: 'finalImage signal above 1',
    violates: true,
    apply: (r) => {
      const f = finalImageOf(r);
      if (!f) return undefined;
      f.signals = { stateReachedDom: 2, stateReached: null };
      return r;
    },
  },
  {
    name: 'finalImage box missing a coordinate',
    violates: true,
    apply: (r) => {
      const f = finalImageOf(r);
      if (!f) return undefined;
      f.box = { x: 0, y: 0, width: 1 };
      return r;
    },
  },
  {
    name: 'finalImage box with an extra key',
    violates: true,
    apply: (r) => {
      const f = finalImageOf(r);
      if (!f) return undefined;
      f.box = { x: 0, y: 0, width: 1, height: 1, extra: 1 };
      return r;
    },
  },
  {
    name: 'finalImage without box',
    violates: true,
    apply: (r) => {
      const f = finalImageOf(r);
      if (!f) return undefined;
      delete f.box;
      return r;
    },
  },
];

describe('Run_Schema and generated JSON Schema agree', () => {
  // Feature: report-html-evidence-page, Property 13: The extended Run_Record shape round-trips and agrees with its JSON Schema
  // **Validates: Requirements 12.5, 12.8**
  it('Feature: report-html-evidence-page, Property 13: both validators accept generated alternatives, box and signals and agree on their mutations', () => {
    let applied = 0;
    fc.assert(
      fc.property(
        runRecordArb,
        fc.integer({ min: 0, max: extendedMutations.length - 1 }),
        (record, i) => {
          const base = clone(record);
          expect(RunRecordSchema.safeParse(base).success).toBe(true);
          expect(validateJson(base), JSON.stringify(validateJson.errors)).toBe(true);
          // The new fields are present in the serialized record.
          for (const s of base.steps as Rec[]) expect(Array.isArray(s.alternatives)).toBe(true);
          const f = finalImageOf(base);
          if (f) {
            expect('box' in f).toBe(true);
            expect(f.signals).not.toBeNull();
            expect(typeof f.signals).toBe('object');
          }

          const m = extendedMutations[i]!;
          const mutated = m.apply(clone(record));
          if (mutated === undefined) return;
          applied++;
          const zodOk = RunRecordSchema.safeParse(mutated).success;
          const jsonOk = validateJson(mutated) as boolean;
          expect(jsonOk, `${m.name}: ${JSON.stringify(validateJson.errors)}`).toBe(zodOk);
          if (m.violates) {
            expect(zodOk, m.name).toBe(false);
            expect(jsonOk, m.name).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
    expect(applied).toBeGreaterThan(0);
  }, 30000);

  // Feature: evidence-bundle, Property 5: The zod schema and the generated JSON Schema agree, including on mutated records
  // **Validates: Requirements 3.4, 3.7, 3.9, 3.10, 3.13**
  it('Feature: evidence-bundle, Property 5: The zod schema and the generated JSON Schema agree, including on mutated records', () => {
    let rejectedMutations = 0;
    fc.assert(
      fc.property(runRecordArb, fc.integer({ min: 0, max: mutations.length - 1 }), (record, i) => {
        const base = clone(record);
        // Both accept the unmutated record.
        expect(RunRecordSchema.safeParse(base).success).toBe(true);
        expect(validateJson(base), JSON.stringify(validateJson.errors)).toBe(true);

        const m = mutations[i]!;
        const mutated = m.apply(clone(record));
        if (mutated === undefined) return; // not applicable to this outcome

        const zodOk = RunRecordSchema.safeParse(mutated).success;
        const jsonOk = validateJson(mutated) as boolean;
        expect(jsonOk, `${m.name}: ${JSON.stringify(validateJson.errors)}`).toBe(zodOk);
        if (m.violates) {
          expect(zodOk, m.name).toBe(false);
          expect(jsonOk, m.name).toBe(false);
        }
        if (!zodOk) rejectedMutations++;
      }),
      { numRuns: 300 },
    );
    expect(rejectedMutations).toBeGreaterThan(0);
   }, 30000);
});
