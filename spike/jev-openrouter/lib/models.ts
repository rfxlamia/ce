/** Aggregate returned Model_Ids per request type, ignoring failed calls. */

export interface ModelCallLike {
  requestType: string;
  ok: boolean;
  modelReturned?: string | null;
}

export type ModelCounts = Record<string, Record<string, number>>;

/** `{ [requestType]: { [modelId]: count } }`. Calls with `ok: false` or no model id are skipped. */
export function aggregateModelIds(calls: readonly ModelCallLike[]): ModelCounts {
  const out: ModelCounts = {};
  for (const c of calls) {
    if (!c.ok || !c.modelReturned) continue;
    const group = (out[c.requestType] ??= {});
    group[c.modelReturned] = (group[c.modelReturned] ?? 0) + 1;
  }
  return out;
}
