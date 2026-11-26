import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Stage } from '../errors.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { FakeJevGateway } from '../jev/fake.js';
import type { Recording } from '../jev/fake.js';
import { stateHash } from '../jev/hash.js';
import type { CallLog, CallLogEntry } from '../jev/log.js';
import type { BuiltCatalogQuestion, Jev_Request } from '../jev/types.js';
import { EvalMemoGateway } from './memo.js';

function built(name: string, version = 1): BuiltCatalogQuestion {
  return {
    id: name,
    version,
    idVersion: `${name}@${version}`,
    type: 'noul',
    requiresImage: false,
    labelsFixed: true,
    question: { type: 'noul', instructions: name } as unknown as BuiltCatalogQuestion['question'],
  };
}

function request(stage: Stage, state: string, names: Array<[string, number?]>): Jev_Request {
  const questions: Record<string, BuiltCatalogQuestion> = {};
  for (const [name, version] of names) questions[name] = built(name, version);
  return { stage, state, questions };
}

/** Deterministic answer derived only from the request, so equal requests give equal answers. */
function answerFor(req: Jev_Request): Jev_Response {
  const answers: Jev_Response['answers'] = {};
  const seed = stateHash(req.state).slice(0, 4);
  for (const [name, q] of Object.entries(req.questions)) {
    answers[name] = {
      type: 'noul',
      noul: (parseInt(seed, 16) % 100) / 100,
      tag: `${req.stage}|${q.idVersion}`,
    } as unknown as Jev_Response['answers'][string];
  }
  return { model: 'm', answers, usage: { input_tokens: 1, output_tokens: 1 } };
}

class CountingGateway implements JevGateway {
  calls = 0;
  failNext = 0;
  async ask(req: Jev_Request): Promise<Jev_Response> {
    this.calls += 1;
    await Promise.resolve();
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('boom');
    }
    return answerFor(req);
  }
}

const base = request('assessment', 'state', [['q', 1]]);

describe('EvalMemoGateway', () => {
  it('sends two identical requests to the underlying gateway once', async () => {
    const inner = new CountingGateway();
    const memo = new EvalMemoGateway(inner);
    const a = await memo.ask(base);
    const b = await memo.ask(structuredClone(base));
    expect(inner.calls).toBe(1);
    expect(b).toEqual(a);
    expect(memo.stats).toEqual({ requests: 1, memoHits: 1 });
  });

  it('sends requests differing in state, question set or stage separately', async () => {
    const inner = new CountingGateway();
    const memo = new EvalMemoGateway(inner);
    await memo.ask(base);
    await memo.ask(request('assessment', 'other state', [['q', 1]]));
    await memo.ask(request('assessment', 'state', [['q', 1], ['r', 1]]));
    await memo.ask(request('assessment', 'state', [['q', 2]]));
    await memo.ask(request('runtime', 'state', [['q', 1]]));
    expect(inner.calls).toBe(5);
    expect(memo.stats).toEqual({ requests: 5, memoHits: 0 });
  });

  it('treats question order as irrelevant to the key', async () => {
    const inner = new CountingGateway();
    const memo = new EvalMemoGateway(inner);
    await memo.ask(request('assessment', 's', [['a'], ['b']]));
    await memo.ask(request('assessment', 's', [['b'], ['a']]));
    expect(inner.calls).toBe(1);
  });

  it('sends concurrent identical requests once', async () => {
    const inner = new CountingGateway();
    const memo = new EvalMemoGateway(inner);
    const results = await Promise.all([memo.ask(base), memo.ask(base), memo.ask(base)]);
    expect(inner.calls).toBe(1);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(memo.stats).toEqual({ requests: 1, memoHits: 2 });
  });

  it('does not store a failed request', async () => {
    const inner = new CountingGateway();
    inner.failNext = 1;
    const memo = new EvalMemoGateway(inner);
    await expect(memo.ask(base)).rejects.toThrow('boom');
    const ok = await memo.ask(base);
    expect(ok).toEqual(answerFor(base));
    expect(inner.calls).toBe(2);
    await memo.ask(base);
    expect(inner.calls).toBe(2);
    expect(memo.stats).toEqual({ requests: 2, memoHits: 1 });
  });

  it('writes one Call_Log entry per request sent, and requests + memoHits equals asks', async () => {
    const entries: CallLogEntry[] = [];
    const callLog: CallLog = {
      append: (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
    };
    const reqs = [
      base,
      request('assessment', 'two', [['q', 1]]),
      base,
      request('runtime', 'two', [['q', 1]]),
      request('assessment', 'two', [['q', 1]]),
    ];
    const recordings: Recording[] = reqs.map((r) => ({
      idVersion: 'q@1',
      stateHash: stateHash(r.state),
      question: 'q',
      answer: { type: 'noul', noul: 0.5 } as unknown as Recording['answer'] & object,
    }));
    const memo = new EvalMemoGateway(new FakeJevGateway(recordings, { callLog }));
    for (const r of reqs) await memo.ask(r);
    expect(entries).toHaveLength(memo.stats.requests);
    expect(memo.stats.requests).toBe(3);
    expect(memo.stats.requests + memo.stats.memoHits).toBe(reqs.length);
  });
});

describe('Feature: claims-assessment-eval, Property 20: Eval_Memo_Gateway memo-transparency', () => {
  /** **Validates: Requirements 13.13, 13.14, 13.15, 13.16** */
  const requestArb = fc
    .record({
      stage: fc.constantFrom<Stage>('context', 'assessment', 'runtime', 'evidence'),
      state: fc.constantFrom('s1', 's2', 's3'),
      names: fc.subarray(['a', 'b', 'c'], { minLength: 1 }),
      version: fc.constantFrom(1, 2),
    })
    .map(({ stage, state, names, version }) =>
      request(stage, state, names.map((n) => [n, version] as [string, number])),
    );

  const keyOfRequest = (r: Jev_Request): string =>
    JSON.stringify([
      r.stage,
      Object.values(r.questions)
        .map((q) => q.idVersion)
        .sort(),
      stateHash(r.state),
    ]);

  it('returns the direct answer, calls the underlying gateway once per distinct key', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(requestArb, { minLength: 1, maxLength: 20 }),
        fc.boolean(),
        async (reqs, concurrent) => {
          const inner = new CountingGateway();
          const memo = new EvalMemoGateway(inner);
          const got = concurrent
            ? await Promise.all(reqs.map((r) => memo.ask(r)))
            : await (async () => {
                const out: Jev_Response[] = [];
                for (const r of reqs) out.push(await memo.ask(r));
                return out;
              })();
          const distinct = new Set(reqs.map(keyOfRequest)).size;
          expect(got).toEqual(reqs.map(answerFor));
          expect(inner.calls).toBe(distinct);
          expect(memo.stats.requests).toBe(distinct);
          expect(memo.stats.requests + memo.stats.memoHits).toBe(reqs.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('retries a key whose earlier call failed on the next identical request', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (failures) => {
        const inner = new CountingGateway();
        inner.failNext = failures;
        const memo = new EvalMemoGateway(inner);
        for (let i = 0; i < failures; i += 1) {
          await expect(memo.ask(base)).rejects.toThrow('boom');
        }
        expect(await memo.ask(base)).toEqual(answerFor(base));
        expect(await memo.ask(base)).toEqual(answerFor(base));
        expect(inner.calls).toBe(failures + 1);
        expect(memo.stats.requests + memo.stats.memoHits).toBe(failures + 2);
      }),
      { numRuns: 100 },
    );
  });
});
