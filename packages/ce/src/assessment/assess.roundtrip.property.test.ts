import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { ChangeContext, Provenance } from '../context/types.js';
import { ConfigDefaults } from '../config/defaults.js';
import { assess } from './assess.js';

// Feature: claims-assessment-eval, Property 15: Assessment/record JSON round-trip
// **Validates: Requirements 8.7**

// `+ 0` turns -0 into 0, which JSON cannot represent.
const prob = fc.double({ min: 0, max: 1, noNaN: true }).map((p) => p + 0);

const providerArb = fc.constantFrom<Provenance['provider']>('git', 'github', 'cli', 'junit');

const candidatesArb = fc.array(
  fc.record({
    text: fc.string({ minLength: 1, maxLength: 30 }),
    provider: providerArb,
    classify: prob,
  }),
  { maxLength: 6 },
);

const surfaceProbsArb = fc.tuple(...SURFACE_LABELS.map(() => prob));

interface Scripted {
  classify: Map<string, number>;
  observable: number;
  adequate: number;
  surfaceProbs: number[];
}

function gatewayOf(script: Scripted): JevGateway {
  return {
    async ask(request) {
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(request.questions)) {
        if (name === 'is_behavior') {
          answers[name] = { type: 'noul', noul: script.classify.get(JSON.stringify(request.state)) ?? 0.5 };
        } else if (name === 'surface') {
          answers[name] = {
            type: 'choice',
            probabilities: Object.fromEntries(SURFACE_LABELS.map((l, i) => [l, script.surfaceProbs[i]!])),
          };
        } else if (name === 'runtime_observable') {
          answers[name] = { type: 'noul', noul: script.observable };
        } else {
          answers[name] = { type: 'noul', noul: script.adequate };
        }
      }
      return {
        model: 'fake-model',
        answers,
        usage: { input_tokens: null, output_tokens: null },
      } as unknown as Jev_Response;
    },
  };
}

describe('Feature: claims-assessment-eval, Property 15: Assessment/record JSON round-trip', () => {
  it('JSON.parse(JSON.stringify(x)) deep-equals the claims and the assessment from assess()', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidatesArb,
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== ''),
        prob,
        prob,
        surfaceProbsArb,
        fc.array(prob, { minLength: 6, maxLength: 6 }),
        async (generated, title, observable, adequate, surfaceProbs, classifyPool) => {
          const candidates = generated.map((g, i) => ({
            id: `c${i}`,
            text: g.text,
            provenance: { provider: g.provider, location: `loc-${i}` } as Provenance,
          }));
          const context: ChangeContext = {
            change: { title, files: [], commits: [], claims: [], provenance: [] },
            candidates,
            checks: [],
            truncated: [],
            providers: [],
            redactions: [],
          };
          // Classification answers are served in call order through a shared pool.
          let n = 0;
          const base = gatewayOf({
            classify: new Map(),
            observable,
            adequate,
            surfaceProbs: [...surfaceProbs],
          });
          const gateway: JevGateway = {
            async ask(request, options) {
              const response = await base.ask(request, options);
              if ('is_behavior' in response.answers) {
                response.answers['is_behavior'] = {
                  type: 'noul',
                  noul: classifyPool[n++ % classifyPool.length]!,
                } as never;
              }
              return response;
            },
          };

          const result = await assess(context, ConfigDefaults, gateway);

          expect(JSON.parse(JSON.stringify(result.claims))).toEqual(result.claims);
          expect(JSON.parse(JSON.stringify(result.assessment))).toEqual(result.assessment);
        },
      ),
      { numRuns: 100 },
    );
  });
});
