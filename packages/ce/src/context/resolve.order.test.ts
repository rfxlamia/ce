import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveContext } from './resolve.js';
import type { ResolveContextOptions } from './resolve.js';
import type { ChangedFile, Provenance } from './types.js';

// resolveContext and all four Provider seams are synchronous, so "arrival
// order" is not a timing property here. What can vary is (a) the order in
// which the Providers are supplied to the injection point and (b) the order in
// which the fakes are invoked. The test varies both and compares the whole
// ChangeContext, array order included.

type Providers = NonNullable<ResolveContextOptions['providers']>;
type Name = 'git' | 'github' | 'cli' | 'junit';

const prov = (provider: Provenance['provider'], location?: string): Provenance => ({
  provider,
  ...(location !== undefined ? { location } : {}),
});

const text = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() === s && s !== '');
const pathArb = fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,2}\.(ts|md|css|txt)$/);

const fileArb = (path: string): fc.Arbitrary<ChangedFile> =>
  fc.record({
    status: fc.constantFrom('added', 'modified', 'deleted'),
    patch: fc.array(text, { maxLength: 4 }).map((ls) => ls.map((l) => `+${l}`).join('\n')),
  }).map(({ status, patch }) => ({
    path,
    status,
    patch,
    provenance: prov('git', path),
  }));

const dataArb = fc.record({
  files: fc.uniqueArray(pathArb, { maxLength: 6 }).chain((paths) =>
    fc.tuple(...paths.map(fileArb)),
  ),
  commits: fc.array(text, { maxLength: 4 }),
  title: fc.option(text, { nil: undefined }),
  body: fc.option(fc.array(text, { maxLength: 3 }).map((a) => a.join('. ')), { nil: undefined }),
  claims: fc.array(text, { maxLength: 4 }),
  checks: fc.array(
    fc.record({ name: text, status: fc.constantFrom('passed', 'failed', 'skipped') as fc.Arbitrary<'passed' | 'failed' | 'skipped'> }),
    { maxLength: 6 },
  ),
  gitUsed: fc.boolean(),
  githubUsed: fc.boolean(),
});

type DataShape = {
  files: ChangedFile[];
  commits: string[];
  title: string | undefined;
  body: string | undefined;
  claims: string[];
  checks: { name: string; status: 'passed' | 'failed' | 'skipped' }[];
  gitUsed: boolean;
  githubUsed: boolean;
};

function build(d: DataShape, order: Name[], callLog: Name[]): Providers {
  const all: Required<Providers> = {
    git: () => {
      callLog.push('git');
      return d.gitUsed
        ? {
            files: d.files.map((f) => ({ ...f })),
            commits: d.commits.map((message, i) => ({
              sha: `sha${i}`,
              message,
              provenance: prov('git', `sha${i}`),
            })),
            head: { sha: 'headsha', provenance: prov('git', 'HEAD') },
            truncated: [],
            status: { name: 'git', status: 'used' },
          }
        : {
            files: [],
            commits: [],
            truncated: [],
            status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
          };
    },
    github: () => {
      callLog.push('github');
      return d.githubUsed
        ? {
            pullRequest: {
              ...(d.title !== undefined ? { title: d.title } : {}),
              ...(d.body !== undefined ? { body: d.body } : {}),
              baseSha: 'basesha',
            },
            status: { name: 'github', status: 'used' },
          }
        : { status: { name: 'github', status: 'unavailable', reason: 'source-absent' } };
    },
    cli: () => {
      callLog.push('cli');
      return d.claims.length > 0
        ? {
            claims: d.claims.map((t, i) => ({ text: t, provenance: prov('cli', `--claim[${i + 1}]`) })),
            status: { name: 'cli', status: 'used' },
          }
        : { claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } };
    },
    junit: () => {
      callLog.push('junit');
      return d.checks.length > 0
        ? {
            checks: d.checks.map((c, i) => ({ ...c, provenance: prov('junit', `r.xml#${i}`) })),
            status: { name: 'junit', status: 'used' },
          }
        : { checks: [], status: { name: 'junit', status: 'unavailable', reason: 'not-configured' } };
    },
  } as unknown as Required<Providers>;
  // Insertion order of the injected object follows the generated order.
  const out: Record<string, unknown> = {};
  for (const n of order) out[n] = all[n];
  return out as Providers;
}

const exec: NonNullable<ResolveContextOptions['exec']> = (args) =>
  args.includes('rev-parse') ? { stdout: 'abc\n', stderr: '' } : { error: Object.assign(new Error('x'), { code: '1' }) };

const run = (providers: Providers) =>
  resolveContext({ config: {}, cliOptions: {}, env: {}, cwd: '/nonexistent', providers, exec });

describe('Feature: ce-context-resolver, Property 14', () => {
  it('resolveContext is independent of Provider arrival order', () => {
    // Validates: Requirements 10.4, 11.5
    const names: Name[] = ['git', 'github', 'cli', 'junit'];
    fc.assert(
      fc.property(
        dataArb as unknown as fc.Arbitrary<DataShape>,
        fc.shuffledSubarray(names, { minLength: 4, maxLength: 4 }),
        (d, order) => {
          const canonLog: Name[] = [];
          const canonical = run(build(d, names, canonLog));
          const log: Name[] = [];
          const result = run(build(d, order, log));
          expect(result).toEqual(canonical);
          expect(JSON.stringify(result)).toBe(JSON.stringify(canonical));
          expect(result.providers.map((p) => p.name)).toEqual(names);
          expect([...log].sort()).toEqual([...names].sort());
          expect(result).not.toBeInstanceOf(Promise);
        },
      ),
      { numRuns: 100 },
    );
  });
});
