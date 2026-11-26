import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixtures, type EvalFixtureFile } from './fixture.js';
import {
  createStubExec,
  fixtureGithubProvider,
  fixtureGitProvider,
  type FixtureChangeInput,
} from './providers.js';

const BEHAVIOR = 'The page shows a banner.';
const CLI_CLAIM = 'Clicking save stores the form.';

function fixture(id: string, over: Partial<EvalFixtureFile> = {}): EvalFixtureFile {
  return {
    id,
    description: 'test fixture',
    change: {
      description: BEHAVIOR,
      commits: [{ sha: 'abc123', message: 'chore: wip' }],
      files: [{ path: 'src/a.txt', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }],
    },
    checks: [{ name: 'unit', status: 'passed' }],
    labels: {
      isBehavior: { [BEHAVIOR]: true, 'chore: wip': false },
      runtimeObservable: { [BEHAVIOR]: true },
      checksAdequate: { [BEHAVIOR]: false },
      surface: { [BEHAVIOR]: 'browser_ui' },
      claimStatus: 'identified',
      required: true,
    },
    ...over,
  };
}

let dir: string;
const fetchSpy = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ce-fixture-'));
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): void {
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
}

describe('loadFixtures', () => {
  it('loads valid fixtures in ascending file-name order', () => {
    write('b.json', fixture('b'));
    write('a.json', fixture('a'));
    write('c.json', fixture('c'));
    const r = loadFixtures(dir);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fixtures.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('reports file, field path, value and expected shape on schema failure', () => {
    const bad = { ...fixture('a'), labels: { ...fixture('a').labels, required: 'yes' } };
    write('a.json', bad);
    const r = loadFixtures(dir);
    expect(r).toMatchObject({
      ok: false,
      kind: 'schema',
      file: 'a.json',
      path: 'labels.required',
      value: 'yes',
    });
    if (!r.ok && r.kind === 'schema') expect(r.expected.length).toBeGreaterThan(0);
  });

  it('reports a schema failure for unparseable JSON and for an id/file-name mismatch', () => {
    write('a.json', '{ not json');
    expect(loadFixtures(dir)).toMatchObject({ ok: false, kind: 'schema', file: 'a.json' });
    write('a.json', fixture('other'));
    expect(loadFixtures(dir)).toMatchObject({ ok: false, kind: 'schema', file: 'a.json', path: 'id' });
  });

  it('rejects an unlabelled candidate', () => {
    const f = fixture('a');
    f.labels.isBehavior = { 'chore: wip': false };
    write('a.json', f);
    expect(loadFixtures(dir)).toMatchObject({
      ok: false,
      kind: 'unlabelled-candidate',
      fixtureId: 'a',
      candidateText: BEHAVIOR,
      missing: 'isBehavior',
    });
  });

  it('rejects a behavior candidate missing a downstream label', () => {
    const f = fixture('a');
    f.labels.surface = {};
    write('a.json', f);
    expect(loadFixtures(dir)).toMatchObject({
      ok: false,
      kind: 'unlabelled-candidate',
      missing: 'surface',
    });
  });

  it('rejects a label that matches no candidate', () => {
    const f = fixture('a');
    f.labels.isBehavior['No such candidate.'] = true;
    write('a.json', f);
    expect(loadFixtures(dir)).toMatchObject({
      ok: false,
      kind: 'unknown-label',
      fixtureId: 'a',
      candidateText: 'No such candidate.',
      label: 'isBehavior',
    });
  });

  it('rejects isBehavior on a cli candidate', () => {
    const f = fixture('a');
    f.change.claims = [CLI_CLAIM];
    f.labels.isBehavior[CLI_CLAIM] = true;
    for (const k of ['runtimeObservable', 'checksAdequate'] as const) f.labels[k][CLI_CLAIM] = true;
    f.labels.surface[CLI_CLAIM] = 'browser_ui';
    write('a.json', f);
    expect(loadFixtures(dir)).toMatchObject({
      ok: false,
      kind: 'unknown-label',
      candidateText: CLI_CLAIM,
      label: 'isBehavior',
    });
  });

  it('accepts a cli candidate labelled without isBehavior', () => {
    const f = fixture('a');
    f.change.claims = [CLI_CLAIM];
    for (const k of ['runtimeObservable', 'checksAdequate'] as const) f.labels[k][CLI_CLAIM] = true;
    f.labels.surface[CLI_CLAIM] = 'browser_ui';
    write('a.json', f);
    expect(loadFixtures(dir).ok).toBe(true);
  });

  it('fails on a missing directory', () => {
    const missing = join(dir, 'nope');
    expect(loadFixtures(missing)).toEqual({ ok: false, kind: 'directory', dir: missing });
  });

  it('fails on an empty directory and on a path that is a file', () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    expect(loadFixtures(empty)).toMatchObject({ ok: false, kind: 'directory' });
    write('x.txt', 'hi');
    expect(loadFixtures(join(dir, 'x.txt'))).toMatchObject({ ok: false, kind: 'directory' });
  });

  it('asks no Jev question on any failure', () => {
    write('a.json', { bad: true });
    expect(loadFixtures(dir).ok).toBe(false);
    const f = fixture('b');
    f.labels.isBehavior = {};
    rmSync(join(dir, 'a.json'));
    write('b.json', f);
    expect(loadFixtures(dir).ok).toBe(false);
    expect(loadFixtures(join(dir, 'missing')).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fixture providers', () => {
  const input = (change: Partial<FixtureChangeInput['change']>): FixtureChangeInput => ({
    change: { commits: [], files: [], ...change },
    checks: [],
  });

  it('stub exec records calls and returns an error result', () => {
    const stub = createStubExec();
    const r = stub.exec(['rev-parse', 'HEAD'], {} as never);
    expect(stub.calls).toEqual([{ args: ['rev-parse', 'HEAD'] }]);
    expect(r).toHaveProperty('error');
  });

  it('git fixture provider returns no headSha or baseSha', () => {
    const r = (fixtureGitProvider(input({})) as unknown as () => Record<string, unknown>)();
    expect(r).not.toHaveProperty('headSha');
    expect(r).not.toHaveProperty('baseSha');
  });

  it('github fixture provider is unavailable (source-absent) without title and description', () => {
    const r = (fixtureGithubProvider(input({})) as unknown as () => unknown)();
    expect(r).toEqual({ status: { name: 'github', status: 'unavailable', reason: 'source-absent' } });
  });

  it('github fixture provider returns title and description as body when present', () => {
    const r = (fixtureGithubProvider(input({ title: 'T', description: 'D' })) as unknown as () => {
      pullRequest: unknown;
    })();
    expect(r.pullRequest).toEqual({ title: 'T', body: 'D' });
    expect(r).not.toHaveProperty('headSha');
    expect(r).not.toHaveProperty('baseSha');
  });
});
