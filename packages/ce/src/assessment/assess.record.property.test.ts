import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { ChangeContext, Provenance } from '../context/types.js';
import { CATALOG, SURFACE_LABELS } from '../jev/catalog.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { assess } from './assess.js';

// Feature: claims-assessment-eval, Property 14: Assessment_Record completeness and no-leak
// **Validates: Requirements 8.1, 8.2, 8.3, 8.6**

const FAKE_SECRET = 'sk-or-v1-FAKE-SECRET-0123456789abcdef';
const MODELS = ['typesafe/jev-1.14-20260101', 'typesafe/jev-1.14-20260202', 'typesafe/jev-1.14-20260303'];

const prob = fc.double({ min: 0, max: 1, noNaN: true });

/** A scripted Fake_Gateway: answers by call index and remembers every request. It holds a fake key. */
class ScriptedGateway implements JevGateway {
  readonly requests: Jev_Request[] = [];
  readonly answered: { name: string; value: number | Record<string, number> }[][] = [];
  readonly models: string[] = [];
  readonly #apiKey = FAKE_SECRET;

  constructor(
    private readonly noulScript: readonly number[],
    private readonly surfaceScript: readonly Record<string, number>[],
    private readonly modelScript: readonly string[],
  ) {}

  async ask(request: Jev_Request, _options?: AskOptions): Promise<Jev_Response> {
    void this.#apiKey;
    const call = this.requests.length;
    this.requests.push(request);
    const model = this.modelScript[call % this.modelScript.length]!;
    this.models.push(model);
    const answers: Jev_Response['answers'] = {};
    const log: { name: string; value: number | Record<string, number> }[] = [];
    let n = 0;
    for (const [name, built] of Object.entries(request.questions)) {
      if (built.type === 'noul') {
        const noulValue = this.noulScript[(call * 3 + n++) % this.noulScript.length]!;
        answers[name] = { type: 'noul', noul: noulValue } as never;
        log.push({ name, value: noulValue });
      } else {
        const probabilities = this.surfaceScript[call % this.surfaceScript.length]!;
        answers[name] = { type: 'choice', probabilities, choice: 'cli', confidence: 1 } as never;
        log.push({ name, value: probabilities });
      }
    }
    this.answered.push(log);
    return { model, answers, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out));
  else if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((v) => stringsIn(v, out));
  }
  return out;
}

const surfaceArb = fc
  .tuple(prob, prob, prob, prob, prob, prob)
  .map((t) => Object.fromEntries(SURFACE_LABELS.map((label, i) => [label, t[i]!])));

const providerArb = fc.constantFrom<Provenance['provider']>('git', 'github', 'cli');

describe('Feature: claims-assessment-eval, Property 14: Assessment_Record completeness and no-leak', () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env['OPENROUTER_API_KEY'];
    process.env['OPENROUTER_API_KEY'] = FAKE_SECRET;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env['OPENROUTER_API_KEY'];
    else process.env['OPENROUTER_API_KEY'] = savedKey;
  });

  it('lists every question, candidate, distinct model id, setting and cut, and never leaks secrets or request text', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(providerArb, { maxLength: 6 }),
        fc.array(prob, { minLength: 1, maxLength: 12 }),
        fc.array(surfaceArb, { minLength: 1, maxLength: 4 }),
        fc.array(fc.constantFrom(...MODELS), { minLength: 1, maxLength: 5 }),
        prob,
        fc.constantFrom<'evidence' | 'skip'>('evidence', 'skip'),
        async (providers, noulScript, surfaceScript, modelScript, claimThreshold, onUncertain) => {
          const candidates = providers.map((provider, i) => ({
            id: `cand-${i}`,
            text: `UNIQUE-CANDIDATE-TEXT-${i} shows the dashboard heading after login`,
            provenance: { provider } as Provenance,
          }));
          const context: ChangeContext = {
            change: {
              title: 'UNIQUE-CHANGE-TITLE adds a dashboard',
              files: [],
              commits: [],
              claims: [],
              provenance: [],
            },
            candidates,
            checks: [],
            truncated: [],
            providers: [],
            redactions: [],
          };
          const config: EffectiveConfig = {
            ...ConfigDefaults,
            assessment: {
              ...ConfigDefaults.assessment,
              thresholds: { ...ConfigDefaults.assessment?.thresholds, claim: claimThreshold },
              'on-uncertain': onUncertain,
            },
          };

          const gateway = new ScriptedGateway(noulScript, surfaceScript, modelScript);
          const { claims, assessment } = await assess(context, config, gateway);
          const record = assessment.record;

          // 8.1: one entry per question actually asked (id@version, subject, probability).
          const asked: { idVersion: string; subjectId: string; value: unknown }[] = [];
          const isClassification = (r: Jev_Request) => 'is_behavior' in r.questions;
          const nonCli = candidates.filter((c) => c.provenance.provider !== 'cli');
          let classifyIndex = 0;
          let subjectIndex = 0;
          const subjectIds =
            claims.length > 0 ? claims.map((c) => c.id) : ['change'];
          gateway.requests.forEach((request, call) => {
            const subjectId = isClassification(request)
              ? nonCli[classifyIndex++]!.id
              : subjectIds[subjectIndex++]!;
            for (const a of gateway.answered[call]!) {
              asked.push({
                idVersion: request.questions[a.name]!.idVersion,
                subjectId,
                value: a.value,
              });
            }
          });
          expect(record.questions).toHaveLength(asked.length);
          record.questions.forEach((q, i) => {
            expect(q.idVersion).toBe(asked[i]!.idVersion);
            expect(q.subjectId).toBe(asked[i]!.subjectId);
            if (q.probability !== undefined) expect(q.probability).toBe(asked[i]!.value);
            else expect(q.probabilities).toEqual(asked[i]!.value);
          });
          expect(gateway.requests).toHaveLength(nonCli.length + subjectIds.length);

          // 8.2: one entry per classified candidate, with its probability and Claim status.
          expect(record.candidates.map((c) => c.candidateId)).toEqual(nonCli.map((c) => c.id));
          for (const c of record.candidates) {
            const q = record.questions.find(
              (x) => x.idVersion === CATALOG.claimIsBehavior.idVersion && x.subjectId === c.candidateId,
            )!;
            expect(c.probability).toBe(q.probability);
            expect(c.becameClaim).toBe(claims.some((claim) => claim.id === c.candidateId));
          }

          // 8.3: distinct model ids, effective settings, cuts.
          expect(new Set(record.modelIds)).toEqual(new Set(gateway.models));
          expect(record.modelIds).toHaveLength(new Set(record.modelIds).size);
          expect(record.settings.claimThreshold).toBe(claimThreshold);
          expect(record.settings.onUncertain).toBe(onUncertain);
          expect(Array.isArray(record.cuts)).toBe(true);

          // 8.6: no secret, no catalog question text, no request state text in the record.
          const json = JSON.stringify(record);
          expect(json).not.toContain(FAKE_SECRET);
          expect(JSON.stringify(assessment)).not.toContain(FAKE_SECRET);
          expect(json).not.toContain('UNIQUE-CANDIDATE-TEXT');
          expect(json).not.toContain('UNIQUE-CHANGE-TITLE');
          for (const request of gateway.requests) {
            if (typeof request.state === 'string') expect(json).not.toContain(request.state);
            for (const built of Object.values(request.questions)) {
              for (const s of stringsIn(built.question).filter((s) => s.length >= 20)) {
                expect(json).not.toContain(s);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
