import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '@typesafe-ai/sdk';
import { StageError } from '../errors.js';
import { CATALOG, finalImageQuestions } from './catalog.js';
import { JevImageError, RateLimitError } from './errors.js';
import {
  FAKE_MODEL_ID,
  FakeJevGateway,
  FakeRecordingMissingError,
  type Recording,
} from './fake.js';
import { stateHash } from './hash.js';
import { CallLogEntrySchema, type CallLog, type CallLogEntry } from './log.js';
import type { BuiltCatalogQuestion, Jev_Request } from './types.js';

const recordings = JSON.parse(
  readFileSync(new URL('./fixtures/recordings.json', import.meta.url), 'utf8'),
) as Recording[];

/** The state of the Checkout spike samples (001 to 003). The fixture hashes `JSON.stringify(state)`. */
const CHECKOUT_STATE = JSON.stringify({
  page: 'Checkout',
  elements: [
    { id: 'e1', role: 'button', name: 'Place order', enabled: true },
    { id: 'e2', role: 'link', name: 'Back to cart', enabled: true },
    { id: 'e3', role: 'textbox', name: 'Coupon code', enabled: true },
  ],
  lastAction: 'none',
});

/** The state of spike sample 014 (raw JSON box). */
const BOX_STATE = JSON.stringify({
  text: 'Claim: the demo page renders a main heading. A screenshot of the page is attached.',
  screenshot: '<image: demo-app-screenshot.png>',
});

const NEXT_ACTION_STATE =
  'A web page is open with a form, a toolbar, a data table, a sidebar and a footer. The goal is to save the current draft.';

const MODEL = 'typesafe/jev-1.14-20261014';

/** A catalog-shaped question for entries that the catalog does not define (the spike score question). */
function handBuilt(id: string, version: number, type: Question['type']): BuiltCatalogQuestion {
  return {
    id,
    version,
    idVersion: `${id}@${version}`,
    type,
    requiresImage: false,
    labelsFixed: false,
    question: { type } as unknown as Question,
  };
}

function memoryLog(): CallLog & { entries: CallLogEntry[] } {
  const entries: CallLogEntry[] = [];
  return {
    entries,
    async append(entry: CallLogEntry): Promise<void> {
      entries.push(CallLogEntrySchema.parse(entry));
    },
  } as CallLog & { entries: CallLogEntry[] };
}

function textRequest(state: string, questions: Jev_Request['questions']): Jev_Request {
  return { stage: 'assessment', state, questions };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FakeJevGateway: replay of recordings.json', () => {
  const gateway = new FakeJevGateway(recordings);

  it('replays a choice answer and the recorded model and usage', async () => {
    const result = await gateway.ask(
      textRequest(CHECKOUT_STATE, { next: CATALOG.runtimeNextAction.built(['Place order button', 'Back', 'Coupon']) }),
    );
    expect(result.model).toBe(MODEL);
    expect(result.usage).toEqual({ input_tokens: 458, output_tokens: 42 });
    expect(result.answers['next']).toEqual({
      type: 'choice',
      choice: 'e1',
      probabilities: { e1: 1, e2: 0, e3: 0 },
      confidence: 1,
    });
  });

  it('replays a noul answer', async () => {
    const result = await gateway.ask(
      textRequest(CHECKOUT_STATE, { has_button: CATALOG.claimIsBehavior.built() }),
    );
    expect(result.answers['has_button']).toEqual({ type: 'noul', noul: 1 });
  });

  it('replays a score answer', async () => {
    const result = await gateway.ask(
      textRequest(CHECKOUT_STATE, { readiness: handBuilt('spike.score', 1, 'score') }),
    );
    expect(result.answers['readiness']).toMatchObject({
      type: 'score',
      score: 1.99,
      confidence: 0.98,
    });
  });

  it('replays a next_action choice answer over many options', async () => {
    const options = Array.from({ length: 100 }, (_, i) => `option ${i}`);
    const result = await gateway.ask(
      textRequest(NEXT_ACTION_STATE, { next: CATALOG.runtimeNextAction.built(options) }),
    );
    expect(result.answers['next']).toMatchObject({ type: 'choice', choice: 'opt_001', confidence: 0.84 });
    expect(result.usage).toEqual({ input_tokens: 2624, output_tokens: 1121 });
  });

  it('replays the raw JSON box answer', async () => {
    const result = await gateway.ask(
      textRequest(BOX_STATE, { box: CATALOG.runtimeLocateSubject.built() }),
    );
    expect(result.answers['box']).toEqual({
      type: 'box',
      box: { top: 0.13, bottom: 0.19, left: 0.01, right: 0.22 },
      confidence: 0.89,
    });
  });
});

describe('FakeJevGateway: scripted failures', () => {
  function failing(script: Recording['scriptedFailure'], request: Jev_Request, name: string, idVersion: string) {
    const gateway = new FakeJevGateway([
      { idVersion, stateHash: stateHash(request.state), question: name, scriptedFailure: script },
    ]);
    return gateway.ask(request);
  }

  const pngA = new Uint8Array([137, 80, 78, 71, 1]);
  // Keep only `state_reached`, so the single scripted Recording covers every requested question.
  const imageRequest = (claim: string): Jev_Request => {
    const full = finalImageQuestions(claim, pngA);
    return { ...full, questions: { state_reached: full.questions['state_reached'] as BuiltCatalogQuestion } };
  };

  it('image-multipart-400 raises JevImageError bad_request with status 400', async () => {
    const error = await failing(
      'image-multipart-400',
      imageRequest('multipart'),
      'state_reached',
      'runtime.state_reached@1',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevImageError);
    expect(error).toMatchObject({ reason: 'bad_request', status: 400 });
  });

  it('image-timeout raises JevImageError timeout', async () => {
    const error = await failing(
      'image-timeout',
      imageRequest('timeout'),
      'state_reached',
      'runtime.state_reached@1',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevImageError);
    expect(error).toMatchObject({ reason: 'timeout' });
  });

  it('image-rate-limit raises JevImageError rate_limited with status 429', async () => {
    const error = await failing(
      'image-rate-limit',
      imageRequest('ratelimit'),
      'state_reached',
      'runtime.state_reached@1',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevImageError);
    expect(error).toMatchObject({ reason: 'rate_limited', status: 429 });
  });

  it('rate-limit raises a StageError whose cause is a RateLimitError', async () => {
    const error = await failing(
      'rate-limit',
      textRequest('state rate-limit', { surface: CATALOG.assessSurface.built() }),
      'surface',
      'assess.surface@1',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('assessment');
    expect((error as StageError).cause).toBeInstanceOf(RateLimitError);
  });

  it('unauthorized raises a StageError whose cause is an authentication error without a secret', async () => {
    const error = await failing(
      'unauthorized',
      textRequest('state unauthorized', { surface: CATALOG.assessSurface.built() }),
      'surface',
      'assess.surface@1',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StageError);
    const cause = (error as StageError).cause as Error;
    expect(cause.name).toBe('AuthenticationError');
    expect(cause.message).toContain('401');
  });

  it('the scripted-failure recordings of recordings.json are all present', () => {
    expect(
      recordings.filter((r) => r.scriptedFailure !== undefined).map((r) => r.scriptedFailure).sort(),
    ).toEqual(['image-multipart-400', 'image-rate-limit', 'image-timeout', 'rate-limit', 'unauthorized']);
  });
});

describe('FakeJevGateway: lookup', () => {
  const gateway = new FakeJevGateway(recordings);

  it('a version mismatch throws FakeRecordingMissingError naming id@version, question and hash', async () => {
    const v2: BuiltCatalogQuestion = { ...CATALOG.claimIsBehavior.built(), version: 2, idVersion: 'claim.is_behavior@2' };
    const error = await gateway
      .ask(textRequest(CHECKOUT_STATE, { has_button: v2 }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FakeRecordingMissingError);
    const missing = error as FakeRecordingMissingError;
    const hash = stateHash(CHECKOUT_STATE);
    expect(missing.idVersion).toBe('claim.is_behavior@2');
    expect(missing.question).toBe('has_button');
    expect(missing.stateHash).toBe(hash);
    expect(missing.message).toContain('claim.is_behavior@2');
    expect(missing.message).toContain('has_button');
    expect(missing.message).toContain(hash);
  });

  it('an unknown state hash and an unknown question name also throw, never a default', async () => {
    await expect(
      gateway.ask(textRequest('never recorded', { has_button: CATALOG.claimIsBehavior.built() })),
    ).rejects.toBeInstanceOf(FakeRecordingMissingError);
    await expect(
      gateway.ask(textRequest(CHECKOUT_STATE, { other_name: CATALOG.claimIsBehavior.built() })),
    ).rejects.toBeInstanceOf(FakeRecordingMissingError);
  });

  it('one missing question fails the whole request even when another matches', async () => {
    await expect(
      gateway.ask(
        textRequest(CHECKOUT_STATE, {
          has_button: CATALOG.claimIsBehavior.built(),
          absent: CATALOG.claimIsBehavior.built(),
        }),
      ),
    ).rejects.toBeInstanceOf(FakeRecordingMissingError);
  });

  it('two questions with the same entry in one request do not collide', async () => {
    const hash = stateHash('shared state');
    const two = new FakeJevGateway([
      { idVersion: 'claim.is_behavior@1', stateHash: hash, question: 'first', answer: { type: 'noul', noul: 1 } },
      { idVersion: 'claim.is_behavior@1', stateHash: hash, question: 'second', answer: { type: 'noul', noul: 0 } },
    ]);
    const result = await two.ask(
      textRequest('shared state', {
        first: CATALOG.claimIsBehavior.built(),
        second: CATALOG.claimIsBehavior.built(),
      }),
    );
    expect(result.answers['first']).toEqual({ type: 'noul', noul: 1 });
    expect(result.answers['second']).toEqual({ type: 'noul', noul: 0 });
  });

  it('uses FAKE_MODEL_ID and zero usage when the recording has no model or usage', async () => {
    const hash = stateHash('bare');
    const bare = new FakeJevGateway([
      { idVersion: 'claim.is_behavior@1', stateHash: hash, question: 'q', answer: { type: 'noul', noul: 1 } },
    ]);
    const result = await bare.ask(textRequest('bare', { q: CATALOG.claimIsBehavior.built() }));
    expect(result.model).toBe(FAKE_MODEL_ID);
    expect(result.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});

describe('FakeJevGateway: abort signal', () => {
  const gateway = new FakeJevGateway(recordings);
  const request = textRequest(CHECKOUT_STATE, { has_button: CATALOG.claimIsBehavior.built() });

  it('an already aborted signal raises a StageError carrying the abort reason, before any recording is used', async () => {
    const reason = new Error('stop now');
    const controller = new AbortController();
    controller.abort(reason);
    const error = await gateway.ask(request, { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('assessment');
    expect((error as StageError).cause).toBe(reason);
  });

  it('an already aborted signal on an image request raises JevImageError timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await gateway
      .ask(finalImageQuestions('claim', new Uint8Array([1, 2, 3])), { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevImageError);
    expect(error).toMatchObject({ reason: 'timeout' });
  });

  it('a signal that is not aborted does not change the result', async () => {
    const controller = new AbortController();
    const result = await gateway.ask(request, { signal: controller.signal });
    expect(result.answers['has_button']).toEqual({ type: 'noul', noul: 1 });
  });
});

describe('FakeJevGateway: keyless and offline', () => {
  it('construction and ask need no API key, call no fetch and read no environment variable', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', undefined as unknown as string);
    vi.stubEnv('TYPESAFE_API_KEY', undefined as unknown as string);
    expect(process.env['OPENROUTER_API_KEY']).toBeUndefined();
    expect(process.env['TYPESAFE_API_KEY']).toBeUndefined();

    const fetchSpy = vi.fn(() => {
      throw new Error('fetch must not be called');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const realEnv = process.env;
    const reads: Array<string | symbol> = [];
    Object.defineProperty(process, 'env', {
      configurable: true,
      value: new Proxy(realEnv, {
        get(target, key, receiver) {
          reads.push(key);
          return Reflect.get(target, key, receiver);
        },
        has(target, key) {
          reads.push(key);
          return Reflect.has(target, key);
        },
        ownKeys(target) {
          reads.push('ownKeys');
          return Reflect.ownKeys(target);
        },
      }),
    });
    try {
      const gateway = new FakeJevGateway(recordings, { callLog: memoryLog() });
      const result = await gateway.ask(
        textRequest(CHECKOUT_STATE, { has_button: CATALOG.claimIsBehavior.built() }),
      );
      expect(result.answers['has_button']).toEqual({ type: 'noul', noul: 1 });
      await expect(
        gateway.ask(textRequest('unknown', { has_button: CATALOG.claimIsBehavior.built() })),
      ).rejects.toBeInstanceOf(FakeRecordingMissingError);
    } finally {
      Object.defineProperty(process, 'env', { configurable: true, writable: true, value: realEnv });
    }
    expect(reads).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('FakeJevGateway: call log', () => {
  it('writes one entry per call with transport fake and latency 0, and no state text', async () => {
    const log = memoryLog();
    const gateway = new FakeJevGateway(recordings, { callLog: log });
    await gateway.ask(textRequest(CHECKOUT_STATE, { has_button: CATALOG.claimIsBehavior.built() }));

    expect(log.entries).toHaveLength(1);
    const entry = log.entries[0] as CallLogEntry;
    expect(entry).toMatchObject({
      transport: 'fake',
      latencyMs: 0,
      status: 'ok',
      stage: 'assessment',
      model: MODEL,
      stateHash: stateHash(CHECKOUT_STATE),
      usage: { input_tokens: 403, output_tokens: 21 },
    });
    expect(entry.questions).toEqual([{ id: 'claim.is_behavior', version: 1, type: 'noul' }]);
    expect(JSON.stringify(entry)).not.toContain('Place order');
  });

  it('writes one error entry per failed call, also with transport fake and latency 0', async () => {
    const log = memoryLog();
    const request = textRequest('state failing', { surface: CATALOG.assessSurface.built() });
    const gateway = new FakeJevGateway(
      [
        {
          idVersion: 'assess.surface@1',
          stateHash: stateHash('state failing'),
          question: 'surface',
          scriptedFailure: 'rate-limit',
        },
      ],
      { callLog: log },
    );
    await expect(gateway.ask(request)).rejects.toBeInstanceOf(StageError);
    await expect(
      gateway.ask(textRequest('missing', { surface: CATALOG.assessSurface.built() })),
    ).rejects.toBeInstanceOf(FakeRecordingMissingError);

    expect(log.entries).toHaveLength(2);
    expect(log.entries[0]).toMatchObject({
      transport: 'fake',
      latencyMs: 0,
      status: 'error',
      errorKind: 'rate_limit',
      httpStatus: 429,
      model: null,
    });
    expect(log.entries[1]).toMatchObject({ transport: 'fake', latencyMs: 0, status: 'error', errorKind: 'other' });
  });

  it('a log write failure raises a StageError with the write error as cause', async () => {
    const writeError = new Error('disk full');
    const failingLog: CallLog = {
      append: () => Promise.reject(writeError),
    } as CallLog;
    const gateway = new FakeJevGateway(recordings, { callLog: failingLog });
    const error = await gateway
      .ask(textRequest(CHECKOUT_STATE, { has_button: CATALOG.claimIsBehavior.built() }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).cause).toBe(writeError);
  });
});
