import { image, withAssets } from '@typesafe-ai/sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog.js';
import { HybridJevGateway } from '../gateway.js';
import type { CallLog } from '../log.js';
import type { SdkTransport } from '../transport-sdk.js';
import { JsonTransportError, createJsonTransport } from '../transport-json.js';
import type { JsonTransport } from '../transport-json.js';
import type { BuiltCatalogQuestion, Jev_Request, RawSystemOneResult } from '../types.js';

// NOTE for architecture test (task 13.3): this test file calls image/withAssets directly to build
// image requests with arbitrary question names. Test files must be excluded from the
// "only jev/catalog.ts may call image/withAssets" check.

const noopLog: CallLog = { append: () => Promise.resolve() };
const noSleep = (): Promise<void> => Promise.resolve();

/** 1 to 6 distinct question names. The prefix keeps them away from `__proto__` and friends. */
const names = fc
  .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/), { minLength: 1, maxLength: 6 })
  .map((list) => list.map((n) => `q_${n}`));

/** Per name: either a text noul question or (image requests only) a box question. */
const kinds = fc.array(fc.boolean(), { minLength: 6, maxLength: 6 });

const pngBody = fc.uint8Array({ minLength: 0, maxLength: 32 }).map((rest) => {
  const out = new Uint8Array(4 + rest.length);
  out.set([0x89, 0x50, 0x4e, 0x47]);
  out.set(rest, 4);
  return out;
});

function textRequest(list: string[]): Jev_Request {
  const questions: Record<string, BuiltCatalogQuestion> = {};
  for (const name of list) questions[name] = CATALOG.assessRuntimeObservable.built();
  return { stage: 'runtime', state: 'claim: something', questions };
}

function imageRequest(list: string[], boxes: boolean[], png: Uint8Array): Jev_Request {
  const questions: Record<string, BuiltCatalogQuestion> = {};
  list.forEach((name, i) => {
    questions[name] = boxes[i] === true
      ? CATALOG.runtimeLocateSubject.built()
      : CATALOG.runtimeStateReached.built();
  });
  const state = withAssets`claim: x\nscreenshot: ${image(png)}`;
  return { stage: 'runtime', state, questions };
}

function answersFor(request: Jev_Request): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const [name, built] of Object.entries(request.questions)) {
    answers[name] =
      built.type === 'box'
        ? { type: 'box', box: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 }, confidence: 0.5 }
        : { type: 'noul', noul: 0.5 };
  }
  return answers;
}

function okResult(request: Jev_Request): RawSystemOneResult {
  return {
    model: 'typesafe/jev-1.14-test',
    answers: answersFor(request),
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function makeGateway(
  sdkTransport: SdkTransport,
  jsonTransport: JsonTransport,
  extra: { maxTransientRetries?: number; maxRateLimitRetries?: number } = {},
): HybridJevGateway {
  return new HybridJevGateway({
    sdkTransport,
    jsonTransport,
    callLog: noopLog,
    provider: 'openrouter',
    requestedModel: 'typesafe/jev-1.14',
    sleep: noSleep,
    ...extra,
  });
}

const unusedJson: JsonTransport = {
  send: () => Promise.reject(new Error('json transport must not be used')),
};
const unusedSdk: SdkTransport = {
  send: () => Promise.reject(new Error('sdk transport must not be used')),
};

describe('jev-gateway properties', () => {
  // Feature: jev-gateway, Property 2: One Jev_Request produces one HTTP request per attempt
  // **Validates: Requirements 1.6, 2.7, 7.1**
  it('Property 2: a Text_Request invokes the SDK transport once per attempt', async () => {
    await fc.assert(
      fc.asyncProperty(names, fc.nat({ max: 2 }), async (list, failures) => {
        const request = textRequest(list);
        const seen: string[][] = [];
        let calls = 0;
        const sdk: SdkTransport = {
          send(req) {
            calls += 1;
            seen.push(Object.keys(req.questions));
            if (calls <= failures) {
              return Promise.reject(
                new JsonTransportError('http', 'HTTP 500', { status: 500 }),
              );
            }
            return Promise.resolve(okResult(req));
          },
        };
        const gateway = makeGateway(sdk, unusedJson, { maxTransientRetries: 2 });
        const response = await gateway.ask(request);

        expect(calls).toBe(failures + 1);
        for (const keys of seen) expect([...keys].sort()).toEqual([...list].sort());
        expect(Object.keys(response.answers).sort()).toEqual([...list].sort());
      }),
      { numRuns: 100 },
    );
  });

  // Feature: jev-gateway, Property 2: One Jev_Request produces one HTTP request per attempt
  // **Validates: Requirements 1.6, 2.7, 7.1**
  it('Property 2: an Image_Request sends one JSON HTTP request per attempt holding exactly the given question names', async () => {
    await fc.assert(
      fc.asyncProperty(names, kinds, pngBody, fc.nat({ max: 2 }), async (list, boxes, png, limited) => {
        const request = imageRequest(list, boxes, png);
        const bodies: Array<{ questions: Record<string, unknown> }> = [];
        const urls: string[] = [];
        let fetches = 0;
        const fakeFetch = (input: string, init: RequestInit): Promise<Response> => {
          fetches += 1;
          urls.push(input);
          bodies.push(JSON.parse(String(init.body)) as { questions: Record<string, unknown> });
          if (fetches <= limited) {
            return Promise.resolve(
              new Response('slow down', { status: 429, headers: { 'retry-after-ms': '1' } }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify(okResult(request)), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        };
        const json = createJsonTransport({
          baseURL: 'https://example.invalid/api',
          apiKey: 'test-key',
          requestedModel: 'typesafe/jev-1.14',
          provider: 'openrouter',
          fetch: fakeFetch,
        });
        const gateway = makeGateway(unusedSdk, json, { maxRateLimitRetries: 2 });
        const response = await gateway.ask(request);

        // One HTTP request per attempt: the 429s plus the final success.
        expect(fetches).toBe(limited + 1);
        expect(bodies).toHaveLength(fetches);
        for (const url of urls) expect(url).toBe('https://example.invalid/api/v1/systemone');
        // Every body holds exactly the given names: none lost, none duplicated, none extra.
        for (const body of bodies) {
          const keys = Object.keys(body.questions);
          expect(keys).toHaveLength(list.length);
          expect(new Set(keys).size).toBe(keys.length);
          expect([...keys].sort()).toEqual([...list].sort());
        }
        expect(Object.keys(response.answers).sort()).toEqual([...list].sort());
      }),
      { numRuns: 100 },
    );
  });

  // Feature: jev-gateway, Property 2: One Jev_Request produces one HTTP request per attempt
  // **Validates: Requirements 1.6, 2.7, 7.1**
  it('Property 2: a non-retried Image_Request failure still makes exactly one HTTP request', async () => {
    await fc.assert(
      fc.asyncProperty(names, kinds, pngBody, async (list, boxes, png) => {
        const request = imageRequest(list, boxes, png);
        let fetches = 0;
        const json = createJsonTransport({
          baseURL: 'https://example.invalid/api',
          apiKey: 'test-key',
          requestedModel: 'typesafe/jev-1.14',
          provider: 'openrouter',
          fetch: () => {
            fetches += 1;
            return Promise.resolve(new Response('boom', { status: 500 }));
          },
        });
        const gateway = makeGateway(unusedSdk, json, { maxTransientRetries: 2 });
        await expect(gateway.ask(request)).rejects.toThrow();
        expect(fetches).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
