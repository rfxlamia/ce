import { image, withAssets } from '@typesafe-ai/sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '../../config/load.js';
import type { ConfigSource } from '../../config/load.js';
import { CATALOG } from '../catalog.js';
import { PINNED_MODELS, createJevGateway } from '../gateway.js';
import type { Jev_Request } from '../types.js';

type Provider = 'openrouter' | 'typesafe';

const providers = fc.constantFrom<Provider>('openrouter', 'typesafe');
const sources = fc.constantFrom<ConfigSource>('default', 'flag', 'env', 'file');

/** A model valid for both providers (OpenRouter needs `typesafe/<name>` or `~typesafe/<name>`). */
const models = fc
  .tuple(fc.constantFrom('', '~'), fc.stringMatching(/^[a-z][a-z0-9.-]{0,15}$/))
  .map(([tilde, name]) => `${tilde}typesafe/${name}`);

const KEY_NAMES: Record<Provider, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
};

function loaded(provider: Provider, model: string, source: ConfigSource): LoadedConfig {
  const sourceMap: Record<string, ConfigSource> = { 'jev.provider': 'file', 'jev.model': source };
  const meta = { fileRead: null, fileIgnored: null, ignoredEnvNames: [], sources: sourceMap };
  const config = { jev: { provider, model } } as never;
  return {
    ok: true,
    config,
    meta,
    redacted: { config, meta, credentials: { provider, envVar: KEY_NAMES[provider] } },
  } as LoadedConfig;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function bodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return String(body);
}

describe('jev-gateway properties', () => {
  // Feature: jev-gateway, Property 4: Requested model resolution depends only on the configured source
  // **Validates: Requirements 4.6, 4.7, 4.9**
  it('Property 4: the requested model is PINNED_MODELS[provider] for default, else the configured model, on every request', async () => {
    await fc.assert(
      fc.asyncProperty(providers, models, sources, async (provider, model, source) => {
        const sent: string[] = [];
        const fakeFetch = (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
          const body = JSON.parse(bodyText(init?.body)) as {
            model: string;
            questions: Record<string, { type: string }>;
          };
          sent.push(body.model);
          const answers: Record<string, unknown> = {};
          for (const [name, q] of Object.entries(body.questions)) {
            answers[name] =
              q.type === 'box'
                ? { type: 'box', box: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 }, confidence: 0.5 }
                : { type: 'noul', noul: 0.5 };
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                model: `${body.model}-dated`,
                answers,
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        };

        const created = createJevGateway(
          loaded(provider, model, source),
          { [KEY_NAMES[provider]]: 'fake-key-value' },
          { fetch: fakeFetch as never },
        );
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const expected = source === 'default' ? PINNED_MODELS[provider] : model;
        expect(created.gateway.requestedModel).toBe(expected);

        const text: Jev_Request = {
          stage: 'assessment',
          state: 'claim: something',
          questions: { q: CATALOG.assessRuntimeObservable.built() },
        };
        await created.gateway.ask(text);
        await created.gateway.ask(text);
        const imageRequest: Jev_Request = {
          stage: 'runtime',
          state: withAssets`claim: x\nscreenshot: ${image(PNG)}`,
          questions: { q: CATALOG.runtimeStateReached.built() },
        };
        await created.gateway.ask(imageRequest);

        expect(sent).toHaveLength(3);
        for (const m of sent) expect(m).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
