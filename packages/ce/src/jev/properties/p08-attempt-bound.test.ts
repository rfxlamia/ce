import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CATALOG, finalImageQuestions } from '../catalog.js';
import { HybridJevGateway } from '../gateway.js';
import type { CallLog, CallLogEntry } from '../log.js';
import { JsonTransportError } from '../transport-json.js';
import type { JsonTransport } from '../transport-json.js';
import type { SdkTransport } from '../transport-sdk.js';
import type { Jev_Request, RawSystemOneResult } from '../types.js';

// Feature: jev-gateway, Property 8: Retry and attempt counts are always bounded, and the bound differs by request kind
// **Validates: Requirements 7.5, 7.6, 7.7, 7.10, 7.16, 7.18, 7.20**

/** One simulated HTTP outcome. */
type Step =
  | { kind: 'ok' }
  | { kind: 'rate_limit'; retryAfterMs: number | undefined }
  | { kind: 'transient'; variant: 'http500' | 'http408' | 'timeout' | 'connection'; retryAfterMs: number | undefined }
  | { kind: 'fatal'; status: 400 | 404 | 422 };

const retryAfter = fc.option(
  fc.oneof(fc.integer({ min: 0, max: 60_000 }), fc.integer({ min: 60_001, max: 600_000 })),
  { nil: undefined },
);

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.constant<Step>({ kind: 'ok' }),
  retryAfter.map((retryAfterMs): Step => ({ kind: 'rate_limit', retryAfterMs })),
  fc
    .tuple(fc.constantFrom('http500', 'http408', 'timeout', 'connection'), retryAfter)
    // Only HTTP failures carry a server delay; timeouts and connection failures never do.
    .map(([variant, retryAfterMs]): Step => ({
      kind: 'transient',
      variant,
      retryAfterMs: variant === 'http500' || variant === 'http408' ? retryAfterMs : undefined,
    })),
  fc.constantFrom(400, 404, 422).map((status): Step => ({ kind: 'fatal', status })),
);

// The last step repeats once the script runs out, so a run of 429s or 5xxs can be unbounded in length.
const script = fc.array(step, { minLength: 1, maxLength: 12 });

const retries = fc.integer({ min: 0, max: 4 });

const MAX_RETRY_DELAY_MS = 60_000;

function throwFor(s: Exclude<Step, { kind: 'ok' }>): never {
  switch (s.kind) {
    case 'rate_limit':
      throw new JsonTransportError('http', 'rate limited', {
        status: 429,
        ...(s.retryAfterMs !== undefined ? { retryAfterMs: s.retryAfterMs } : {}),
      });
    case 'transient':
      if (s.variant === 'timeout') throw new JsonTransportError('timeout', 'timed out');
      if (s.variant === 'connection') throw new JsonTransportError('connection', 'connection failed');
      throw new JsonTransportError('http', 'transient', {
        status: s.variant === 'http500' ? 500 : 408,
        ...(s.retryAfterMs !== undefined ? { retryAfterMs: s.retryAfterMs } : {}),
      });
    case 'fatal':
      throw new JsonTransportError('http', 'fatal', { status: s.status });
  }
}

function textRequest(): Jev_Request {
  return {
    stage: 'assessment',
    state: 'claim: the button turns green',
    questions: { is_behavior: CATALOG.claimIsBehavior.built() },
  };
}

function imageRequest(): Jev_Request {
  return finalImageQuestions('the button turns green', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3));
}

const TEXT_SUCCESS: RawSystemOneResult = {
  model: 'typesafe/jev-1.14-20261014',
  answers: { is_behavior: { type: 'noul', noul: 0.5 } },
  usage: { input_tokens: 1, output_tokens: 1 },
};

const IMAGE_SUCCESS: RawSystemOneResult = {
  model: 'typesafe/jev-1.14-20261014',
  answers: {
    state_reached: { type: 'noul', noul: 0.5 },
    locate_subject: {
      type: 'box',
      box: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 },
      confidence: 0.5,
    },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** Stub transport: plays the script, repeating its last step, and counts every request sent. */
function scripted(steps: Step[], success: RawSystemOneResult) {
  const state = { requests: 0 };
  const send = (): Promise<RawSystemOneResult> => {
    const s = steps[Math.min(state.requests, steps.length - 1)] as Step;
    state.requests += 1;
    if (s.kind === 'ok') return Promise.resolve(success);
    return Promise.reject(
      (() => {
        try {
          throwFor(s);
        } catch (error) {
          return error;
        }
      })(),
    );
  };
  return { state, send };
}

/** Independent model of the retry rules: the expected number of requests for a script. */
function expectedRequests(kind: 'text' | 'image', steps: Step[], maxRL: number, maxTransient: number): number {
  let sent = 0;
  let rl = 0;
  let transient = 0;
  for (;;) {
    const s = steps[Math.min(sent, steps.length - 1)] as Step;
    sent += 1;
    if (s.kind === 'ok' || s.kind === 'fatal') return sent;
    const delay = s.retryAfterMs;
    if (s.kind === 'rate_limit') {
      if (rl >= maxRL || (delay !== undefined && delay > MAX_RETRY_DELAY_MS)) return sent;
      rl += 1;
    } else {
      if (kind === 'image' || transient >= maxTransient || (delay !== undefined && delay > MAX_RETRY_DELAY_MS)) {
        return sent;
      }
      transient += 1;
    }
  }
}

async function run(kind: 'text' | 'image', steps: Step[], maxRL: number, maxTransient: number) {
  const text = scripted(steps, TEXT_SUCCESS);
  const img = scripted(steps, IMAGE_SUCCESS);
  const sdkTransport: SdkTransport = { send: text.send };
  const jsonTransport: JsonTransport = { send: img.send };
  const entries: CallLogEntry[] = [];
  const callLog: CallLog = {
    append: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  };
  const sleeps: number[] = [];
  const gateway = new HybridJevGateway({
    sdkTransport,
    jsonTransport,
    callLog,
    provider: 'openrouter',
    requestedModel: 'typesafe/jev-1.14',
    maxRateLimitRetries: maxRL,
    maxTransientRetries: maxTransient,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  await gateway
    .ask(kind === 'text' ? textRequest() : imageRequest())
    .then(
      () => undefined,
      () => undefined,
    );
  return {
    requests: kind === 'text' ? text.state.requests : img.state.requests,
    otherRequests: kind === 'text' ? img.state.requests : text.state.requests,
    entries,
    sleeps,
  };
}

describe('Property 8: retry and attempt counts are bounded, and the bound differs by request kind', () => {
  it('a Text_Request sends at most 1 + maxRateLimitRetries + maxTransientRetries requests', async () => {
    await fc.assert(
      fc.asyncProperty(script, retries, retries, async (steps, maxRL, maxTransient) => {
        const r = await run('text', steps, maxRL, maxTransient);

        expect(r.otherRequests).toBe(0);
        expect(r.requests).toBeGreaterThanOrEqual(1);
        expect(r.requests).toBeLessThanOrEqual(1 + maxRL + maxTransient);
        expect(r.requests).toBe(expectedRequests('text', steps, maxRL, maxTransient));

        expect(r.entries).toHaveLength(1);
        expect((r.entries[0] as CallLogEntry).attempts).toBe(r.requests);
        // One wait per retry, none after the last request.
        expect(r.sleeps).toHaveLength(r.requests - 1);
      }),
      { numRuns: 200 },
    );
  });

  it('an Image_Request sends at most 1 + maxRateLimitRetries requests, retried only after a 429', async () => {
    await fc.assert(
      fc.asyncProperty(script, retries, retries, async (steps, maxRL, maxTransient) => {
        const r = await run('image', steps, maxRL, maxTransient);

        expect(r.otherRequests).toBe(0);
        expect(r.requests).toBeGreaterThanOrEqual(1);
        expect(r.requests).toBeLessThanOrEqual(1 + maxRL);
        expect(r.requests).toBe(expectedRequests('image', steps, maxRL, maxTransient));

        expect(r.entries).toHaveLength(1);
        expect((r.entries[0] as CallLogEntry).attempts).toBe(r.requests);
        expect(r.sleeps).toHaveLength(r.requests - 1);

        // Every request but the last was answered by a 429.
        for (let i = 0; i < r.requests - 1; i += 1) {
          expect((steps[Math.min(i, steps.length - 1)] as Step).kind).toBe('rate_limit');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('a transient failure is retried for text but never for an image', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'http500' | 'http408' | 'timeout' | 'connection'>('http500', 'http408', 'timeout', 'connection'),
        retries,
        retries,
        async (variant, maxRL, maxTransient) => {
          const steps: Step[] = [{ kind: 'transient', variant, retryAfterMs: undefined }];
          const text = await run('text', steps, maxRL, maxTransient);
          const img = await run('image', steps, maxRL, maxTransient);
          expect(text.requests).toBe(1 + maxTransient);
          expect(img.requests).toBe(1);
          expect((img.entries[0] as CallLogEntry).attempts).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
