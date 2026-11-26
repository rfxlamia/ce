import { describe, expect, it } from 'vitest';
import type { ChangeContext } from '../context/types.js';
import { buildClassificationRequest } from '../jev/catalog.js';
import { FakeJevGateway } from '../jev/fake.js';
import type { Recording } from '../jev/fake.js';
import type { AskOptions, JevGateway } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import { identifyClaims } from './claims.js';
import type { AssessmentSettings } from './types.js';

const settings: AssessmentSettings = {
  claimThreshold: 0.5,
  observableThreshold: 0.5,
  adequateThreshold: 0.5,
  uncertaintyBand: 0.1,
  onUncertain: 'evidence',
};

function makeContext(candidates: ChangeContext['candidates']): ChangeContext {
  return {
    change: {
      title: 'Add login form',
      files: [
        {
          path: 'src/login.ts',
          status: 'modified',
          patch: '+x',
          provenance: { provider: 'git' },
        },
      ],
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
}

function recordingFor(
  context: ChangeContext,
  candidate: { id: string; text: string },
  noul: number,
): Recording {
  const { request } = buildClassificationRequest(context, candidate);
  return {
    idVersion: 'claim.is_behavior@1',
    stateHash: stateHash(request.state),
    question: 'is_behavior',
    answer: { type: 'noul', noul } as Recording['answer'],
  };
}

/** Counts every request that reaches the wrapped gateway. */
function counting(inner: JevGateway): JevGateway & { requests: number } {
  const wrapper = {
    requests: 0,
    async ask(request: Jev_Request, options?: AskOptions) {
      wrapper.requests += 1;
      return inner.ask(request, options);
    },
  };
  return wrapper;
}

describe('identifyClaims', () => {
  it('turns a candidate exactly at the claim threshold into a Claim', async () => {
    const candidate = {
      id: 'c1',
      text: 'Users can log in',
      provenance: { provider: 'github' as const },
    };
    const context = makeContext([candidate]);
    const gateway = new FakeJevGateway([recordingFor(context, candidate, settings.claimThreshold)]);

    const result = await identifyClaims(context, settings, gateway);

    expect(result.claims).toEqual([
      {
        id: 'c1',
        text: 'Users can log in',
        probability: 0.5,
        declared: false,
        provenance: { provider: 'github' },
      },
    ]);
    expect(result.classifications).toEqual([
      { candidateId: 'c1', probability: 0.5, becameClaim: true },
    ]);
  });

  it('makes a Declared_Claim from a cli candidate without sending a request', async () => {
    const candidate = {
      id: 'c1',
      text: 'The export button works',
      provenance: { provider: 'cli' as const },
    };
    const context = makeContext([candidate]);
    const gateway = counting(new FakeJevGateway([]));

    const result = await identifyClaims(context, settings, gateway);

    expect(gateway.requests).toBe(0);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]).toMatchObject({
      id: 'c1',
      text: 'The export button works',
      probability: null,
      declared: true,
    });
    expect(result.classifications).toEqual([]);
    expect(result.questionsAsked).toEqual([]);
  });

  it('records a below-threshold candidate in classifications but does not make it a Claim', async () => {
    const candidate = {
      id: 'c1',
      text: 'Refactor internal helper',
      provenance: { provider: 'git' as const },
    };
    const context = makeContext([candidate]);
    const gateway = new FakeJevGateway([recordingFor(context, candidate, 0.49)]);

    const result = await identifyClaims(context, settings, gateway);

    expect(result.claims).toEqual([]);
    expect(result.classifications).toEqual([
      { candidateId: 'c1', probability: 0.49, becameClaim: false },
    ]);
  });
});
