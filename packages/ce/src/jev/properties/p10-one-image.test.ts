import { image, withAssets } from '@typesafe-ai/sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog.js';
import { JevUsageError } from '../errors.js';
import { HybridJevGateway } from '../gateway.js';
import type { CallLog, CallLogEntry } from '../log.js';
import type { SdkTransport } from '../transport-sdk.js';
import type { JsonTransport } from '../transport-json.js';
import type { Jev_Request, RawSystemOneResult } from '../types.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function textRequest(tag: number): Jev_Request {
  return {
    stage: 'runtime',
    state: `claim: text ${tag}`,
    questions: { q: CATALOG.assessRuntimeObservable.built() },
  };
}

function imageRequest(tag: number): Jev_Request {
  return {
    stage: 'runtime',
    state: withAssets`claim: ${tag}\nscreenshot: ${image(PNG)}`,
    questions: { q: CATALOG.runtimeStateReached.built() },
  };
}

function okResult(): RawSystemOneResult {
  return {
    model: 'typesafe/jev-1.14-test',
    answers: { q: { type: 'noul', noul: 0.5 } },
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

interface Rig {
  gateway: HybridJevGateway;
  sdkCalls: () => number;
  jsonCalls: () => number;
  entries: CallLogEntry[];
}

function makeRig(): Rig {
  let sdk = 0;
  let json = 0;
  const entries: CallLogEntry[] = [];
  const sdkTransport: SdkTransport = {
    send: () => {
      sdk += 1;
      return Promise.resolve(okResult());
    },
  };
  const jsonTransport: JsonTransport = {
    send: () => {
      json += 1;
      return Promise.resolve(okResult());
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
    sleep: () => Promise.resolve(),
  });
  return { gateway, sdkCalls: () => sdk, jsonCalls: () => json, entries };
}

/** A sequence of request kinds (true = image) holding at least two images, mixed with text. */
const sequences = fc
  .array(fc.boolean(), { minLength: 2, maxLength: 12 })
  .filter((seq) => seq.filter(Boolean).length >= 2);

function build(seq: boolean[]): Jev_Request[] {
  return seq.map((isImage, i) => (isImage ? imageRequest(i) : textRequest(i)));
}

function check(
  seq: boolean[],
  settled: PromiseSettledResult<unknown>[],
  rig: Rig,
): void {
  const images = seq.filter(Boolean).length;
  const texts = seq.length - images;
  const firstImage = seq.indexOf(true);
  seq.forEach((isImage, i) => {
    const result = settled[i] as PromiseSettledResult<unknown>;
    if (isImage && i !== firstImage) {
      expect(result.status).toBe('rejected');
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(JevUsageError);
    } else {
      expect(result.status).toBe('fulfilled');
    }
  });
  // Transports see only the first image and every text request.
  expect(rig.jsonCalls()).toBe(1);
  expect(rig.sdkCalls()).toBe(texts);
  // Rejected requests leave no call-log entry.
  expect(rig.entries).toHaveLength(texts + 1);
  expect(rig.entries.filter((e) => e.transport === 'json')).toHaveLength(1);
  expect(images).toBeGreaterThanOrEqual(2);
}

describe('jev-gateway properties', () => {
  // Feature: jev-gateway, Property 10: At most one Image_Request per gateway instance
  // **Validates: Requirements 7.11**
  it('Property 10: sequential interleavings reject every image after the first', async () => {
    await fc.assert(
      fc.asyncProperty(sequences, async (seq) => {
        const rig = makeRig();
        const settled: PromiseSettledResult<unknown>[] = [];
        for (const request of build(seq)) {
          const [result] = await Promise.allSettled([rig.gateway.ask(request)]);
          settled.push(result as PromiseSettledResult<unknown>);
        }
        check(seq, settled, rig);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: jev-gateway, Property 10: At most one Image_Request per gateway instance
  // **Validates: Requirements 7.11**
  it('Property 10: concurrent interleavings reject every image after the first submitted', async () => {
    await fc.assert(
      fc.asyncProperty(sequences, async (seq) => {
        const rig = makeRig();
        const settled = await Promise.allSettled(build(seq).map((r) => rig.gateway.ask(r)));
        check(seq, settled, rig);
      }),
      { numRuns: 100 },
    );
  });
});
