import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextWithAssets } from '@typesafe-ai/sdk';
import { finalImageQuestions } from './catalog.js';
import { createJsonTransport, JsonTransportError } from './transport-json.js';
import type { JsonFetch } from './transport-json.js';

// Requirements 2.3, 2.4, 3.1-3.6, 19.3. Injected fetch only; no network, no API key.

const API_KEY = 'sk-or-secret-key-123456';
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4);
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8);

interface Captured {
  url: string;
  init: RequestInit;
}

function okResponse(): Response {
  return new Response(
    JSON.stringify({
      model: 'typesafe/jev-1.14-2026-01-01',
      answers: { x: 1 },
      usage: { input_tokens: 10, output_tokens: 2 },
    }),
    { status: 200 },
  );
}

function capturingFetch(respond: () => Response = okResponse): {
  fetch: JsonFetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetch: JsonFetch = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { fetch, calls };
}

function makeTransport(
  fetch: JsonFetch,
  provider: 'openrouter' | 'typesafe' = 'openrouter',
  baseURL = 'https://openrouter.ai/api/',
) {
  return createJsonTransport({
    baseURL,
    apiKey: API_KEY,
    requestedModel: 'typesafe/jev-1.14',
    provider,
    fetch,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JSON transport request', () => {
  it('posts to <baseURL>/v1/systemone with JSON content type and bearer auth', async () => {
    const { fetch, calls } = capturingFetch();
    const request = finalImageQuestions('claim', PNG);
    await makeTransport(fetch).send(request, { timeoutMs: 5000 });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    });
  });

  it('sends model, state, questions and assets in the body', async () => {
    const { fetch, calls } = capturingFetch();
    const request = finalImageQuestions('claim', PNG);
    await makeTransport(fetch).send(request, { timeoutMs: 5000 });

    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['assets', 'model', 'questions', 'state']);
    expect(body.model).toBe('typesafe/jev-1.14');
    expect(Object.keys(body.questions as object).sort()).toEqual(
      Object.keys(request.questions).sort(),
    );
    const state = request.state as TextWithAssets;
    expect(Object.keys(body.assets as object)).toEqual(state.assets.map((a) => String(a)));
  });

  it('serializes a png asset as { type, format, data_base64 }', async () => {
    const { fetch, calls } = capturingFetch();
    await makeTransport(fetch).send(finalImageQuestions('claim', PNG), { timeoutMs: 5000 });

    const body = JSON.parse(String(calls[0]!.init.body)) as {
      assets: Record<string, unknown>;
    };
    const assets = Object.values(body.assets);
    expect(assets).toEqual([
      { type: 'image', format: 'png', data_base64: Buffer.from(PNG).toString('base64') },
    ]);
  });

  it('serializes a jpeg asset as { type, format, data_base64 }', async () => {
    const { fetch, calls } = capturingFetch();
    await makeTransport(fetch).send(finalImageQuestions('claim', JPEG), { timeoutMs: 5000 });

    const body = JSON.parse(String(calls[0]!.init.body)) as {
      assets: Record<string, unknown>;
    };
    expect(Object.values(body.assets)).toEqual([
      { type: 'image', format: 'jpeg', data_base64: Buffer.from(JPEG).toString('base64') },
    ]);
  });

  it('omits TypeSafe-Danger-Zone-Images for openrouter even when requested', async () => {
    const { fetch, calls } = capturingFetch();
    await makeTransport(fetch, 'openrouter').send(finalImageQuestions('claim', PNG), {
      timeoutMs: 5000,
      dangerZoneHeader: true,
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(Object.keys(headers)).not.toContain('TypeSafe-Danger-Zone-Images');
  });

  it('sends TypeSafe-Danger-Zone-Images only for typesafe with the option on', async () => {
    const on = capturingFetch();
    await makeTransport(on.fetch, 'typesafe', 'https://api.typesafe.ai/').send(
      finalImageQuestions('claim', PNG),
      { timeoutMs: 5000, dangerZoneHeader: true },
    );
    const onHeaders = on.calls[0]!.init.headers as Record<string, string>;
    expect(onHeaders['TypeSafe-Danger-Zone-Images']).toBe('true');
    const off = capturingFetch();
    await makeTransport(off.fetch, 'typesafe', 'https://api.typesafe.ai/').send(
      finalImageQuestions('claim', PNG),
      { timeoutMs: 5000 },
    );
    const offHeaders = off.calls[0]!.init.headers as Record<string, string>;
    expect(Object.keys(offHeaders)).not.toContain('TypeSafe-Danger-Zone-Images');
  });
  it('returns the model, answers and usage of a 200 response', async () => {
    const { fetch } = capturingFetch();
    const result = await makeTransport(fetch).send(finalImageQuestions('claim', PNG), {
      timeoutMs: 5000,
    });
    expect(result).toEqual({
      model: 'typesafe/jev-1.14-2026-01-01',
      answers: { x: 1 },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  });

  it('does not call the global fetch when one is injected', async () => {
    const globalFetch = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', globalFetch);
    const { fetch, calls } = capturingFetch();
    await makeTransport(fetch).send(finalImageQuestions('claim', PNG), { timeoutMs: 5000 });
    expect(calls).toHaveLength(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe('JSON transport HTTP 400 on multipart', () => {
  it('throws a sanitized http JsonTransportError with status 400', async () => {
    const { fetch } = capturingFetch(
      () => new Response('invalid content-type: multipart/form-data', { status: 400 }),
    );
    const request = finalImageQuestions('secret claim text', PNG);
    const error = await makeTransport(fetch)
      .send(request, { timeoutMs: 5000 })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(JsonTransportError);
    const failure = error as JsonTransportError;
    expect(failure.kind).toBe('http');
    expect(failure.status).toBe(400);
    expect(failure.message).toContain('HTTP 400');
    expect(failure.message).toContain('invalid content-type: multipart/form-data');
  });

  it('keeps the key, Authorization header and request body out of the error', async () => {
    // The server echoes the key and bearer token back; the transport must scrub them.
    const { fetch } = capturingFetch(
      () =>
        new Response(`bad request Authorization: Bearer ${API_KEY} key=${API_KEY}`, {
          status: 400,
        }),
    );
    const request = finalImageQuestions('secret claim text', PNG);
    const error = (await makeTransport(fetch)
      .send(request, { timeoutMs: 5000 })
      .catch((e: unknown) => e)) as JsonTransportError;

    const dump = `${error.message}\n${error.stack ?? ''}\n${JSON.stringify(error)}`;
    expect(dump).not.toContain(API_KEY);
    expect(dump).not.toContain(Buffer.from(PNG).toString('base64'));
    expect(dump).not.toContain('secret claim text');
    expect(dump).not.toContain('data_base64');
  });
});
