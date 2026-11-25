import { describe, expect, it, vi } from 'vitest';
import { requireJevCredentials } from './credentials.js';
import { formatReport } from './errors.js';
import type { ConfigSource, LoadedConfig } from './load.js';

const fsSpies = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  readFile: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: fsSpies,
  readFileSync: fsSpies.readFileSync,
  existsSync: fsSpies.existsSync,
  statSync: fsSpies.statSync,
}));
vi.mock('node:fs/promises', () => ({
  default: fsSpies,
  readFile: fsSpies.readFile,
}));
vi.mock('./load.js', () => ({ loadConfig: fsSpies.loadConfig }));

type Provider = 'openrouter' | 'typesafe';

function loaded(provider: Provider | undefined, source?: ConfigSource): LoadedConfig {
  const sources: Record<string, ConfigSource> = {};
  if (source !== undefined) sources['jev.provider'] = source;
  const meta = { fileRead: null, fileIgnored: null, ignoredEnvNames: [], sources };
  const config = (provider === undefined ? {} : { jev: { provider } }) as never;
  return { ok: true, config, meta, redacted: { config, meta } as never } as LoadedConfig;
}

const KEYS: Array<[Provider, string]> = [
  ['openrouter', 'OPENROUTER_API_KEY'],
  ['typesafe', 'TYPESAFE_API_KEY'],
];

describe('requireJevCredentials', () => {
  for (const [provider, keyName] of KEYS) {
    describe(provider, () => {
      for (const [label, env] of [
        ['missing', {}],
        ['empty', { [keyName]: '' }],
      ] as const) {
        it(`fails when the key is ${label}, names the variable, leaks no value`, () => {
          const result = requireJevCredentials(loaded(provider, 'file'), { ...env });
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.errors).toHaveLength(1);
          const text = JSON.stringify(result.errors);
          expect(text).toContain(keyName);
          expect(formatReport(result.errors, [])).toContain(keyName);
        });
      }

      it('does not include another provider key value in the failure', () => {
        const other = provider === 'openrouter' ? 'TYPESAFE_API_KEY' : 'OPENROUTER_API_KEY';
        const result = requireJevCredentials(loaded(provider, 'file'), {
          [other]: 'sk-other-secret-value',
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(JSON.stringify(result.errors)).not.toContain('sk-other-secret-value');
      });

      it('succeeds when the key is present', () => {
        expect(
          requireJevCredentials(loaded(provider, 'file'), { [keyName]: 'sk-present-value' }),
        ).toEqual({ ok: true });
      });
    });
  }

  describe('failure source', () => {
    const cases: Array<[ConfigSource, LoadedConfig]> = [
      ['flag', loaded('typesafe', 'flag')],
      ['env', loaded('typesafe', 'env')],
      ['file', loaded('typesafe', 'file')],
      ['default', loaded(undefined, 'default')],
    ];
    for (const [source, config] of cases) {
      it(`reports source "${source}" in the error and in formatReport`, () => {
        const result = requireJevCredentials(config, {});
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors[0]?.source).toBe(source);
        expect(formatReport(result.errors, [])).toContain(source);
      });
    }
  });

  it('does not call fs or loadConfig', () => {
    requireJevCredentials(loaded('openrouter', 'default'), {});
    requireJevCredentials(loaded('openrouter', 'default'), { OPENROUTER_API_KEY: 'k' });
    for (const spy of Object.values(fsSpies)) expect(spy).not.toHaveBeenCalled();
  });
});
