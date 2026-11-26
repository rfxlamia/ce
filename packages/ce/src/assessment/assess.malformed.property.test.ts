import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { ChangeContext } from '../context/types.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { assess } from './assess.js';

// Feature: claims-assessment-eval, Property 16: Malformed-answer rejection
// **Validates: Requirements 9.3**

const config = ConfigDefaults as EffectiveConfig;

const context: ChangeContext = {
  change: {
    title: 'Add login form',
    files: [],
    commits: [],
    claims: [],
    provenance: [],
  },
  candidates: [],
  checks: [],
  truncated: [],
  providers: [],
  redactions: [],
};

type QuestionName = 'runtime_observable' | 'checks_adequate' | 'surface';

const validAnswer = (name: string): unknown =>
  name === 'surface'
    ? {
        type: 'choice',
        probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, 1 / SURFACE_LABELS.length])),
      }
    : { type: 'noul', noul: 0.5 };

/** Gateway that answers validly except for one question, which gets `bad`. */
class MalformedGateway implements JevGateway {
  calls = 0;
  constructor(
    private readonly target: QuestionName,
    private readonly bad: unknown,
  ) {}
  async ask(request: Jev_Request): Promise<Jev_Response> {
    this.calls += 1;
    const answers: Record<string, unknown> = {};
    for (const name of Object.keys(request.questions)) {
      answers[name] = name === this.target ? this.bad : validAnswer(name);
    }
    return {
      model: 'typesafe/jev-test',
      answers: answers as Jev_Response['answers'],
      usage: { input_tokens: null, output_tokens: null },
    };
  }
}

const badProbability = fc.oneof(
  fc.double({ min: 1.0000001, max: 1e6, noNaN: true }),
  fc.double({ min: -1e6, max: -1e-7, noNaN: true }),
  fc.constantFrom(Number.NaN, Infinity, -Infinity),
  fc.constantFrom('0.5', null, undefined, true, {}, []),
);

const noulBad = fc.oneof(
  badProbability.map((p) => ({ type: 'noul', noul: p })),
  fc.constant({ type: 'noul' }), // missing probability
  fc.constantFrom('noul', 0.5, null, undefined, [], true), // wrong type of answer
  fc.constantFrom('choice', 'score', 'box', 'other').map((t) => ({ type: t, noul: 0.5 })), // wrong `type`
);

const surfaceLabelArb = fc.constantFrom(...SURFACE_LABELS);

const surfaceBad = fc.oneof(
  // probability outside 0..1, NaN or wrong type for one label
  fc
    .tuple(surfaceLabelArb, badProbability)
    .map(([label, p]) => ({
      type: 'choice',
      probabilities: {
        ...Object.fromEntries(SURFACE_LABELS.map((l) => [l, 1 / SURFACE_LABELS.length])),
        [label]: p,
      },
    })),
  // missing surface label
  surfaceLabelArb.map((label) => ({
    type: 'choice',
    probabilities: Object.fromEntries(
      SURFACE_LABELS.filter((l) => l !== label).map((l) => [l, 1 / SURFACE_LABELS.length]),
    ),
  })),
  fc.constant({ type: 'choice' }), // no probabilities
  fc.constantFrom('choice', 0.5, null, undefined, [], true), // wrong type of answer
  fc.constantFrom('noul', 'score', 'box').map((t) => ({ type: t, probabilities: {} })), // wrong `type`
);

const malformedCase: fc.Arbitrary<[QuestionName, unknown]> = fc.oneof(
  noulBad.map((bad): [QuestionName, unknown] => ['runtime_observable', bad]),
  noulBad.map((bad): [QuestionName, unknown] => ['checks_adequate', bad]),
  surfaceBad.map((bad): [QuestionName, unknown] => ['surface', bad]),
);

describe('Feature: claims-assessment-eval, Property 16: Malformed-answer rejection', () => {
  it('rejects any malformed answer with StageError(assessment) and returns no partial result', async () => {
    await fc.assert(
      fc.asyncProperty(malformedCase, async ([target, bad]) => {
        const gateway = new MalformedGateway(target, bad);
        let result: unknown;
        let error: unknown;
        try {
          result = await assess(context, config, gateway);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(StageError);
        expect((error as StageError).stage).toBe('assessment');
        expect(result).toBeUndefined();
        expect(gateway.calls).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('accepts the same context when every answer is valid (control)', async () => {
    const result = await assess(context, config, new MalformedGateway('surface', validAnswer('surface')));
    expect(result.assessment.subjects).toHaveLength(1);
  });
});
