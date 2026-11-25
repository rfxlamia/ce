import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeError,
} from '@typesafe-ai/sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StageError } from '../../errors.js';
import { CATALOG, finalImageQuestions } from '../catalog.js';
import { JevImageError, JevUsageError, RateLimitError } from '../errors.js';
import type { JevImageErrorReason } from '../errors.js';
import { HybridJevGateway } from '../gateway.js';
import type { CallLog, CallLogEntry } from '../log.js';
import type { SdkTransport } from '../transport-sdk.js';
import { JsonTransportError } from '../transport-json.js';
import type { JsonTransport } from '../transport-json.js';
import type { Jev_Request, RawSystemOneResult } from '../types.js';

const STATUSES = [400, 413, 422, 500, 502, 503, 599, 401, 403, 429, 408, 404, 409, 418, 451];

type Variant =
  | { type: 'http'; status: number }
  | { type: 'timeout' }
  | { type: 'connection' }
  | { type: 'typesafe' }
  | { type: 'abort' }
  | { type: 'missing_answer' }
  | { type: 'missing_model' }
  | { type: 'invalid_image' };

interface Scenario {
  kind: 'text' | 'image';
  variant: Variant;
  retryAfterMs: number | undefined;
  maxRateLimitRetries: number;
  maxTransientRetries: number;
  key: string;
  marker: string;
  pngTail: number[];
}

const httpVariant: fc.Arbitrary<Variant> = fc
  .constantFrom(...STATUSES)
  .map((status) => ({ type: 'http' as const, status }));

const textVariant: fc.Arbitrary<Variant> = fc.oneof(
  httpVariant,
  fc.constantFrom<Variant>(
    { type: 'timeout' },
    { type: 'connection' },
    { type: 'typesafe' },
    { type: 'abort' },
    { type: 'missing_answer' },
    { type: 'missing_model' },
  ),
);

const imageVariant: fc.Arbitrary<Variant> = fc.oneof(
  textVariant,
  fc.constant<Variant>({ type: 'invalid_image' }),
);

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    kind: fc.constantFrom<'text' | 'image'>('text', 'image'),
    retryAfterMs: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
    maxRateLimitRetries: fc.integer({ min: 0, max: 2 }),
    maxTransientRetries: fc.integer({ min: 0, max: 2 }),
    key: fc.stringMatching(/^[0-9a-f]{24}$/).map((hex) => `sk-or-${hex}`),
    marker: fc.stringMatching(/^[0-9a-z]{12}$/).map((s) => `STATE-${s}`),
    pngTail: fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 8, maxLength: 32 }),
    textVariant,
    imageVariant,
  })
  .map(({ textVariant: tv, imageVariant: iv, ...rest }) => ({
    ...rest,
    variant: rest.kind === 'text' ? tv : iv,
  }));

const GOOD_BOX = {
  type: 'box',
  box: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 },
  confidence: null,
};

function validAnswers(kind: 'text' | 'image', omit: boolean): Record<string, unknown> {
  if (kind === 'text') return omit ? {} : { is_behavior: { type: 'noul', noul: 0.5 } };
  return {
    state_reached: { type: 'noul', noul: 0.5 },
    ...(omit ? {} : { locate_subject: GOOD_BOX }),
  };
}

function expectedTransportCalls(s: Scenario): number {
  const v = s.variant;
  if (v.type === 'invalid_image') return 0; // fails before any HTTP request
  if (v.type === 'http') {
    if (v.status === 429) return 1 + s.maxRateLimitRetries;
    if (s.kind === 'text' && (v.status === 408 || v.status >= 500)) {
      return 1 + s.maxTransientRetries;
    }
    return 1;
  }
  if (s.kind === 'text' && (v.type === 'timeout' || v.type === 'connection')) {
    return 1 + s.maxTransientRetries;
  }
  return 1;
}

function imageReason(v: Variant): { reason: JevImageErrorReason; status?: number } {
  switch (v.type) {
    case 'http':
      if (v.status === 429) return { reason: 'rate_limited', status: 429 };
      if (v.status === 408) return { reason: 'timeout', status: 408 };
      if (v.status === 400 || v.status === 413 || v.status === 422) {
        return { reason: 'bad_request', status: v.status };
      }
      if (v.status >= 500) return { reason: 'server', status: v.status };
      return { reason: 'client', status: v.status };
    case 'timeout':
    case 'abort':
      return { reason: 'timeout' };
    case 'connection':
      return { reason: 'connection' };
    case 'typesafe':
      return { reason: 'client' };
    case 'missing_answer':
    case 'missing_model':
      return { reason: 'invalid_response' };
    case 'invalid_image':
      return { reason: 'invalid_image' };
  }
}

function isAuth(v: Variant): boolean {
  return v.type === 'http' && (v.status === 401 || v.status === 403);
}

async function run(s: Scenario): Promise<{
  error: unknown;
  calls: number;
  entries: CallLogEntry[];
  controller: AbortController;
  bytes: Uint8Array;
}> {
  const controller = new AbortController();
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...s.pngTail]);
  const secretBody = `${s.key} Bearer ${s.key} ${s.marker} ${Buffer.from(bytes).toString('base64')}`;
  let calls = 0;
  const v = s.variant;

  const failOrResult = (): RawSystemOneResult => {
    calls += 1;
    switch (v.type) {
      case 'missing_answer':
        return { model: 'typesafe/jev-1.14-test', answers: validAnswers(s.kind, true), usage: { input_tokens: 1, output_tokens: 1 } };
      case 'missing_model':
        return { model: '', answers: validAnswers(s.kind, false), usage: { input_tokens: 1, output_tokens: 1 } };
      default:
        throw new Error('unreachable');
    }
  };

  const sdkTransport: SdkTransport = {
    send: async () => {
      if (v.type === 'missing_answer' || v.type === 'missing_model') return failOrResult();
      calls += 1;
      switch (v.type) {
        case 'http': {
          const headers = new Headers(
            s.retryAfterMs !== undefined ? { 'retry-after-ms': String(s.retryAfterMs) } : {},
          );
          throw APIError.fromResponse(v.status, secretBody, headers);
        }
        case 'timeout':
          throw new APITimeoutError(10);
        case 'connection':
          throw new APIConnectionError(`connect failed ${secretBody}`);
        case 'abort':
          controller.abort(new Error(`aborted by caller ${s.marker}`));
          throw new APIUserAbortError();
        default:
          throw new TypeSafeError(`local failure ${secretBody}`);
      }
    },
  };

  const jsonTransport: JsonTransport = {
    send: async () => {
      if (v.type === 'missing_answer' || v.type === 'missing_model') return failOrResult();
      if (v.type === 'invalid_image') {
        throw new JevImageError('invalid_image', {
          message: 'Jev image request failed: invalid_image (not a PNG or JPEG)',
        });
      }
      calls += 1;
      switch (v.type) {
        case 'http':
          throw new JsonTransportError('http', `HTTP ${v.status}: ${secretBody}`, {
            status: v.status,
            ...(s.retryAfterMs !== undefined ? { retryAfterMs: s.retryAfterMs } : {}),
          });
        case 'timeout':
          throw new JsonTransportError('timeout', 'timed out');
        case 'connection':
          throw new JsonTransportError('connection', 'failed to connect');
        case 'abort':
          controller.abort(new Error(`aborted by caller ${s.marker}`));
          throw new JsonTransportError('aborted', 'aborted by caller');
        default:
          throw new TypeSafeError(`local failure ${secretBody}`);
      }
    },
  };

  const entries: CallLogEntry[] = [];
  const callLog: CallLog = {
    append: async (entry) => {
      entries.push(entry);
    },
  };

  const gateway = new HybridJevGateway({
    sdkTransport,
    jsonTransport,
    callLog,
    provider: 'openrouter',
    requestedModel: 'typesafe/jev-1.14',
    maxRateLimitRetries: s.maxRateLimitRetries,
    maxTransientRetries: s.maxTransientRetries,
    sleep: async () => {},
  });

  let request: Jev_Request;
  if (s.kind === 'text') {
    request = {
      stage: 'assessment',
      state: `claim: ${s.marker}`,
      questions: { is_behavior: CATALOG.claimIsBehavior.built() },
    };
  } else {
    request = finalImageQuestions(s.marker, bytes);
  }

  const error = await gateway
    .ask(request, v.type === 'abort' ? { signal: controller.signal } : {})
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  return { error, calls, entries, controller, bytes };
}

describe('jev-gateway properties', () => {
  // Feature: jev-gateway, Property 7: Failure classification is total, exclusive and never leaks secrets
  // **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.15, 6.16, 6.17, 6.18, 8.4**
  it('Property 7: every failure maps to exactly one error shape and leaks no secret', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { error, calls, entries, controller, bytes } = await run(s);
        const v = s.variant;

        // Total: a failure always raises, and never an SDK, fetch or foreign error.
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(APIError);
        expect(error).not.toBeInstanceOf(TypeSafeError);
        expect(error).not.toBeInstanceOf(JsonTransportError);
        expect(error).not.toBeInstanceOf(RateLimitError);
        expect(error).not.toBeInstanceOf(JevUsageError);

        // Exclusive: exactly one of JevImageError or StageError.
        const isImageError = error instanceof JevImageError;
        const isStageError = error instanceof StageError;
        expect(isImageError !== isStageError).toBe(true);

        const messages: string[] = [];
        if (isImageError) {
          const err = error as JevImageError;
          expect(s.kind).toBe('image');
          expect(isAuth(v)).toBe(false);
          const expected = imageReason(v);
          expect(err.reason).toBe(expected.reason);
          if (expected.status === undefined) {
            expect('status' in err).toBe(false);
          } else {
            expect(err.status).toBe(expected.status);
          }
          if (expected.reason === 'rate_limited' && s.retryAfterMs !== undefined) {
            expect(err.retryAfterMs).toBe(s.retryAfterMs);
          } else {
            expect('retryAfterMs' in err).toBe(false);
          }
          messages.push(err.message, err.name, JSON.stringify({ ...err }));
        } else {
          const err = error as StageError;
          expect(err.stage).toBe(s.kind === 'text' ? 'assessment' : 'runtime');
          messages.push(err.message, err.name);
          const cause = err.cause;
          if (isAuth(v)) {
            // The authentication error as the transport raised it.
            expect(cause).toBeInstanceOf(s.kind === 'text' ? APIError : JsonTransportError);
          } else {
            // Image requests only raise a StageError for authentication.
            expect(s.kind).toBe('text');
            if (v.type === 'http' && v.status === 429) {
              expect(cause).toBeInstanceOf(RateLimitError);
              expect((cause as RateLimitError).retryAfterMs).toBe(s.retryAfterMs);
              messages.push((cause as RateLimitError).message);
            } else if (v.type === 'abort') {
              expect(cause).toBe(controller.signal.reason);
            } else {
              expect(cause).toBeDefined();
              expect(cause).not.toBeInstanceOf(RateLimitError);
            }
          }
        }

        // The retry budget is respected exactly.
        expect(calls).toBe(expectedTransportCalls(s));

        // One log entry, an error, and no secret anywhere.
        expect(entries).toHaveLength(1);
        expect(entries[0]?.status).toBe('error');
        const logged = JSON.stringify(entries);
        const base64 = Buffer.from(bytes).toString('base64');
        for (const text of [...messages, logged]) {
          expect(text).not.toContain(s.key);
          expect(text).not.toContain(s.marker);
          expect(text).not.toContain(base64);
          expect(text).not.toMatch(/Bearer\s/i);
        }
      }),
      { numRuns: 200 },
    );
  });
});
