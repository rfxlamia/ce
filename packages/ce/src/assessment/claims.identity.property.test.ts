import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ChangeContext, ClaimCandidate } from '../context/types.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { identifyClaims } from './claims.js';
import type { AssessmentSettings } from './types.js';

// Feature: claims-assessment-eval, Property 3: Claim identity and order
// **Validates: Requirements 1.7, 2.4**

const PROVIDERS = ['git', 'github', 'cli', 'junit', 'config'] as const;

const candidatesArb: fc.Arbitrary<ClaimCandidate[]> = fc
  .array(
    fc.record({
      text: fc.string({ maxLength: 80 }),
      provider: fc.constantFrom(...PROVIDERS),
      probability: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { maxLength: 12 },
  )
  .map((items) =>
    items.map((item, i) => ({
      id: `c${i}`,
      text: item.text,
      provenance: { provider: item.provider },
      // carried alongside for the stub gateway
      _p: item.probability,
    })),
  ) as unknown as fc.Arbitrary<ClaimCandidate[]>;

function settings(claimThreshold: number): AssessmentSettings {
  return {
    claimThreshold,
    observableThreshold: 0.5,
    adequateThreshold: 0.5,
    uncertaintyBand: 0.1,
    onUncertain: 'evidence',
  };
}

describe('Property 3: Claim identity and order', () => {
  it('keeps candidate text and id, preserves order, and invents no claims', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidatesArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        async (candidates, threshold) => {
          // The stub answers sequentially, one noul per classified (non-cli) candidate.
          const queue = candidates
            .filter((c) => c.provenance.provider !== 'cli')
            .map((c) => (c as unknown as { _p: number })._p);
          const gateway: JevGateway = {
            async ask(): Promise<Jev_Response> {
              const p = queue.shift();
              if (p === undefined) throw new Error('unexpected extra Jev call');
              return {
                model: 'stub-model',
                answers: { is_behavior: { type: 'noul', noul: p } },
                usage: { input_tokens: 0, output_tokens: 0 },
              } as unknown as Jev_Response;
            },
          };
          const context = {
            change: { files: [], commits: [], claims: [], provenance: [] },
            candidates,
            checks: [],
            truncated: [],
            providers: [],
            redactions: [],
          } as unknown as ChangeContext;

          const { claims } = await identifyClaims(context, settings(threshold), gateway);

          const byId = new Map(candidates.map((c) => [c.id, c]));
          // identity: same id, same text, no invented claims
          for (const claim of claims) {
            const source = byId.get(claim.id);
            expect(source).toBeDefined();
            expect(claim.text).toBe(source!.text);
          }
          expect(claims.length).toBeLessThanOrEqual(candidates.length);
          expect(new Set(claims.map((c) => c.id)).size).toBe(claims.length);

          // order: claims equal the candidates filtered to those that became claims
          const claimIds = new Set(claims.map((c) => c.id));
          expect(claims.map((c) => c.id)).toEqual(
            candidates.filter((c) => claimIds.has(c.id)).map((c) => c.id),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
