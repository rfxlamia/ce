import { COMMENT_MARKER } from 'continuous-evidence';
import { describe, expect, it } from 'vitest';
import { describeApiFailure, upsertComment, type CommentApi } from './upsert.js';

type Stored = { id: number; body: string; user: { login: string } };

function fakeApi(seed: Stored[] = [], pageSize = 100) {
  const comments: Stored[] = [...seed];
  let nextId = Math.max(0, ...seed.map((c) => c.id)) + 1;
  const calls = { list: [] as number[], create: 0, update: [] as number[] };
  const api: CommentApi = {
    async listComments(_pr, page) {
      calls.list.push(page);
      return comments.slice((page - 1) * pageSize, page * pageSize);
    },
    async createComment(_pr, body) {
      calls.create++;
      const c = { id: nextId++, body, user: { login: 'github-actions[bot]' } };
      comments.push(c);
      return { id: c.id, html_url: `https://x/c/${c.id}` };
    },
    async updateComment(id, body) {
      calls.update.push(id);
      const c = comments.find((x) => x.id === id)!;
      c.body = body;
      return { id, html_url: `https://x/c/${id}` };
    },
  };
  return { api, comments, calls };
}

const body = (n: number) => `${COMMENT_MARKER}\nrun ${n}`;

describe('upsertComment idempotence (Requirements 11.2, 11.3, 11.9)', () => {
  for (const author of ['github-actions[bot]', 'alice']) {
    it(`leaves one marker comment after three runs as ${author}`, async () => {
      const { api, comments, calls } = fakeApi();
      // For a human login the created comment must carry that login.
      const create = api.createComment;
      api.createComment = async (pr, b) => {
        const r = await create(pr, b);
        comments[comments.length - 1]!.user.login = author;
        return r;
      };
      const urls: string[] = [];
      for (let i = 1; i <= 3; i++) urls.push((await upsertComment(api, 7, author, body(i))).url);
      const mine = comments.filter((c) => c.user.login === author && c.body.includes(COMMENT_MARKER));
      expect(mine).toHaveLength(1);
      expect(mine[0]!.body).toBe(body(3));
      expect(calls.create).toBe(1);
      expect(calls.update).toHaveLength(2);
      expect(new Set(urls).size).toBe(1);
    });
  }

  it('updates the oldest when several match', async () => {
    const { api, calls } = fakeApi([
      { id: 9, body: body(0), user: { login: 'alice' } },
      { id: 4, body: body(0), user: { login: 'alice' } },
    ]);
    await upsertComment(api, 1, 'alice', body(1));
    expect(calls.update).toEqual([4]);
  });
});

describe('upsertComment other authors (Requirement 11.4)', () => {
  it('leaves marker comments from another user or bot untouched and creates its own', async () => {
    const seed: Stored[] = [
      { id: 1, body: body(0), user: { login: 'bob' } },
      { id: 2, body: body(0), user: { login: 'dependabot[bot]' } },
    ];
    const { api, comments, calls } = fakeApi(seed);
    await upsertComment(api, 1, 'github-actions[bot]', body(1));
    expect(calls.update).toEqual([]);
    expect(calls.create).toBe(1);
    expect(comments[0]!.body).toBe(body(0));
    expect(comments[1]!.body).toBe(body(0));
    expect(comments).toHaveLength(3);
  });

  it('ignores own comments without the marker', async () => {
    const { api, calls } = fakeApi([{ id: 1, body: 'hello', user: { login: 'alice' } }]);
    await upsertComment(api, 1, 'alice', body(1));
    expect(calls.create).toBe(1);
    expect(calls.update).toEqual([]);
  });
});

describe('upsertComment pagination (Requirement 11.10)', () => {
  it('finds a matching comment on page two', async () => {
    const seed: Stored[] = [
      { id: 1, body: 'a', user: { login: 'x' } },
      { id: 2, body: 'b', user: { login: 'y' } },
      { id: 3, body: body(0), user: { login: 'alice' } },
    ];
    const { api, calls } = fakeApi(seed, 2);
    await upsertComment(api, 1, 'alice', body(1));
    expect(calls.update).toEqual([3]);
    expect(calls.create).toBe(0);
    expect(calls.list).toEqual([1, 2, 3]);
  });
});

describe('describeApiFailure (Requirement 11.6)', () => {
  it('names the 403 status and the missing permission, no token', () => {
    const msg = describeApiFailure({ status: 403, message: 'token ghs_secret' });
    expect(msg).toContain('HTTP 403');
    expect(msg).toContain('pull-requests: write');
    expect(msg).not.toContain('ghs_secret');
  });

  it('reports another status without the permission hint', () => {
    const msg = describeApiFailure({ status: 500, message: 'ghs_secret' });
    expect(msg).toContain('HTTP 500');
    expect(msg).not.toContain('pull-requests: write');
    expect(msg).not.toContain('ghs_secret');
  });

  it('handles an error without a status', () => {
    const msg = describeApiFailure(new Error('boom ghs_secret'));
    expect(msg).toContain('no HTTP status');
    expect(msg).not.toContain('ghs_secret');
  });
});
