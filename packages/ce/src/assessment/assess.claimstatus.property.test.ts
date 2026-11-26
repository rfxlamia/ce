import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { ChangeContext } from '../context/types.js';
import { ConfigDefaults } from '../config/defaults.js';
import { assess } from './assess.js';

// Feature: claims-assessment-eval, Property 5: claimStatus totality
// **Validates: Requirements 2.5, 2.6, 2.7, 2.8**

const prob = fc.double({ min: 0, max: 1, noNaN: true });

function contextOf(count: number): ChangeContext {
  return {
    change: {
      title: 'change title',
      files: [],
      commits: [],
      claims: [],
      provenance: [],
    },
    candidates: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      text: `candidate ${i}`,
      provenance: { provider: 'git' as const, location: `commit-${i}` },
    })),
    checks: [],
    truncated: [],
    providers: [],
    redactions: [],
  };
}

/** Stub gateway answering by question name. Classification requests consume `classify` in order. */
function stubGateway(classify: readonly number[], assessP: number): JevGateway {
  let n = 0;
  return {
    async ask(request) {
      const names = Object.keys(request.questions);
      const answers: Record<string, unknown> = {};
      for (const name of names) {
        if (name === 'is_behavior') {
          answers[name] = { type: 'noul', noul: classify[n++]! };
        } else if (name === 'surface') {
          answers[name] = {
            type: 'choice',
            probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, 1 / SURFACE_LABELS.length])),
          };
        } else {
          answers[name] = { type: 'noul', noul: assessP };
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

describe('Feature: claims-assessment-eval, Property 5: claimStatus totality', () => {
  it("claimStatus is 'identified' iff there is at least one Claim, and subjects match", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(prob, { maxLength: 8 }), prob, async (classify, assessP) => {
        const context = contextOf(classify.length);
        const { claims, assessment } = await assess(
          context,
          ConfigDefaults,
          stubGateway(classify, assessP),
        );

        expect(assessment.claimStatus).toBe(claims.length > 0 ? 'identified' : 'not_identified');

        if (claims.length > 0) {
          expect(assessment.subjects.map((s) => s.id)).toEqual(claims.map((c) => c.id));
          expect(assessment.subjects.every((s) => s.kind === 'claim')).toBe(true);
        } else {
          expect(assessment.subjects).toHaveLength(1);
          expect(assessment.subjects[0]!.kind).toBe('change');
          expect(assessment.subjects[0]!.id).toBe('change');
        }
      }),
      { numRuns: 100 },
    );
  });
});
