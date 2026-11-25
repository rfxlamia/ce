import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSdkTransport } from './transport-sdk.js';
import type { Jev_Request } from './types.js';

const SECRET_STATE = 'state-body-must-not-be-logged-7f3a';

function request(): Jev_Request {
  return {
    stage: 'decide',
    state: SECRET_STATE,
    questions: {
      q: {
        id: 'test.q',
        version: 1,
        idVersion: 'test.q@1',
        type: 'noul',
        requiresImage: false,
        labelsFixed: false,
        question: { type: 'noul', instructions: 'Is it fine?', criteria: undefined },
      },
    },
  } as unknown as Jev_Request;
}

describe('createSdkTransport client configuration', () => {
  const saved = {
    level: process.env['TYPESAFE_LOG_LEVEL'],
    key: process.env['TYPESAFE_API_KEY'],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.level === undefined) delete process.env['TYPESAFE_LOG_LEVEL'];
    else process.env['TYPESAFE_LOG_LEVEL'] = saved.level;
    if (saved.key === undefined) delete process.env['TYPESAFE_API_KEY'];
    else process.env['TYPESAFE_API_KEY'] = saved.key;
  });

  it('disables retries, logging and compression, and ignores TYPESAFE_LOG_LEVEL=debug', async () => {
    process.env['TYPESAFE_LOG_LEVEL'] = 'debug';
    const consoleSpies = [
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchStub = (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ error: { message: 'boom' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as NonNullable<Parameters<typeof createSdkTransport>[0]['fetch']>;

    const transport = createSdkTransport({
      baseURL: 'https://example.invalid/api',
      apiKey: 'test-key-not-real',
      requestedModel: 'typesafe/jev-1.14',
      fetch: fetchStub,
    });

    await expect(transport.send(request(), { timeoutMs: 5000 })).rejects.toBeDefined();

    // maxRetries 0: a 500 is sent exactly once.
    expect(calls).toHaveLength(1);

    // compression false: plain body, no content-encoding header.
    const init = calls[0]!.init;
    const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
    expect(headers.get('content-encoding')).toBeNull();
    expect(typeof init?.body === 'string' || init?.body instanceof Uint8Array).toBe(true);
    if (typeof init?.body === 'string') expect(init.body).toContain(SECRET_STATE);

    // logLevel off: TYPESAFE_LOG_LEVEL=debug is ignored, nothing is logged, no body is printed.
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    const written = [...stdout.mock.calls, ...stderr.mock.calls]
      .map((c) => String(c[0]))
      .join('');
    expect(written).not.toContain(SECRET_STATE);
    expect(written).not.toContain('test-key-not-real');
  });
});
