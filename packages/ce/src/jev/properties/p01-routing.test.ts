import { image, withAssets } from '@typesafe-ai/sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Stage } from '../../errors.js';
import { CATALOG } from '../catalog.js';
import { HybridJevGateway } from '../gateway.js';
import type { CallLog, CallLogEntry } from '../log.js';
import type { JsonTransport } from '../transport-json.js';
import { JsonTransportError } from '../transport-json.js';
import type { SdkTransport } from '../transport-sdk.js';
import type { Jev_Request, RawSystemOneResult } from '../types.js';

// NOTE for architecture test (task 13.3): this test file calls image/withAssets
// directly to build image states. Test files must be excluded from the
// "only jev/catalog.ts may call image/withAssets" check.

const stages: readonly Stage[] = ['context', 'assessment', 'runtime', 'evidence'];

interface Rig {
  gateway: HybridJevGateway;
  sdkCalls: Jev_Request[];
  jsonCalls: Jev_Request[];
  entries: CallLogEntry[];
}

/**
 * Stub transports answer every question with a valid noul answer. The first `failures` calls to
 * either transport raise a 429, so the retry loop makes `failures + 1` attempts.
 */
function rig(failures: number): Rig {
  const sdkCalls: Jev_Request[] = [];
  const jsonCalls: Jev_Request[] = [];
  const entries: CallLogEntry[] = [];
  let seen = 0;

  const respond = (request: Jev_Request): RawSystemOneResult => {
    seen += 1;
    if (seen <= failures) throw new JsonTransportError('http', 'rate limited', { status: 429 });
    const answers: Record<string, unknown> = {};
    for (const name of Object.keys(request.questions)) answers[name] = { type: 'noul', noul: 0.5 };
    return { model: 'typesafe/jev-1.14-2026-01-01', answers, usage: { input_tokens: 1, output_tokens: 1 } };
  };
  const sdkTransport: SdkTransport = {
    send: (request) => {
      sdkCalls.push(request);
      return Promise.resolve().then(() => respond(request));
    },
  };
  const jsonTransport: JsonTransport = {
    send: (request) => {
      jsonCalls.push(request);
      return Promise.resolve().then(() => respond(request));
    },
  };
  const callLog: CallLog = {
    append: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  };
  const gateway = new HybridJevGateway({
    sdkTransport,
    jsonTransport,
    callLog,
    provider: 'openrouter',
    requestedModel: 'typesafe/jev-1.14',
    maxRateLimitRetries: 2,
    maxTransientRetries: 2,
    sleep: () => Promise.resolve(),
  });
  return { gateway, sdkCalls, jsonCalls, entries };
}

const text = fc.string({ maxLength: 40 });
const bytes = fc.uint8Array({ minLength: 1, maxLength: 32 });

type Shape =
  | { kind: 'plain'; claim: string }
  | { kind: 'no-asset-template'; claim: string }
  | { kind: 'image'; claim: string; pngs: Uint8Array[]; position: 'start' | 'end' };

const shape: fc.Arbitrary<Shape> = fc.oneof(
  text.map((claim): Shape => ({ kind: 'plain', claim })),
  text.map((claim): Shape => ({ kind: 'no-asset-template', claim })),
  fc.record({
    kind: fc.constant('image' as const),
    claim: text,
    pngs: fc.array(bytes, { minLength: 1, maxLength: 3 }),
    position: fc.constantFrom('start' as const, 'end' as const),
  }),
);

function buildState(s: Shape): Jev_Request['state'] {
  switch (s.kind) {
    case 'plain':
      return s.claim;
    case 'no-asset-template':
      return withAssets`claim: ${s.claim}`;
    case 'image': {
      const [a, b, c] = s.pngs.map((p) => image(p));
      const first = a!;
      if (b === undefined) {
        return s.position === 'start'
          ? withAssets`${first}\nclaim: ${s.claim}`
          : withAssets`claim: ${s.claim}\nscreenshot: ${first}`;
      }
      if (c === undefined) return withAssets`claim: ${s.claim}\n${first}\n${b}`;
      return withAssets`claim: ${s.claim}\n${first}\n${b}\n${c}`;
    }
  }
}

const questionSets: ReadonlyArray<() => Jev_Request['questions']> = [
  () => ({ is_behavior: CATALOG.claimIsBehavior.built() }),
  () => ({ runtime_observable: CATALOG.assessRuntimeObservable.built() }),
  () => ({
    a: CATALOG.assessRuntimeObservable.built(),
    b: CATALOG.assessChecksAdequate.built(),
  }),
];

describe('jev-gateway properties', () => {
  // Feature: jev-gateway, Property 1: Transport routing is total, exclusive and content-determined
  // **Validates: Requirements 1.3, 1.4, 1.5, 1.9, 19.9**
  it('Property 1: each attempt calls exactly one transport, the JSON transport iff the request carries an image', async () => {
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.constantFrom(...stages),
        fc.nat(questionSets.length - 1),
        fc.integer({ min: 0, max: 2 }),
        async (s, stage, setIndex, failures) => {
          const { gateway, sdkCalls, jsonCalls, entries } = rig(failures);
          const request: Jev_Request = {
            stage,
            state: buildState(s),
            questions: questionSets[setIndex]!(),
          };
          const expectJson = s.kind === 'image';

          const response = await gateway.ask(request);
          expect(response.model).toBe('typesafe/jev-1.14-2026-01-01');

          const chosen = expectJson ? jsonCalls : sdkCalls;
          const other = expectJson ? sdkCalls : jsonCalls;

          // Exclusive and total: one transport per attempt, never the other one.
          expect(other).toHaveLength(0);
          expect(chosen).toHaveLength(failures + 1);
          for (const call of chosen) expect(call).toBe(request);

          // The call log records the same transport, one entry per ask.
          expect(entries).toHaveLength(1);
          expect(entries[0]?.transport).toBe(expectJson ? 'json' : 'sdk');
          expect(entries[0]?.attempts).toBe(failures + 1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
