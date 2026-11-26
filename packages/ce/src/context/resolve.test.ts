import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { StageError } from '../errors.js';
import { resolveContext } from './resolve.js';
import type { ResolveContextOptions } from './resolve.js';
import type { Provenance } from './types.js';

type Providers = NonNullable<ResolveContextOptions['providers']>;

const fakes: Required<Providers> = {
  git: () => ({
    files: [],
    commits: [],
    truncated: [],
    status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
  }),
  github: () => ({ status: { name: 'github', status: 'unavailable', reason: 'source-absent' } }),
  cli: () => ({ claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } }),
  junit: () => ({
    checks: [],
    status: { name: 'junit', status: 'unavailable', reason: 'not-configured' },
  }),
};

const SECRET = 'sk-abcdefghijklmnopqrstuvwx1';
const base = { config: {}, cliOptions: {}, env: {}, cwd: '/nonexistent' } as const;
const gitProv: Provenance = { provider: 'git', location: 'HEAD' };

describe('resolveContext integration', () => {
  it('returns an empty valid context when all four providers are unavailable', () => {
    const ctx = resolveContext({ ...base, providers: fakes });
    expect(ctx.providers).toEqual([
      { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
      { name: 'github', status: 'unavailable', reason: 'source-absent' },
      { name: 'cli', status: 'unavailable', reason: 'no-input' },
      { name: 'junit', status: 'unavailable', reason: 'not-configured' },
    ]);
    expect(ctx.change.files).toEqual([]);
    expect(ctx.change.commits).toEqual([]);
    expect(ctx.change.claims).toEqual([]);
    expect(ctx.checks).toEqual([]);
    expect(ctx.candidates).toEqual([]);
    expect(ctx.truncated).toEqual([]);
    expect(ctx.redactions).toEqual([]);
  });

  it('throws StageError with stage context for a bad context.redact pattern', () => {
    let error: unknown;
    try {
      resolveContext({ ...base, config: { context: { redact: ['(?i)x'] } }, providers: fakes });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('context');
  });

  it('removes a secret from a commit message, a --claim and a GitHub payload', () => {
    const ctx = resolveContext({
      ...base,
      cliOptions: { claim: [`claim with ${SECRET}`] },
      providers: {
        ...fakes,
        git: () => ({
          files: [],
          commits: [{ sha: 'a'.repeat(40), message: `fix login ${SECRET}`, provenance: gitProv }],
          head: { sha: 'a'.repeat(40), provenance: gitProv },
          truncated: [],
          status: { name: 'git', status: 'used' },
        }),
        github: () => ({
          pullRequest: { title: `title ${SECRET}`, body: `body ${SECRET}`, baseSha: 'b'.repeat(40) },
          status: { name: 'github', status: 'used' },
        }),
        cli: () => ({
          claims: [
            { text: `claim with ${SECRET}`, provenance: { provider: 'cli', location: '--claim[1]' } },
          ],
          status: { name: 'cli', status: 'used' },
        }),
      },
    });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain(SECRET);
    expect(ctx.change.commits[0]?.message).toContain('[REDACTED]');
    expect(ctx.change.claims[0]?.text).toContain('[REDACTED]');
    expect(ctx.change.title).toContain('[REDACTED]');
    expect(ctx.change.description).toContain('[REDACTED]');
    expect(ctx.redactions.length).toBeGreaterThanOrEqual(4);
  });

  it('caps more than 200 Check_Results, keeps all failed, records check:<n>', () => {
    const checks: ReturnType<Required<Providers>['junit']>['checks'] = [];
    for (let i = 0; i < 250; i++) {
      checks.push({
        name: `t${i}`,
        status: i % 5 === 0 ? 'failed' : 'passed',
        provenance: { provider: 'junit', location: `r.xml#${i}` },
      });
    }
    const failedIn = checks.filter((c) => c.status === 'failed').length; // 50
    const ctx = resolveContext({
      ...base,
      providers: { ...fakes, junit: () => ({ checks, status: { name: 'junit', status: 'used' } }) },
    });
    expect(ctx.checks).toHaveLength(200);
    expect(ctx.checks.filter((c) => c.status === 'failed')).toHaveLength(failedIn);
    expect(ctx.truncated).toContainEqual({ file: 'check:50', reason: 'check-cap' });
  });

  it('keeps provider cli on a --claim text duplicated by another source', () => {
    const text = 'Login now rejects empty passwords.';
    const ctx = resolveContext({
      ...base,
      cliOptions: { claim: [text] },
      providers: {
        ...fakes,
        github: () => ({
          pullRequest: { title: text },
          status: { name: 'github', status: 'used' },
        }),
        cli: () => ({
          claims: [{ text, provenance: { provider: 'cli', location: '--claim[1]' } }],
          status: { name: 'cli', status: 'used' },
        }),
      },
    });
    // The GitHub payload has no base, so its status may become unavailable; the
    // claim must still win either way.
    const matches = ctx.candidates.filter((c) => c.text === text);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.provenance.provider).toBe('cli');
  });

  it('produces a JSON-serializable result that survives a round trip', () => {
    const ctx = resolveContext({
      ...base,
      cliOptions: { claim: ['Adds a logout button.'] },
      providers: {
        ...fakes,
        cli: () => ({
          claims: [{ text: 'Adds a logout button.', provenance: { provider: 'cli', location: '--claim[1]' } }],
          status: { name: 'cli', status: 'used' },
        }),
      },
    });
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(ctx);
  });

  it('imports nothing from jev/ and no network module in context/ sources', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    const importRe = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(importRe)) {
        const spec = m[1]!;
        expect(spec, f).not.toMatch(/(^|\/)jev(\/|$)/);
        expect(spec, f).not.toMatch(/^(node:)?(http|https|net|dns|tls|http2|dgram)$/);
      }
      expect(src, f).not.toMatch(/\bfetch\(/);
    }
  });
});
