import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { ChangeContext, Provenance } from '../context/types.js';
import { ConfigDefaults } from '../config/defaults.js';
import { assess } from './assess.js';

// Feature: claims-assessment-eval, Property 17: assess() determinism
// **Validates: Requirements 10.6**

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

describe('Feature: claims-assessment-eval, Property 17: assess() determinism', () => {
  it('same context, config and gateway answers give deep-equal results across calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidatesArb,
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== ''),
        prob,
        prob,
        surfaceProbsArb,
        async (generated, title, observable, adequate, surfaceProbs) => {
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
          // Recorded answers: a pure function of the request, as a fake gateway replay.
          const classifyByState = new Map<string, number>();
          generated.forEach((g, i) => classifyByState.set(JSON.stringify({ i }), g.classify));
          const gateway: JevGateway = {
            async ask(request) {
              const answers: Record<string, unknown> = {};
              for (const name of Object.keys(request.questions)) {
                if (name === 'is_behavior') {
                  const key = JSON.stringify(request.state);
                  let v = 0;
                  for (const ch of key) v = (v * 31 + ch.charCodeAt(0)) % 1009;
                  answers[name] = { type: 'noul', noul: v / 1008 };
                } else if (name === 'surface') {
                  answers[name] = {
                    type: 'choice',
                    probabilities: Object.fromEntries(SURFACE_LABELS.map((l, i) => [l, surfaceProbs[i]!])),
                  };
                } else if (name === 'runtime_observable') {
                  answers[name] = { type: 'noul', noul: observable };
                } else {
                  answers[name] = { type: 'noul', noul: adequate };
                }
              }
              return {
                model: 'fake-model',
                answers,
                usage: { input_tokens: null, output_tokens: null },
              } as unknown as Jev_Response;
            },
          };

          const first = await assess(context, ConfigDefaults, gateway);
          const second = await assess(context, ConfigDefaults, gateway);
          const third = await assess(context, ConfigDefaults, gateway);

          expect(second).toEqual(first);
          expect(third).toEqual(first);
        },
      ),
      { numRuns: 100 },
    );
  });
});
