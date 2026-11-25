import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/load.js';
import type { LoadedConfig } from '../config/load.js';
import { CATALOG, finalImageQuestions } from './catalog.js';
import { createJevGateway, PINNED_MODELS } from './gateway.js';
import type { CreateJevGatewayOptions } from './gateway.js';
import type { Jev_Request } from './types.js';

// Requirements 4.1-4.5, 4.8-4.11, 5.1, 5.2, 5.4-5.7, 17.4, 17.9, 19.7.
// Keyless: fake key strings, injected fetch and env, no network.
// Not covered here: "no key needed to construct FakeJevGateway" (jev/fake.ts does not exist yet,
// task 12.4), and presence of TypeSafe-Danger-Zone-Images for provider typesafe (the factory
// exposes no dangerZoneHeader option, so only absence for openrouter is observable here).

const OR_KEY = 'sk-or-fake-key-aaaa1111';
const TS_KEY = 'ts-fake-key-bbbb2222';
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4);

type FetchStub = NonNullable<CreateJevGatewayOptions['fetch']>;

interface Captured {
  url: string;
  headers: Headers;
  body: string;
}

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-factory-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function load(flags: Record<string, unknown> = {}): LoadedConfig {
  const result = loadConfig({ cwd: dir, flags, env: {} });
  if (!result.ok) throw new Error(`config failed: ${JSON.stringify(result)}`);
  return result;
}

function surfaceResponse(): Response {
  return new Response(
    JSON.stringify({
      model: 'typesafe/jev-1.14-20261014',
      answers: {
        surface: {
          type: 'choice',
          choice: 'browser_ui',
          probabilities: { browser_ui: 1 },
          confidence: 1,
        },
      },
      usage: { input_tokens: 5, output_tokens: 1 },
    }),
    { status: 200 },
  );
}

function stub(respond: () => Response = surfaceResponse): { fetch: FetchStub; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetch = (async (input: unknown, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(
      (init?.headers ?? (input instanceof Request ? input.headers : undefined)) as
        | ConstructorParameters<typeof Headers>[0]
        | undefined,
    );
    calls.push({ url, headers, body: typeof init?.body === 'string' ? init.body : '' });
    return respond();
  }) as unknown as FetchStub;
  return { fetch, calls };
}

function textRequest(): Jev_Request {
  return {
    stage: 'assessment',
    state: 'claim: the page renders a heading',
    questions: { surface: CATALOG.assessSurface.built() },
  };
}

function build(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined>,
  fetch?: FetchStub,
) {
  const result = createJevGateway(load(flags), env, fetch ? { fetch } : {});
  if (!result.ok) throw new Error(`factory failed: ${JSON.stringify(result.errors)}`);
  return result.gateway;
}

describe('createJevGateway', () => {
  it('reports a missing key per provider, accepts a present key, and rejects jev-preview on openrouter', () => {
    const missingOr = createJevGateway(load({ 'jev.provider': 'openrouter' }), {});
    expect(missingOr.ok).toBe(false);
    if (!missingOr.ok) {
      expect(JSON.stringify(missingOr.errors)).toContain('OPENROUTER_API_KEY');
      expect(JSON.stringify(missingOr.errors)).not.toContain('TYPESAFE_API_KEY');
    }

    const missingTs = createJevGateway(load({ 'jev.provider': 'typesafe' }), {
      OPENROUTER_API_KEY: OR_KEY,
    });
    expect(missingTs.ok).toBe(false);
    if (!missingTs.ok) {
      expect(JSON.stringify(missingTs.errors)).toContain('TYPESAFE_API_KEY');
      expect(JSON.stringify(missingTs.errors)).not.toContain('OPENROUTER_API_KEY');
    }

    const presentOr = createJevGateway(load({ 'jev.provider': 'openrouter' }), {
      OPENROUTER_API_KEY: OR_KEY,
    });
    expect(presentOr.ok).toBe(true);
    if (presentOr.ok) expect(presentOr.gateway).toBeDefined();

    const presentTs = createJevGateway(load({ 'jev.provider': 'typesafe' }), {
      TYPESAFE_API_KEY: TS_KEY,
    });
    expect(presentTs.ok).toBe(true);

    const preview = createJevGateway(
      load({ 'jev.provider': 'openrouter', 'jev.model': 'jev-preview' }),
      { OPENROUTER_API_KEY: OR_KEY },
    );
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.errors).toHaveLength(1);
      expect(preview.errors[0]!.path).toBe('jev.model');
      expect(preview.errors[0]!.value).toBe('jev-preview');
    }
  });

  it('uses https://api.typesafe.ai and TYPESAFE_API_KEY for the typesafe provider', async () => {
    const { fetch, calls } = stub();
    const gateway = build(
      { 'jev.provider': 'typesafe' },
      { TYPESAFE_API_KEY: TS_KEY, OPENROUTER_API_KEY: OR_KEY },
      fetch,
    );
    await gateway.ask(textRequest());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith('https://api.typesafe.ai/')).toBe(true);
    const auth = calls[0]!.headers.get('authorization') ?? calls[0]!.headers.get('x-api-key') ?? '';
    expect(auth).toContain(TS_KEY);
    expect(auth).not.toContain(OR_KEY);
  });

  it('uses https://openrouter.ai/api and OPENROUTER_API_KEY for openrouter', async () => {
    const { fetch, calls } = stub();
    const gateway = build(
      { 'jev.provider': 'openrouter' },
      { OPENROUTER_API_KEY: OR_KEY, TYPESAFE_API_KEY: TS_KEY },
      fetch,
    );
    await gateway.ask(textRequest());
    expect(calls[0]!.url.startsWith('https://openrouter.ai/api/')).toBe(true);
    const auth = calls[0]!.headers.get('authorization') ?? calls[0]!.headers.get('x-api-key') ?? '';
    expect(auth).toContain(OR_KEY);
    expect(auth).not.toContain(TS_KEY);
  });

  it('omits TypeSafe-Danger-Zone-Images on openrouter image requests', async () => {
    const { fetch, calls } = stub(() => new Response('{}', { status: 500 }));
    const gateway = build({ 'jev.provider': 'openrouter' }, { OPENROUTER_API_KEY: OR_KEY }, fetch);
    await gateway.ask(finalImageQuestions('claim', PNG)).catch(() => undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(calls[0]!.headers.has('TypeSafe-Danger-Zone-Images')).toBe(false);
  });

  it('puts no key value in a failure result, a success result, or a response', async () => {
    const failure = createJevGateway(load({ 'jev.provider': 'openrouter' }), {
      TYPESAFE_API_KEY: TS_KEY,
    });
    expect(JSON.stringify(failure)).not.toContain(TS_KEY);

    const badModel = createJevGateway(
      load({ 'jev.provider': 'openrouter', 'jev.model': 'jev-preview' }),
      { OPENROUTER_API_KEY: OR_KEY },
    );
    expect(JSON.stringify(badModel)).not.toContain(OR_KEY);

    const { fetch } = stub();
    const gateway = build({ 'jev.provider': 'openrouter' }, { OPENROUTER_API_KEY: OR_KEY }, fetch);
    expect(JSON.stringify(gateway)).not.toContain(OR_KEY);
    const response = await gateway.ask(textRequest());
    expect(JSON.stringify(response)).not.toContain(OR_KEY);
  });

  it('reads only the given env, never process.env', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-process-env-must-not-be-used');
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-process-env-must-not-be-used');

    const missing = createJevGateway(load({ 'jev.provider': 'openrouter' }), {});
    expect(missing.ok).toBe(false);

    const { fetch, calls } = stub();
    const gateway = build({ 'jev.provider': 'openrouter' }, { OPENROUTER_API_KEY: OR_KEY }, fetch);
    await gateway.ask(textRequest());
    const auth = calls[0]!.headers.get('authorization') ?? calls[0]!.headers.get('x-api-key') ?? '';
    expect(auth).toContain(OR_KEY);
    expect(auth).not.toContain('process-env-must-not-be-used');
  });

  it('sends the same model on every request', async () => {
    const { fetch, calls } = stub();
    const gateway = build({ 'jev.provider': 'openrouter' }, { OPENROUTER_API_KEY: OR_KEY }, fetch);
    await gateway.ask(textRequest());
    await gateway.ask(textRequest());
    await gateway.ask(textRequest());
    expect(calls).toHaveLength(3);
    const models = calls.map((c) => (JSON.parse(c.body) as { model: string }).model);
    expect(new Set(models)).toEqual(new Set([PINNED_MODELS.openrouter]));
    expect(gateway.requestedModel).toBe(PINNED_MODELS.openrouter);
  });

  it('accepts any model form for the typesafe provider', () => {
    for (const model of ['jev-preview', 'typesafe/jev-1.14', '~typesafe/jev-latest', 'anything']) {
      const result = createJevGateway(
        load({ 'jev.provider': 'typesafe', 'jev.model': model }),
        { TYPESAFE_API_KEY: TS_KEY },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.gateway.requestedModel).toBe(model);
    }
  });

  it('pins typesafe/jev-1.14 for openrouter', () => {
    expect(PINNED_MODELS.openrouter).toBe('typesafe/jev-1.14');
  });
});
