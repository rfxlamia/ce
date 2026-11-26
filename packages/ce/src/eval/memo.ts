/**
 * Eval_Memo_Gateway (Decision D17). Wraps a JevGateway so one `ce eval` run never sends the
 * same request twice. The key is `(stage, sorted name@idVersion list, stateHash(state))`.
 * Concurrent identical requests share one in-flight promise. A failed request is not stored,
 * so the next identical request is sent again. This module imports nothing from `assessment/`.
 */
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';

export interface MemoStats {
  /** Requests sent to the underlying gateway. */
  requests: number;
  /** Requests answered from the memo (completed or in flight). */
  memoHits: number;
}

function memoKey(request: Jev_Request): string {
  const questions = Object.entries(request.questions)
    .map(([name, question]) => `${name}:${question.idVersion}`)
    .sort();
  return JSON.stringify([request.stage, questions, stateHash(request.state)]);
}

export class EvalMemoGateway implements JevGateway {
  readonly stats: MemoStats = { requests: 0, memoHits: 0 };
  readonly #underlying: JevGateway;
  readonly #memo = new Map<string, Promise<Jev_Response>>();

  constructor(underlying: JevGateway) {
    this.#underlying = underlying;
  }

  async ask(request: Jev_Request, options?: AskOptions): Promise<Jev_Response> {
    const key = memoKey(request);
    const existing = this.#memo.get(key);
    if (existing !== undefined) {
      this.stats.memoHits += 1;
      return existing;
    }
    this.stats.requests += 1;
    const pending = this.#underlying.ask(request, options);
    this.#memo.set(key, pending);
    pending.catch(() => {
      if (this.#memo.get(key) === pending) this.#memo.delete(key);
    });
    return pending;
  }
}
