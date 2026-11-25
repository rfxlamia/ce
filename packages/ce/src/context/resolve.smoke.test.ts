import { describe, expect, it } from 'vitest';
import { StageError } from '../errors.js';
import { resolveContext } from './resolve.js';
import type { ResolveContextOptions } from './resolve.js';

type Providers = NonNullable<ResolveContextOptions['providers']>;

const fakes: Required<Providers> = {
  git: () => ({
    files: [],
    commits: [],
    truncated: [],
    status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
  }),
  github: () => ({ status: { name: 'github', status: 'unavailable', reason: 'source-absent' } }),
  cli: () => ({
    claims: [],
    status: { name: 'cli', status: 'unavailable', reason: 'no-input' },
  }),
  junit: () => ({
    checks: [],
    status: { name: 'junit', status: 'unavailable', reason: 'not-configured' },
  }),
};

describe('resolveContext smoke', () => {
  it('returns an empty valid context when all providers are unavailable', () => {
    const ctx = resolveContext({ config: {}, cliOptions: {}, env: {}, cwd: '/nonexistent', providers: fakes });
    expect(ctx.providers.map((p) => p.name)).toEqual(['git', 'github', 'cli', 'junit']);
    expect(ctx.providers.every((p) => p.status === 'unavailable')).toBe(true);
    expect(ctx.change.files).toEqual([]);
    expect(ctx.candidates).toEqual([]);
    expect(ctx.truncated).toEqual([]);
    expect(() => JSON.stringify(ctx)).not.toThrow();
  });

  it('redacts secrets in claims and records the count', () => {
    const text = 'uses key sk-abcdefghijklmnopqrstuvwx1 here';
    const ctx = resolveContext({
      config: {},
      cliOptions: { claim: [text] },
      env: {},
      cwd: '/nonexistent',
      providers: {
        ...fakes,
        cli: () => ({
          claims: [{ text, provenance: { provider: 'cli', location: '--claim[1]' } }],
          status: { name: 'cli', status: 'used' },
        }),
      },
    });
    expect(ctx.change.claims[0]?.text).toContain('[REDACTED]');
    expect(ctx.redactions).toEqual([{ file: 'claim:1', count: 1 }]);
  });

  it('throws StageError for an invalid redact pattern', () => {
    expect(() =>
      resolveContext({
        config: { context: { redact: ['(?i)x'] } },
        cliOptions: {},
        env: {},
        cwd: '/nonexistent',
        providers: fakes,
      }),
    ).toThrow(StageError);
  });
});
