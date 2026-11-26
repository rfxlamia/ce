import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ChangeContext, Provenance } from '../context/types.js';
import { buildClassificationRequest } from '../jev/catalog.js';
import { FakeJevGateway, type Recording } from '../jev/fake.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import { identifyClaims } from './claims.js';
import type { AssessmentSettings } from './types.js';

// Feature: claims-assessment-eval, Property 1: Classification request cardinality and exclusion
// **Validates: Requirements 1.1, 1.8, 2.3**

const settings: AssessmentSettings = {
  claimThreshold: 0.5,
  observableThreshold: 0.5,
  adequateThreshold: 0.5,
  uncertaintyBand: 0.1,
  onUncertain: 'evidence',
};

const providerArb = fc.constantFrom<Provenance['provider']>(
  'git',
  'github',
  'cli',
  'junit',
  'config',
  'runtime',
);

const candidatesArb = fc.array(
  fc.record({
    text: fc.string({ minLength: 1, maxLength: 40 }),
    provider: providerArb,
    probability: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  { maxLength: 8 },
);

/** Wraps a gateway and records every request that reaches it. */
class CountingGateway implements JevGateway {
  readonly requests: Jev_Request[] = [];
  constructor(private readonly inner: JevGateway) {}
  async ask(request: Jev_Request, options?: AskOptions): Promise<Jev_Response> {
    this.requests.push(request);
    return this.inner.ask(request, options);
  }
}

describe('Feature: claims-assessment-eval, Property 1: Classification request cardinality and exclusion', () => {
  it('sends exactly one classification request per non-cli candidate and none for cli', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidatesArb,
        fc.string({ maxLength: 20 }),
        async (generated, title) => {
          const candidates = generated.map((g, i) => ({
            id: `c${i}`,
            text: g.text,
            provenance: { provider: g.provider } as Provenance,
          }));
          const context: ChangeContext = {
            change: { title, files: [], commits: [], claims: [], provenance: [] },
            candidates,
            checks: [],
            truncated: [],
            providers: [],
            redactions: [],
          };

          const recordings: Recording[] = [];
          candidates.forEach((candidate, i) => {
            if (candidate.provenance.provider === 'cli') return;
            const { request } = buildClassificationRequest(context, candidate);
            recordings.push({
              idVersion: request.questions['is_behavior']!.idVersion,
              stateHash: stateHash(request.state),
              question: 'is_behavior',
              answer: { type: 'noul', noul: generated[i]!.probability } as never,
            });
          });

          const gateway = new CountingGateway(new FakeJevGateway(recordings));
          const result = await identifyClaims(context, settings, gateway);

          const nonCli = candidates.filter((c) => c.provenance.provider !== 'cli');
          const cli = candidates.filter((c) => c.provenance.provider === 'cli');

          // Exactly one request per non-cli candidate (none at all when there are none).
          expect(gateway.requests).toHaveLength(nonCli.length);
          expect(result.classifications.map((c) => c.candidateId)).toEqual(nonCli.map((c) => c.id));
          expect(result.questionsAsked).toHaveLength(nonCli.length);

          // The requests sent are exactly those built for the non-cli candidates.
          const expectedStates = nonCli.map(
            (c) => buildClassificationRequest(context, c).request.state,
          );
          expect(gateway.requests.map((r) => r.state)).toEqual(expectedStates);

          // cli candidates are Declared_Claims with probability null and are never classified.
          for (const c of cli) {
            const claim = result.claims.find((x) => x.id === c.id);
            expect(claim).toBeDefined();
            expect(claim!.declared).toBe(true);
            expect(claim!.probability).toBeNull();
            expect(result.classifications.some((x) => x.candidateId === c.id)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
