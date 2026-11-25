import { describe, expect, it } from 'vitest';
import { resolveGithubEvent } from './github-event.js';

const unavailable = { name: 'github', status: 'unavailable', reason: 'source-absent' };
const reader = (text: string | undefined) => () => text;

describe('resolveGithubEvent', () => {
  it('extracts pull request facts', () => {
    const payload = {
      pull_request: {
        title: 'Add login',
        body: 'Adds a login form.',
        base: { sha: 'b'.repeat(40), ref: 'main' },
        head: { sha: 'h'.repeat(40) },
      },
    };
    const r = resolveGithubEvent({ eventPath: '/ev.json', readFile: reader(JSON.stringify(payload)) });
    expect(r.status).toEqual({ name: 'github', status: 'used' });
    expect(r.provenance).toEqual({ provider: 'github', location: '/ev.json' });
    expect(r.pullRequest).toEqual({
      title: 'Add login',
      body: 'Adds a login form.',
      baseSha: 'b'.repeat(40),
      baseRef: 'main',
      headSha: 'h'.repeat(40),
    });
    expect(r.push).toBeUndefined();
  });

  it('omits non-string pull request fields (null body)', () => {
    const payload = { pull_request: { title: 'T', body: null, base: {}, head: 5 } };
    const r = resolveGithubEvent({ eventPath: 'e', readFile: reader(JSON.stringify(payload)) });
    expect(r.status.status).toBe('used');
    expect(r.pullRequest).toEqual({ title: 'T' });
  });

  it('extracts push before', () => {
    const r = resolveGithubEvent({
      eventPath: 'e',
      readFile: reader(JSON.stringify({ before: 'a'.repeat(40) })),
    });
    expect(r.status).toEqual({ name: 'github', status: 'used' });
    expect(r.push).toEqual({ before: 'a'.repeat(40) });
    expect(r.pullRequest).toBeUndefined();
  });

  it('prefers pull_request over push shape', () => {
    const r = resolveGithubEvent({
      eventPath: 'e',
      readFile: reader(JSON.stringify({ before: 'x', pull_request: { title: 'T' } })),
    });
    expect(r.pullRequest).toEqual({ title: 'T' });
    expect(r.push).toBeUndefined();
  });

  it.each([undefined, ''])('is source-absent when path is %j and never reads', (eventPath) => {
    let called = false;
    const r = resolveGithubEvent({
      eventPath,
      readFile: () => {
        called = true;
        return '{}';
      },
    });
    expect(r.status).toEqual(unavailable);
    expect(called).toBe(false);
  });

  it('is source-absent when the file is unreadable (returns undefined)', () => {
    expect(resolveGithubEvent({ eventPath: 'e', readFile: reader(undefined) }).status).toEqual(unavailable);
  });

  it('is source-absent when readFile throws', () => {
    const r = resolveGithubEvent({
      eventPath: 'e',
      readFile: () => {
        throw new Error('EACCES: /secret/path');
      },
    });
    expect(r.status).toEqual(unavailable);
    expect(JSON.stringify(r)).not.toContain('EACCES');
  });

  it.each(['not json {', '[]', '"str"', 'null', '42'])('is source-absent for payload %s', (text) => {
    expect(resolveGithubEvent({ eventPath: 'e', readFile: reader(text) }).status).toEqual(unavailable);
  });

  it('is source-absent when payload has neither shape', () => {
    const r = resolveGithubEvent({ eventPath: 'e', readFile: reader(JSON.stringify({ action: 'x' })) });
    expect(r.status).toEqual(unavailable);
    expect(r.provenance).toBeUndefined();
  });

  it('does not read process.env', () => {
    const before = process.env.GITHUB_EVENT_PATH;
    process.env.GITHUB_EVENT_PATH = '/should/not/be/used';
    try {
      const r = resolveGithubEvent({ readFile: () => '{"before":"a"}' });
      expect(r.status).toEqual(unavailable);
    } finally {
      if (before === undefined) delete process.env.GITHUB_EVENT_PATH;
      else process.env.GITHUB_EVENT_PATH = before;
    }
  });
});
