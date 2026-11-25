import { describe, expect, it } from 'vitest';
import {
  buildImageUrlRequestBody,
  computeLatencyStats,
  imageUrlSummaryMarkdown,
  judgeImageUrl,
  planRun,
  sanitizeSample,
  sendFinalImage,
  sendImageUrlForm,
  sendSdkImage,
  sendText,
} from './probe.js';
import type { ProbeResult } from './probe.js';
import type { JsonFetch } from './transport-json.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const KEY = 'sk-test-not-a-real-key-123456';

interface Recorded {
  url: string;
  headers: Headers;
  body: unknown;
}

function stubFetch(
  respond: (call: number) => Response,
): { fetch: JsonFetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch: JsonFetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init.headers as ConstructorParameters<typeof Headers>[0]),
      body: init.body,
    });
    return respond(calls.length);
  };
  return { fetch, calls };
}

function ok(answers: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: 'typesafe/jev-1.14-2026-01-01',
      answers,
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function http(status: number, text = 'nope'): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain' } });
}

describe('computeLatencyStats', () => {
  it('uses nearest rank on a fixed array', () => {
    const samples = [50, 10, 40, 20, 30, 60, 70, 80, 90, 100];
    const stats = computeLatencyStats(samples, 2);
    expect(stats).toEqual({ p50: 50, p95: 100, min: 10, max: 100, count: 10, failures: 2 });
  });

  it('handles one sample', () => {
    expect(computeLatencyStats([7], 0)).toMatchObject({ p50: 7, p95: 7, min: 7, max: 7, count: 1 });
  });

  it('returns NaN for an empty list without throwing', () => {
    const stats = computeLatencyStats([], 3);
    expect(stats.p50).toBeNaN();
    expect(stats.p95).toBeNaN();
    expect(stats.min).toBeNaN();
    expect(stats.max).toBeNaN();
    expect(stats.count).toBe(0);
    expect(stats.failures).toBe(3);
  });

  it('does not mutate its input', () => {
    const samples = [3, 1, 2];
    computeLatencyStats(samples, 0);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe('buildImageUrlRequestBody', () => {
  it('builds a text part, an image_url part and one noul question', () => {
    const body = buildImageUrlRequestBody('it works', PNG, 'typesafe/jev-1.14');
    expect(body.model).toBe('typesafe/jev-1.14');
    expect(body.state).toHaveLength(2);
    expect(body.state[0]).toEqual({ type: 'text', text: 'claim: it works' });
    expect(body.state[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` },
    });
    expect(Object.keys(body.questions)).toEqual(['state_reached']);
  });

  it('uses the jpeg mime type for JPEG bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    const part = buildImageUrlRequestBody('c', jpeg, 'm').state[1] as {
      image_url: { url: string };
    };
    expect(part.image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
});

describe('Probe_Functions with a stub fetch', () => {
  it('sendText succeeds through the SDK transport and returns model and usage', async () => {
    const { fetch, calls } = stubFetch(() => ok({ surface: { type: 'choice', probabilities: { browser: 0.7, other: 0.3 } } }));
    const result = await sendText({ provider: 'openrouter', apiKey: KEY, model: 'm', fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/v1/systemone');
    expect(calls[0]!.url.startsWith('https://openrouter.ai/api')).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.model).toBe('typesafe/jev-1.14-2026-01-01');
    expect(result.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('sendFinalImage sends JSON with the image as data_base64 and no danger-zone header by default', async () => {
    const { fetch, calls } = stubFetch(() => ok());
    await sendFinalImage({
      provider: 'typesafe',
      apiKey: KEY,
      model: 'm',
      imageBytes: PNG,
      claim: 'c',
      fetch,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith('https://api.typesafe.ai')).toBe(true);
    expect(calls[0]!.headers.get('content-type')).toBe('application/json');
    expect(calls[0]!.headers.get('typesafe-danger-zone-images')).toBeNull();
    expect(String(calls[0]!.body)).toContain(Buffer.from(PNG).toString('base64'));
  });

  it('sendFinalImage sends the header only for typesafe with dangerZoneHeader true', async () => {
    const base = { apiKey: KEY, model: 'm', imageBytes: PNG, claim: 'c' } as const;
    const typesafe = stubFetch(() => ok());
    await sendFinalImage({ ...base, provider: 'typesafe', dangerZoneHeader: true, fetch: typesafe.fetch });
    expect(typesafe.calls[0]!.headers.get('typesafe-danger-zone-images')).toBe('true');

    const openrouter = stubFetch(() => ok());
    await sendFinalImage({ ...base, provider: 'openrouter', dangerZoneHeader: true, fetch: openrouter.fetch });
    expect(openrouter.calls[0]!.headers.get('typesafe-danger-zone-images')).toBeNull();
  });

  it('sendFinalImage uses a new gateway per call and never retries a 429', async () => {
    const { fetch, calls } = stubFetch(() => http(429, 'slow down'));
    const options = { provider: 'openrouter', apiKey: KEY, model: 'm', imageBytes: PNG, claim: 'c', fetch } as const;
    const first = await sendFinalImage(options);
    expect(first.ok).toBe(false);
    expect(first.status).toBe(429);
    expect(calls).toHaveLength(1);
    const second = await sendFinalImage(options);
    expect(second.ok).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('sendSdkImage bypasses routing and sends multipart', async () => {
    const { fetch, calls } = stubFetch(() => http(400, 'invalid content-type'));
    const result = await sendSdkImage({
      provider: 'openrouter',
      apiKey: KEY,
      model: 'm',
      imageBytes: PNG,
      claim: 'c',
      fetch,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get('content-type') ?? '').not.toBe('application/json');
    // The SDK serialises FormData to a Blob before calling fetch, so check the body is not JSON text.
    expect(typeof calls[0]!.body).not.toBe('string');
    expect(calls[0]!.body).toBeInstanceOf(Blob);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('sendImageUrlForm posts the array form as JSON through the JSON transport', async () => {
    const { fetch, calls } = stubFetch(() => ok({ state_reached: { label: 'yes' } }));
    const result = await sendImageUrlForm({
      provider: 'openrouter',
      apiKey: KEY,
      model: 'm',
      imageBytes: PNG,
      claim: 'c',
      fetch,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get('content-type')).toBe('application/json');
    const sent = JSON.parse(String(calls[0]!.body)) as { state: Array<{ type: string }> };
    expect(Array.isArray(sent.state)).toBe(true);
    expect(sent.state.map((p) => p.type)).toEqual(['text', 'image_url']);
  });

  it('returns an HTTP failure instead of throwing, with sanitized text', async () => {
    const { fetch } = stubFetch(() => http(401, `bad key ${KEY} Authorization: Bearer ${KEY}`));
    const result = await sendImageUrlForm({
      provider: 'openrouter',
      apiKey: KEY,
      model: 'm',
      imageBytes: PNG,
      claim: 'c',
      fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.errorText).toBeDefined();
    expect(result.errorText).not.toContain(KEY);
    expect(result.errorText).not.toMatch(/Bearer\s+sk-/);
  });

  it('returns a failure for a text request rejected with HTTP 500', async () => {
    const { fetch } = stubFetch(() => http(500, 'boom'));
    const result = await sendText({ provider: 'openrouter', apiKey: KEY, model: 'm', fetch });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it('returns a failure without a request when imageBytes is missing', async () => {
    const { fetch, calls } = stubFetch(() => ok());
    for (const send of [sendFinalImage, sendSdkImage, sendImageUrlForm]) {
      const result = await send({ provider: 'openrouter', apiKey: KEY, model: 'm', claim: 'c', fetch });
      expect(result.ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('planRun', () => {
  const keys = { OPENROUTER_API_KEY: 'a', TYPESAFE_API_KEY: 'b' };

  it('exits 2 on CI=true without --allow-ci, before reading any key', () => {
    const reads: string[] = [];
    const env = new Proxy({ CI: 'true' } as Record<string, string | undefined>, {
      get(target, prop) {
        if (typeof prop === 'string') reads.push(prop);
        return target[prop as string];
      },
    });
    const plan = planRun('all', env, false);
    expect(plan.exitCode).toBe(2);
    expect(reads).toEqual(['CI']);
  });

  it('exits 2 even when keys are set, and proceeds with --allow-ci', () => {
    expect(planRun('latency', { CI: 'true', ...keys }, false).exitCode).toBe(2);
    expect(planRun('latency', { CI: 'true', ...keys }, true).exitCode).toBe(0);
  });

  it('exits 3 naming OPENROUTER_API_KEY when it is unset or empty', () => {
    for (const env of [{}, { OPENROUTER_API_KEY: '' }, { OPENROUTER_API_KEY: '   ' }]) {
      const plan = planRun('latency', env, false);
      expect(plan).toMatchObject({ exitCode: 3, variable: 'OPENROUTER_API_KEY' });
    }
    expect(planRun('image-url', {}, false)).toMatchObject({ exitCode: 3, variable: 'OPENROUTER_API_KEY' });
  });

  it('exits 3 naming TYPESAFE_API_KEY for the typesafe command', () => {
    const plan = planRun('typesafe', { OPENROUTER_API_KEY: 'a' }, false);
    expect(plan).toMatchObject({
      exitCode: 3,
      variable: 'TYPESAFE_API_KEY',
      status: 'not tested (blocked: TYPESAFE_API_KEY not set)',
    });
  });

  it('prints no key value in the exit 3 plan', () => {
    const secret = 'super-secret-value';
    const plan = planRun('typesafe', { OPENROUTER_API_KEY: secret, TYPESAFE_API_KEY: '' }, false);
    expect(plan.exitCode).toBe(3);
    expect(JSON.stringify(plan)).not.toContain(secret);
  });

  it('blocks only the typesafe item for all when its key is absent', () => {
    const plan = planRun('all', { OPENROUTER_API_KEY: 'a' }, false);
    expect(plan.exitCode).toBe(0);
    if (plan.exitCode !== 0) return;
    expect(plan.items.map((i) => i.item)).toEqual(['latency', 'image-url']);
    expect(plan.blocked).toEqual([
      { item: 'typesafe', variable: 'TYPESAFE_API_KEY', status: 'not tested (blocked: TYPESAFE_API_KEY not set)' },
    ]);
  });

  it('exits 3 for all when the OpenRouter key is absent', () => {
    expect(planRun('all', { TYPESAFE_API_KEY: 'b' }, false)).toMatchObject({
      exitCode: 3,
      variable: 'OPENROUTER_API_KEY',
    });
  });

  it('plans the probes of each item', () => {
    const plan = planRun('all', keys, false);
    if (plan.exitCode !== 0) throw new Error('expected exit 0');
    expect(plan.items.map((i) => [i.item, i.probes])).toEqual([
      ['latency', ['sendFinalImage']],
      ['image-url', ['sendImageUrlForm']],
      ['typesafe', ['sendText', 'sendFinalImage', 'sendSdkImage']],
    ]);
  });
});

describe('sanitizeSample', () => {
  it('removes the key, the Authorization header and image bytes', () => {
    const base64 = 'A'.repeat(400);
    const result: ProbeResult = {
      ok: false,
      latencyMs: 12,
      status: 400,
      errorText: `failed with ${KEY}. Authorization: Bearer ${KEY} body ${base64}`,
      // Fields outside the whitelist must not reach the sample.
      answers: { leak: base64 },
    };
    const sample = sanitizeSample({ probe: 'sendFinalImage', result, questionNames: ['a', 'b'] }, [KEY]);
    const text = JSON.stringify(sample);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(base64);
    expect(text).not.toMatch(/Authorization:\s*Bearer/i);
    expect(text).not.toContain('leak');
    expect(sample).toMatchObject({
      probe: 'sendFinalImage',
      ok: false,
      status: 400,
      latencyMs: 12,
      questionNames: ['a', 'b'],
    });
  });

  it('keeps model and usage of a success', () => {
    const sample = sanitizeSample({
      probe: 'sendText',
      result: { ok: true, latencyMs: 1, model: 'm-1', usage: { input_tokens: 1, output_tokens: 2 } },
    });
    expect(sample).toMatchObject({ ok: true, model: 'm-1', usage: { input_tokens: 1, output_tokens: 2 }, questionNames: [] });
  });

  it('keeps numeric noul values per question and drops free text', () => {
    const sample = sanitizeSample({
      probe: 'p',
      result: {
        ok: true,
        latencyMs: 1,
        answers: {
          state_reached: { type: 'noul', noul: 0.82, note: 'free text' },
          other: { type: 'choice', label: 'yes' },
          bad: { noul: 'high' },
        },
      },
    });
    expect(sample.noul).toEqual({ state_reached: 0.82 });
    expect(JSON.stringify(sample)).not.toContain('free text');
  });
});

describe('image_url judging', () => {
  const res = (noul: number): ProbeResult => ({
    ok: true,
    latencyMs: 1,
    status: 200,
    answers: { state_reached: { type: 'noul', noul } },
  });

  it('confirms only when the true noul is clearly above the false noul', () => {
    expect(judgeImageUrl(0.9, 0.1)).toBe(true);
    expect(judgeImageUrl(0.5, 0.2)).toBe(true);
    expect(judgeImageUrl(0.4, 0.0)).toBe(false);
    expect(judgeImageUrl(0.9, 0.7)).toBe(false);
    expect(judgeImageUrl(0.6, 0.4)).toBe(false);
    expect(judgeImageUrl(undefined, 0.1)).toBe(false);
  });

  it('summarizes confirmed and not supported', () => {
    const base = { date: 'd', question: 'state_reached', samplesDir: 's' };
    expect(imageUrlSummaryMarkdown({ ...base, trueResult: res(0.9), falseResult: res(0.1) })).toContain(
      'Answer_Status: confirmed',
    );
    expect(imageUrlSummaryMarkdown({ ...base, trueResult: res(0.1), falseResult: res(0.1) })).toContain(
      'Answer_Status: not supported',
    );
    expect(
      imageUrlSummaryMarkdown({ ...base, trueResult: { ok: false, latencyMs: 0, status: 400 }, falseResult: res(0.1) }),
    ).toContain('Answer_Status: not supported');
  });
});
