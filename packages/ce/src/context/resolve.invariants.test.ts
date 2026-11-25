import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveContext } from './resolve.js';
import type { ResolveContextOptions } from './resolve.js';
import type { GitExecOptions, GitExecResult } from './providers/git.js';
import type { Provenance } from './types.js';

type Providers = NonNullable<ResolveContextOptions['providers']>;

const RUNS = { numRuns: 100 };
const SECRET = 'sk-abcdefghijklmnopqrstuvwx1';

const baseFakes: Required<Providers> = {
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

// ---------------------------------------------------------------------------
// Property 5

// Text with optional embedded secret and optional bulk to force budgeting.
const textArb = fc
  .record({
    body: fc.string({ maxLength: 40 }),
    secret: fc.boolean(),
    // 0: small, 1: large enough to overflow the 24k-token context budget alone
    size: fc.constantFrom(0, 0, 0, 0, 0, 0, 0, 1),
  })
  .map(({ body, secret, size }) => {
    const bulk = size === 1 ? 'some long line of text\n'.repeat(4000) : '';
    return `${body}${secret ? ` ${SECRET} ` : ''}\n${bulk}`;
  });

describe('Feature: ce-context-resolver, Property 5: Provenance survives redaction and budgeting unchanged', () => {
  it('keeps every Provenance object identical through the Redactor and Budgeter', () => {
    fc.assert(
      fc.property(
        fc.record({
          title: fc.option(textArb, { nil: undefined }),
          body: fc.option(textArb, { nil: undefined }),
          claims: fc.array(textArb, { maxLength: 4 }),
          commits: fc.array(textArb, { maxLength: 4 }),
          files: fc.array(
            fc.record({
              patch: textArb,
              status: fc.constantFrom('added', 'modified', 'deleted', 'renamed' as const),
            }),
            { maxLength: 5 },
          ),
          checks: fc.array(
            fc.record({
              name: textArb,
              status: fc.constantFrom('passed', 'failed', 'skipped' as const),
            }),
            { maxLength: 5 },
          ),
        }),
        (g) => {
          const claimProv = (i: number): Provenance => ({ provider: 'cli', location: `--claim[${i + 1}]` });
          const commitProv = (i: number): Provenance => ({ provider: 'git', ref: `c${i}`, location: 'message' });
          const fileProv = (i: number): Provenance => ({ provider: 'git', ref: 'h'.repeat(8), location: `src/f${i}.ts` });
          const checkProv = (i: number): Provenance => ({ provider: 'junit', location: `r${i}.xml` });
          const baseProv: Provenance = { provider: 'cli', location: '--base' };
          const headProv: Provenance = { provider: 'git', location: 'HEAD' };

          const ctx = resolveContext({
            config: {},
            cliOptions: {},
            env: {},
            cwd: '/nonexistent',
            providers: {
              ...baseFakes,
              cli: () => ({
                claims: g.claims.map((text, i) => ({ text, provenance: claimProv(i) })),
                base: { ref: 'b', provenance: baseProv },
                status: { name: 'cli', status: 'used' },
              }),
              github: () => ({
                pullRequest: {
                  ...(g.title !== undefined ? { title: g.title } : {}),
                  ...(g.body !== undefined ? { body: g.body } : {}),
                },
                status: { name: 'github', status: 'used' },
              }),
              git: () => ({
                files: g.files.map((f, i) => ({
                  path: `src/f${i}.ts`,
                  status: f.status,
                  patch: f.patch,
                  provenance: fileProv(i),
                })),
                commits: g.commits.map((message, i) => ({ sha: `c${i}`, message, provenance: commitProv(i) })),
                head: { sha: 'h'.repeat(8), provenance: headProv },
                truncated: [],
                status: { name: 'git', status: 'used' },
              }),
              junit: () => ({
                checks: g.checks.map((c, i) => ({ ...c, provenance: checkProv(i) })),
                status: { name: 'junit', status: 'used' },
              }),
            },
          });

          for (const c of ctx.change.claims) {
            const i = Number(/\[(\d+)\]/.exec(c.provenance.location ?? '')?.[1]) - 1;
            expect(c.provenance).toEqual(claimProv(i));
          }
          for (const c of ctx.change.commits) {
            const i = Number(c.sha.slice(1));
            expect(c.provenance).toEqual(commitProv(i));
          }
          for (const f of ctx.change.files) {
            const i = Number(/f(\d+)\.ts/.exec(f.path)?.[1]);
            expect(f.provenance).toEqual(fileProv(i));
          }
          for (const c of ctx.checks) {
            const i = Number(/r(\d+)\.xml/.exec(c.provenance.location ?? '')?.[1]);
            expect(c.provenance).toEqual(checkProv(i));
          }
          // Change-level provenance list: present for each field read, even when
          // the text was truncated or dropped by the Budgeter.
          const expected: Provenance[] = [];
          if (g.title !== undefined) expected.push({ provider: 'github', location: 'title' });
          if (g.body !== undefined) expected.push({ provider: 'github', location: 'description' });
          expected.push(baseProv, headProv);
          expect(ctx.change.provenance).toEqual(expected);
        },
      ),
      { ...RUNS, numRuns: 100 },
    );
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Property 6

const SENSITIVE_BASES = [
  '.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  '.npmrc', '.netrc', '.git-credentials', '.pypirc', 'server.pem', 'tls.key', 'store.p12', 'cert.pfx',
];

const mixCase = (s: string, flips: boolean[]): string =>
  [...s].map((ch, i) => (flips[i % flips.length] ? ch.toUpperCase() : ch.toLowerCase())).join('');

const globArb = fc.constantFrom(
  '**', '*', '**/*', 'src/**', '**/*.ts', '**/.env*', '**/*.pem', '**/*.key', 'd0/**', 'd1/**', '**/id_*',
);

const sha = 'a'.repeat(40);

/** Fake git: reports every entry and, adversarially, returns patches for all of them. */
function fakeExec(
  entries: { path: string; oldPath?: string; content: string }[],
): (args: string[], o: GitExecOptions) => GitExecResult {
  return (args) => {
    const i = args.indexOf('rev-parse') >= 0 ? args.indexOf('rev-parse') : -1;
    if (i >= 0) {
      return args.includes('--is-inside-work-tree')
        ? { stdout: 'true\n', stderr: '' }
        : { stdout: `${sha}\n`, stderr: '' };
    }
    if (args.includes('merge-base')) return { stdout: `${sha}\n`, stderr: '' };
    if (args.includes('log')) return { stdout: '', stderr: '' };
    if (args.includes('--name-status')) {
      const out = entries
        .map((e) => (e.oldPath !== undefined ? `R100\0${e.oldPath}\0${e.path}\0` : `M\0${e.path}\0`))
        .join('');
      return { stdout: out, stderr: '' };
    }
    const out = entries
      .map(
        (e) =>
          `diff --git a/${e.oldPath ?? e.path} b/${e.path}\n--- a/${e.oldPath ?? e.path}\n+++ b/${e.path}\n@@ -0,0 +1 @@\n+${e.content}\n`,
      )
      .join('');
    return { stdout: out, stderr: '' };
  };
}

describe('Feature: ce-context-resolver, Property 6: Sensitive file content never reaches the Change_Context', () => {
  it('never leaks Sensitive_File patch content under any include/exclude', () => {
    fc.assert(
      fc.property(
        fc.record({
          sensitive: fc.array(
            fc.record({
              base: fc.constantFrom(...SENSITIVE_BASES),
              flips: fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
              renamedFrom: fc.boolean(),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          normalCount: fc.integer({ min: 0, max: 4 }),
          include: fc.array(globArb, { maxLength: 3 }),
          exclude: fc.array(globArb, { maxLength: 3 }),
        }),
        (g) => {
          const entries: { path: string; oldPath?: string; content: string; sensitive: boolean }[] = [];
          g.sensitive.forEach((s, i) => {
            const name = mixCase(s.base, s.flips);
            const content = `SENSITIVEPAYLOAD${i}ZZ`;
            if (s.renamedFrom) {
              entries.push({ path: `d${i}/renamed.txt`, oldPath: `d${i}/${name}`, content, sensitive: true });
            } else {
              entries.push({ path: `d${i}/${name}`, content, sensitive: true });
            }
          });
          for (let i = 0; i < g.normalCount; i++) {
            entries.push({ path: `src/n${i}.ts`, content: `plain change ${i}`, sensitive: false });
          }

          const ctx = resolveContext({
            config: { context: { include: g.include, exclude: g.exclude } },
            cliOptions: {},
            env: {},
            cwd: '/nonexistent',
            providers: { ...baseFakes, git: undefined as never },
            exec: fakeExec(entries),
          });

          const serialized = JSON.stringify(ctx);
          expect(serialized).not.toMatch(/SENSITIVEPAYLOAD/);
          const sensitivePaths = new Set(entries.filter((e) => e.sensitive).map((e) => e.path));
          for (const f of ctx.change.files) {
            if (sensitivePaths.has(f.path)) expect(f.patch).toBe('');
          }
        },
      ),
      RUNS,
    );
  });

  it('drives the real git provider (not a stub) so the generator reaches the file list', () => {
    const ctx = resolveContext({
      config: {},
      cliOptions: {},
      env: {},
      cwd: '/nonexistent',
      providers: { ...baseFakes, git: undefined as never },
      exec: fakeExec([
        { path: '.ENV', content: 'SENSITIVEPAYLOAD0ZZ' },
        { path: 'a.ts', content: 'ok' },
      ]),
    });
    expect(ctx.change.files.map((f) => f.path)).toEqual(['.ENV', 'a.ts']);
    expect(ctx.change.files[0]?.patch).toBe('');
    expect(ctx.change.files[1]?.patch).toContain('+ok');
  });
});
