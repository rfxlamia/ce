import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog.js';
import { HybridJevGateway } from '../gateway.js';
import type { CallLog } from '../log.js';
import type { JsonTransport } from '../transport-json.js';
import type { SdkTransport } from '../transport-sdk.js';
import type { Jev_Request, RawSystemOneResult } from '../types.js';

// Feature: jev-gateway, Property 12: `modelIds()` is an order-preserving set
// **Validates: Requirements 8.2, 8.5, 8.7**

const REQUESTED_MODEL = 'typesafe/jev-1.14';

// A small alphabet forces many repeats. Returned ids are dated, so they differ from the requested name.
const modelId = fc.constantFrom(
  'typesafe/jev-1.14-20261014',
  'typesafe/jev-1.14-20261101',
  'typesafe/jev-1.15-20270102',
  'typesafe/jev-2.0-20270301',
  'other/model-a',
);

const sequence = fc.array(modelId, { minLength: 0, maxLength: 30 });

function textRequest(): Jev_Request {
  return {
    stage: 'assessment',
    state: 'claim: the button turns green',
    questions: { is_behavior: CATALOG.claimIsBehavior.built() },
  };
}

/** Independent model: distinct values in order of first appearance. */
function firstAppearanceOrder(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function makeGateway(ids: string[]): HybridJevGateway {
  let next = 0;
  const sdkTransport: SdkTransport = {
    send: (): Promise<RawSystemOneResult> => {
      const model = ids[next] as string;
      next += 1;
      return Promise.resolve({
        model,
        answers: { is_behavior: { type: 'noul', noul: 0.5 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  };
  const jsonTransport: JsonTransport = {
    send: () => Promise.reject(new Error('JSON transport must not be used for text requests')),
  };
  const callLog: CallLog = { append: () => Promise.resolve() };
  return new HybridJevGateway({
    sdkTransport,
    jsonTransport,
    callLog,
    provider: 'openrouter',
    requestedModel: REQUESTED_MODEL,
    sleep: () => Promise.resolve(),
  });
}

describe('Property 12: modelIds() is an order-preserving set', () => {
  it('returns each distinct returned model id once, in order of first appearance', async () => {
    await fc.assert(
      fc.asyncProperty(sequence, async (ids) => {
        const gateway = makeGateway(ids);
        expect(gateway.modelIds()).toEqual([]);

        for (const [index, id] of ids.entries()) {
          const response = await gateway.ask(textRequest());
          expect(response.model).toBe(id);
          // The prefix invariant holds after every call, not just at the end.
          expect(gateway.modelIds()).toEqual(firstAppearanceOrder(ids.slice(0, index + 1)));
        }

        const result = gateway.modelIds();
        expect(result).toEqual(firstAppearanceOrder(ids));
        expect(new Set(result).size).toBe(result.length);
        // The requested model name is never what is recorded.
        expect(result).not.toContain(REQUESTED_MODEL);
        expect(gateway.requestedModel).toBe(REQUESTED_MODEL);
      }),
      { numRuns: 100 },
    );
  });

  it('returns a copy, so mutating the result does not change the gateway', async () => {
    const gateway = makeGateway(['a/x-1', 'a/x-2']);
    await gateway.ask(textRequest());
    gateway.modelIds().push('tampered');
    await gateway.ask(textRequest());
    expect(gateway.modelIds()).toEqual(['a/x-1', 'a/x-2']);
  });
});
