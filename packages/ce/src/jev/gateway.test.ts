import { describe, expect, it } from 'vitest';
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeError,
} from '@typesafe-ai/sdk';
import { CATALOG, finalImageQuestions } from './catalog.js';
import { JevImageError, JevUsageError, RateLimitError } from './errors.js';
import { HybridJevGateway } from './gateway.js';
import type { HybridJevGatewayOptions } from './gateway.js';
import type { CallLog, CallLogEntry } from './log.js';
import { StageError } from '../errors.js';
import { JsonTransportError } from './transport-json.js';
import type { Jev_Request, RawSystemOneResult } from './types.js';

// Requirements 1.2-1.4, 1.8, 1.10, 1.11, 6.4-6.14, 6.17, 6.18, 7.3, 7.5-7.9, 7.11, 7.12, 7.16,
// 7.18, 8.2-8.4, 8.6, 12.7, 12.8, 19.2, 19.5, 19.6, 19.8, 19.13. Stub transports, injected
// sleep and a stub call log. No network and no API key.

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4);
const PNG_BYTES = new Uint8Array(PNG);

type Step =
  | RawSystemOneResult
  | Error
  | ((attempt: { signal?: AbortSignal; timeoutMs: number }) => Promise<RawSystemOneResult>);

interface StubTransport {
  calls: Array<{ request: Jev_Request; signal?: AbortSignal }>;
  send(
    request: Jev_Request,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<RawSystemOneResult>;
}

/** Plays the steps in order and repeats the last one when they run out. */
function stub(...steps: Step[]): StubTransport {
  const calls: StubTransport['calls'] = [];
  return {
    calls,
    async send(request, options) {
      calls.push({ request, ...(options.signal ? { signal: options.signal } : {}) });
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (step === undefined) throw new Error('stub has no steps');
      if (step instanceof Error) throw step;
      if (typeof step === 'function') return step(options);
      return step;
    },
  };
}

const MODEL = 'typesafe/jev-1.14-20260101';

function textOk(model = MODEL): RawSystemOneResult {
  return {
    model,
    answers: { claim: { type: 'noul', noul: 0.9 } },
    usage: { input_tokens: 10, output_tokens: 2 },
  };
}

function imageOk(): RawSystemOneResult {
  return {
    model: MODEL,
    answers: {
      state_reached: { type: 'noul', noul: 0.8 },
      locate_subject: {
        type: 'box',
        box: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 },
        confidence: 0.5,
      },
    },
    usage: { input_tokens: 100, output_tokens: 4 },
  };
}

function textRequest(): Jev_Request {
  return {
    stage: 'assessment',
    state: 'candidate: the button turns green',
    questions: { claim: CATALOG.claimIsBehavior.built() },
  };
}

function imageRequest(): Jev_Request {
  return finalImageQuestions('the button is green', PNG_BYTES);
}

function http(status: number, message = 'http error', retryAfterMs?: number): JsonTransportError {
  return new JsonTransportError('http', message, {
    status,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

function sdkHttp(status: number, headers: Record<string, string> = {}): APIError {
  return APIError.fromResponse(status, { error: 'x' }, new Headers(headers));
}

interface Harness {
  gateway: HybridJevGateway;
  sdk: StubTransport;
  json: StubTransport;
  entries: CallLogEntry[];
  events: string[];
  waits: number[];
}

function harness(
  steps: { sdk?: Step[]; json?: Step[] } = {},
  options: Partial<HybridJevGatewayOptions> & { logFails?: boolean } = {},
): Harness {
  const sdk = stub(...(steps.sdk ?? [textOk()]));
  const json = stub(...(steps.json ?? [imageOk()]));
  const entries: CallLogEntry[] = [];
  const events: string[] = [];
  const waits: number[] = [];
  const callLog: CallLog = {
    append(entry) {
      events.push('log');
      if (options.logFails === true) return Promise.reject(new Error('disk full'));
      entries.push(entry);
      return Promise.resolve();
    },
  };
  const { logFails: _ignored, ...rest } = options;
  const gateway = new HybridJevGateway({
    sdkTransport: sdk,
    jsonTransport: json,
    callLog,
    provider: 'openrouter',
    requestedModel: 'typesafe/jev-1.14',
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    ...rest,
  });
  return { gateway, sdk, json, entries, events, waits };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

async function imageFailure(step: Step, options: Partial<HybridJevGatewayOptions> = {}) {
  const h = harness({ json: [step] }, options);
  const error = await failureOf(h.gateway.ask(imageRequest()));
  return { h, error };
}

describe('routing', () => {
  it('sends a Text_Request to the SDK transport and an Image_Request to the JSON transport', async () => {
    const h = harness();
    const text = await h.gateway.ask(textRequest());
    expect(text.model).toBe(MODEL);
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.json.calls).toHaveLength(0);
    await h.gateway.ask(imageRequest());
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.json.calls).toHaveLength(1);
    expect(h.entries.map((e) => e.transport)).toEqual(['sdk', 'json']);
  });
});

describe('Image_Request failures', () => {
  it('maps the multipart 400 to JevImageError bad_request', async () => {
    const { error, h } = await imageFailure(
      http(400, 'invalid content-type: multipart/form-data'),
    );
    expect(error).toBeInstanceOf(JevImageError);
    expect(error).not.toBeInstanceOf(StageError);
    expect(error).toMatchObject({ reason: 'bad_request', status: 400 });
    expect(h.json.calls).toHaveLength(1);
  });

  it.each([
    ['timeout', new JsonTransportError('timeout', 't'), 'timeout', undefined],
    ['connection failure', new JsonTransportError('connection', 'c'), 'connection', undefined],
    ['HTTP 500', http(500), 'server', 500],
    ['HTTP 404', http(404), 'client', 404],
    ['HTTP 408', http(408), 'timeout', 408],
    ['abort error', new APIUserAbortError(), 'timeout', undefined],
    ['SDK timeout', new APITimeoutError(1000), 'timeout', undefined],
    ['SDK connection', new APIConnectionError('down'), 'connection', undefined],
    ['local TypeSafeError', new TypeSafeError('local'), 'client', undefined],
    ['invalid image', new JevImageError('invalid_image'), 'invalid_image', undefined],
  ] as const)('classifies %s', async (_name, step, reason, status) => {
    const { error } = await imageFailure(step);
    expect(error).toBeInstanceOf(JevImageError);
    expect(error).toMatchObject({ reason });
    if (status === undefined) expect(error).not.toHaveProperty('status');
    else expect(error).toHaveProperty('status', status);
  });

  it('does not retry an HTTP 500, a timeout or a connection failure', async () => {
    for (const step of [http(500), new JsonTransportError('timeout', 't'), new JsonTransportError('connection', 'c')]) {
      const { h } = await imageFailure(step);
      expect(h.json.calls).toHaveLength(1);
      expect(h.waits).toEqual([]);
      expect(h.entries[0]?.attempts).toBe(1);
    }
  });

  it('reports an answer missing a requested question as invalid_response', async () => {
    const partial = imageOk();
    delete partial.answers['locate_subject'];
    const { error } = await imageFailure(partial);
    expect(error).toMatchObject({ reason: 'invalid_response' });
  });

  it('reports an empty model field as an error', async () => {
    const image = await imageFailure({ ...imageOk(), model: '' });
    expect(image.error).toMatchObject({ reason: 'invalid_response' });
    const h = harness({ sdk: [{ ...textOk(), model: '' }] });
    const error = await failureOf(h.gateway.ask(textRequest()));
    expect(error).toBeInstanceOf(StageError);
    expect(h.gateway.modelIds()).toEqual([]);
  });

  it('lets the JevImageError reach the caller unwrapped for the final-image fallback', async () => {
    const thrown = new JevImageError('invalid_image');
    const { error } = await imageFailure(thrown);
    expect(error).toBeInstanceOf(JevImageError);
    expect(error).not.toBeInstanceOf(StageError);
    const server = await imageFailure(http(503));
    expect(server.error).not.toBeInstanceOf(StageError);
  });
});

describe('authentication', () => {
  it.each([401, 403])('HTTP %i gives a StageError for both request kinds', async (status) => {
    const text = harness({ sdk: [sdkHttp(status)] });
    const textError = await failureOf(text.gateway.ask(textRequest()));
    expect(textError).toBeInstanceOf(StageError);
    expect((textError as StageError).stage).toBe('assessment');
    expect(text.sdk.calls).toHaveLength(1);
    expect(text.entries[0]).toMatchObject({ status: 'error', errorKind: 'auth', httpStatus: status });

    const image = harness({ json: [http(status)] });
    const imageError = await failureOf(image.gateway.ask(imageRequest()));
    expect(imageError).toBeInstanceOf(StageError);
    expect(imageError).not.toBeInstanceOf(JevImageError);
    expect(image.json.calls).toHaveLength(1);
  });
});

describe('Text_Request failures', () => {
  it('wraps the underlying error of a non-retried failure in a StageError', async () => {
    const h = harness({ sdk: [sdkHttp(404)] });
    const error = await failureOf(h.gateway.ask(textRequest()));
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).cause).toBeInstanceOf(APIError);
    expect(h.sdk.calls).toHaveLength(1);
  });

  it('treats HTTP 408 as a transient failure', async () => {
    const h = harness({ sdk: [sdkHttp(408), textOk()] });
    await h.gateway.ask(textRequest());
    expect(h.sdk.calls).toHaveLength(2);
  });
});

describe('rate limits', () => {
  it('waits for retry-after-ms (SDK retryAfterMs, JSON retryAfterMs)', async () => {
    const sdkError = sdkHttp(429, { 'retry-after-ms': '1234' });
    const a = harness({ sdk: [sdkError, textOk()] });
    await a.gateway.ask(textRequest());
    expect(a.waits).toEqual([1234]);

    const b = harness({ json: [http(429, 'rate', 777), imageOk()] });
    await b.gateway.ask(imageRequest());
    expect(b.waits).toEqual([777]);
  });

  it('waits for Retry-After given in seconds', async () => {
    const h = harness({ sdk: [sdkHttp(429, { 'retry-after': '2' }), textOk()] });
    await h.gateway.ask(textRequest());
    expect(h.waits).toEqual([2000]);
  });

  it('uses 500, 1000, 2000, 4000, 5000 ms backoff when no header is sent', async () => {
    const h = harness({ sdk: [sdkHttp(429)] }, { maxRateLimitRetries: 5 });
    await failureOf(h.gateway.ask(textRequest()));
    expect(h.waits).toEqual([500, 1000, 2000, 4000, 5000]);
    expect(h.sdk.calls).toHaveLength(6);
    expect(h.entries[0]?.attempts).toBe(6);
  });

  it('gives a StageError with a RateLimitError cause after a text 429 is exhausted', async () => {
    const h = harness({ sdk: [sdkHttp(429, { 'retry-after-ms': '10' })] });
    const error = await failureOf(h.gateway.ask(textRequest()));
    expect(error).toBeInstanceOf(StageError);
    const cause = (error as StageError).cause;
    expect(cause).toBeInstanceOf(RateLimitError);
    expect((cause as RateLimitError).retryAfterMs).toBe(10);
    expect(h.sdk.calls).toHaveLength(3);
    expect(h.waits).toEqual([10, 10]);
  });

  it('gives JevImageError rate_limited after an image 429 is exhausted', async () => {
    const h = harness({ json: [http(429, 'rate', 50)] });
    const error = await failureOf(h.gateway.ask(imageRequest()));
    expect(error).toBeInstanceOf(JevImageError);
    expect(error).toMatchObject({ reason: 'rate_limited', status: 429, retryAfterMs: 50 });
    expect(h.json.calls).toHaveLength(3);
    expect(h.entries[0]).toMatchObject({ errorKind: 'rate_limited', httpStatus: 429 });
  });

  it('retries a 429 with no delay information from a stub without retryAfterMs', async () => {
    const h = harness({ json: [http(429), imageOk()] });
    await h.gateway.ask(imageRequest());
    expect(h.waits).toEqual([500]);
  });

  it('stops at once when the delay is over 60000 ms, and waits for exactly 60000 ms', async () => {
    const over = harness({ sdk: [sdkHttp(429, { 'retry-after-ms': '60001' }), textOk()] });
    const error = await failureOf(over.gateway.ask(textRequest()));
    expect(error).toBeInstanceOf(StageError);
    expect(over.sdk.calls).toHaveLength(1);
    expect(over.waits).toEqual([]);

    const at = harness({ sdk: [sdkHttp(429, { 'retry-after-ms': '60000' }), textOk()] });
    await at.gateway.ask(textRequest());
    expect(at.waits).toEqual([60000]);
  });

  it('disables rate-limit retries when maxRateLimitRetries is 0', async () => {
    const h = harness({ sdk: [sdkHttp(429), textOk()] }, { maxRateLimitRetries: 0 });
    await failureOf(h.gateway.ask(textRequest()));
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.waits).toEqual([]);
  });
});

describe('transient retries', () => {
  it('retries a Transient_Failure at most maxTransientRetries times', async () => {
    for (const retries of [0, 1, 2, 3]) {
      const h = harness({ sdk: [sdkHttp(503)] }, { maxTransientRetries: retries });
      await failureOf(h.gateway.ask(textRequest()));
      expect(h.sdk.calls).toHaveLength(retries + 1);
      expect(h.entries[0]?.attempts).toBe(retries + 1);
    }
  });

  it('retries timeouts and connection failures of a Text_Request', async () => {
    const h = harness({
      sdk: [new APITimeoutError(10), new APIConnectionError('down'), textOk()],
    });
    await h.gateway.ask(textRequest());
    expect(h.sdk.calls).toHaveLength(3);
    expect(h.entries[0]).toMatchObject({ status: 'ok', attempts: 3 });
  });
});

describe('abort', () => {
  it('makes no network call when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const text = harness();
    const textError = await failureOf(text.gateway.ask(textRequest(), { signal: controller.signal }));
    expect(textError).toBeInstanceOf(StageError);
    expect(text.sdk.calls).toHaveLength(0);
    expect(text.entries[0]).toMatchObject({ status: 'error', errorKind: 'abort', attempts: 0 });

    const image = harness();
    const imageError = await failureOf(image.gateway.ask(imageRequest(), { signal: controller.signal }));
    expect(imageError).toMatchObject({ reason: 'timeout' });
    expect(image.json.calls).toHaveLength(0);
  });

  it('makes no further attempt when aborted during a request', async () => {
    const controller = new AbortController();
    const hang: Step = ({ signal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new APIUserAbortError()));
        controller.abort();
      });
    const h = harness({ sdk: [hang, textOk()] });
    const error = await failureOf(h.gateway.ask(textRequest(), { signal: controller.signal }));
    expect(error).toBeInstanceOf(StageError);
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({ errorKind: 'abort', attempts: 1 });
  });

  it('starts no further attempt when aborted during a retry wait', async () => {
    const controller = new AbortController();
    const h = harness(
      { sdk: [sdkHttp(503), textOk()] },
      {
        sleep: () => {
          controller.abort();
          return new Promise<void>(() => undefined);
        },
      },
    );
    const error = await failureOf(h.gateway.ask(textRequest(), { signal: controller.signal }));
    expect(error).toBeInstanceOf(StageError);
    expect(h.sdk.calls).toHaveLength(1);
  });

  it('does not retry an Image_Request after an abort', async () => {
    const controller = new AbortController();
    const hang: Step = ({ signal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new APIUserAbortError()));
        controller.abort();
      });
    const h = harness({ json: [hang, imageOk()] });
    const error = await failureOf(h.gateway.ask(imageRequest(), { signal: controller.signal }));
    expect(error).toMatchObject({ reason: 'timeout' });
    expect(h.json.calls).toHaveLength(1);
  });
});

describe('one Image_Request per gateway', () => {
  it('gives JevUsageError for the second Image_Request without a network call', async () => {
    const h = harness();
    await h.gateway.ask(imageRequest());
    const error = await failureOf(h.gateway.ask(imageRequest()));
    expect(error).toBeInstanceOf(JevUsageError);
    expect(h.json.calls).toHaveLength(1);
  });

  it('counts a failed Image_Request too', async () => {
    const h = harness({ json: [http(500)] });
    await failureOf(h.gateway.ask(imageRequest()));
    const error = await failureOf(h.gateway.ask(imageRequest()));
    expect(error).toBeInstanceOf(JevUsageError);
    expect(h.json.calls).toHaveLength(1);
  });
});

describe('modelIds()', () => {
  it('lists distinct returned ids in order of first appearance and ignores failures', async () => {
    const h = harness({
      sdk: [textOk('m-a'), textOk('m-b'), textOk('m-a'), sdkHttp(404), textOk('m-c')],
    });
    for (let i = 0; i < 4; i += 1) {
      try {
        await h.gateway.ask(textRequest());
      } catch {
        // the fourth call fails on purpose
      }
    }
    await h.gateway.ask(textRequest());
    expect(h.gateway.modelIds()).toEqual(['m-a', 'm-b', 'm-c']);
    expect(h.gateway.requestedModel).toBe('typesafe/jev-1.14');
    expect(h.entries.filter((e) => e.status === 'ok').map((e) => e.model)).toEqual([
      'm-a',
      'm-b',
      'm-a',
      'm-c',
    ]);
  });
});

describe('constructor options', () => {
  it.each([
    ['maxConcurrent', 0],
    ['maxConcurrent', 1.5],
    ['maxRateLimitRetries', -1],
    ['maxRateLimitRetries', 0.5],
    ['maxTransientRetries', -2],
    ['maxTransientRetries', 1.5],
  ] as const)('rejects %s = %s with a RangeError naming the option', (name, value) => {
    expect(() => harness({}, { [name]: value })).toThrow(RangeError);
    expect(() => harness({}, { [name]: value })).toThrow(name);
  });
});

describe('call log', () => {
  it('appends the error entry before the error is raised', async () => {
    const h = harness({ sdk: [sdkHttp(404)] });
    const promise = h.gateway.ask(textRequest());
    const settled = promise.catch(() => h.events.push('raised'));
    await settled;
    expect(h.events).toEqual(['log', 'raised']);
    expect(h.entries[0]).toMatchObject({
      status: 'error',
      model: null,
      answers: {},
      httpStatus: 404,
      attempts: 1,
    });
  });

  it('records attempts equal to the number of stub requests', async () => {
    const h = harness({ sdk: [sdkHttp(503), sdkHttp(503), textOk()] });
    await h.gateway.ask(textRequest());
    expect(h.entries[0]?.attempts).toBe(h.sdk.calls.length);
  });

  it('carries the original error as callError when a failed call also fails to log', async () => {
    const h = harness({ sdk: [sdkHttp(404)] }, { logFails: true });
    const error = await failureOf(h.gateway.ask(textRequest()));
    expect(error).toBeInstanceOf(StageError);
    const stage = error as StageError;
    expect((stage.cause as Error).message).toBe('disk full');
    expect(stage.callError).toBeInstanceOf(StageError);
  });

  it('raises a StageError without callError when only the log write fails', async () => {
    const h = harness({}, { logFails: true });
    const error = await failureOf(h.gateway.ask(textRequest()));
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).callError).toBeUndefined();
  });

  it('writes the same StageError class for a failed image call whose log also fails', async () => {
    const h = harness({ json: [http(500)] }, { logFails: true });
    const error = await failureOf(h.gateway.ask(imageRequest()));
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).callError).toBeInstanceOf(JevImageError);
  });
});
