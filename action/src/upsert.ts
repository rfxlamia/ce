import { COMMENT_MARKER } from 'continuous-evidence';

export interface CommentApi {
  /** Returns one page of comments per call is the adapter's concern; this returns ALL pages' worth
   * only if the adapter pages internally. `page` is 1-based; an empty array ends the listing. */
  listComments(
    pr: number,
    page: number,
  ): Promise<Array<{ id: number; body: string; user: { login: string } }>>;
  createComment(pr: number, body: string): Promise<{ id: number; html_url: string }>;
  updateComment(id: number, body: string): Promise<{ id: number; html_url: string }>;
}

/** Hard stop so a misbehaving API cannot loop forever. */
const MAX_PAGES = 1000;

/**
 * Create or update the single PR_Comment. Errors from the API propagate to the caller
 * (index.ts), which turns them into a warning with `describeApiFailure`.
 */
export async function upsertComment(
  api: CommentApi,
  pr: number,
  commentAuthor: string,
  body: string,
): Promise<{ url: string }> {
  let oldestId: number | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const comments = await api.listComments(pr, page);
    if (comments.length === 0) break;
    for (const c of comments) {
      // Author filter first: comments by anyone else are invisible here.
      if (c.user?.login !== commentAuthor) continue;
      if (typeof c.body !== 'string' || !c.body.includes(COMMENT_MARKER)) continue;
      if (oldestId === undefined || c.id < oldestId) oldestId = c.id;
    }
  }
  const result =
    oldestId === undefined
      ? await api.createComment(pr, body)
      : await api.updateComment(oldestId, body);
  return { url: result.html_url };
}

/** Warning text for a failed comment API call: HTTP status, no token. */
export function describeApiFailure(error: unknown): string {
  const status = extractStatus(error);
  const base =
    status === undefined
      ? 'Could not post the CE pull request comment (no HTTP status).'
      : `Could not post the CE pull request comment (HTTP ${status}).`;
  const hint =
    status === 403
      ? ' The token lacks the `pull-requests: write` permission; add it to the workflow `permissions`.'
      : '';
  return `${base}${hint} The report was written to the job summary instead.`;
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as { status?: unknown; statusCode?: unknown };
  const s = typeof e.status === 'number' ? e.status : e.statusCode;
  return typeof s === 'number' && Number.isInteger(s) ? s : undefined;
}
