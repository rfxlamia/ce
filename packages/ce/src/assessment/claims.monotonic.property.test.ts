import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { ChangeContext } from '../context/types.js';
import { identifyClaims } from './claims.js';
import type { AssessmentSettings } from './types.js';

// Feature: claims-assessment-eval, Property 4: Claim threshold monotonicity
// **Validates: Requirements 2.1, 2.2, 2.9**

const prob = fc.double({ min: 0, max: 1, noNaN: true });

function contextOf(count: number): ChangeContext {
  return {
    change: {
      title: 'change',
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

/** Answers the n-th Classification_Request with probabilities[n]. */
function gatewayOf(probabilities: readonly number[]): JevGateway {
  let n = 0;
  return {
    async ask() {
      const noul = probabilities[n++]!;
      return {
        model: 'fake-model',
        answers: { is_behavior: { type: 'noul', noul } },
        usage: { input_tokens: null, output_tokens: null },
      } as unknown as Jev_Response;
    },
  };
}

function settingsAt(claimThreshold: number): AssessmentSettings {
  return {
    claimThreshold,
    observableThreshold: 0.6,
    adequateThreshold: 0.7,
    uncertaintyBand: 0.1,
    onUncertain: 'evidence',
  };
}

describe('Feature: claims-assessment-eval, Property 4: Claim threshold monotonicity', () => {
  it('raising claimThreshold never adds claims, and a candidate is a claim iff p >= threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(prob, { maxLength: 8 }),
        prob,
        prob,
        async (probabilities, a, b) => {
          const [t1, t2] = a <= b ? [a, b] : [b, a];
          const context = contextOf(probabilities.length);

          const low = await identifyClaims(context, settingsAt(t1), gatewayOf(probabilities));
          const high = await identifyClaims(context, settingsAt(t2), gatewayOf(probabilities));

          const lowIds = new Set(low.claims.map((c) => c.id));
          for (const c of high.claims) expect(lowIds.has(c.id)).toBe(true);
          expect(high.claims.length).toBeLessThanOrEqual(low.claims.length);

          for (const [result, t] of [
            [low, t1],
            [high, t2],
          ] as const) {
            const claimIds = new Set(result.claims.map((c) => c.id));
            probabilities.forEach((p, i) => {
              expect(claimIds.has(`c${i}`)).toBe(p >= t);
            });
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
