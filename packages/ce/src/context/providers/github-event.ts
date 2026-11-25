// GitHub_Event_Provider: extracts pull request or push facts from the event
// payload file. Never reads process.env; the caller passes GITHUB_EVENT_PATH as
// `eventPath`. No Base_Ref priority and no commit-existence checks here (those
// live in resolve.ts). Nothing here imports from jev/.

import type { Provenance, ReasonCode } from '../types.js';

export interface GithubEventInput {
  eventPath?: string;
  readFile: (p: string) => string | undefined;
}

export interface GithubEventResult {
  pullRequest?: {
    title?: string;
    body?: string;
    baseSha?: string;
    baseRef?: string;
    headSha?: string;
  };
  push?: { before?: string };
  /** Present when the status is `used`. Always `provider: 'github'`. */
  provenance?: Provenance;
  status: { name: 'github'; status: 'used' | 'unavailable'; reason?: ReasonCode };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function absent(): GithubEventResult {
  return { status: { name: 'github', status: 'unavailable', reason: 'source-absent' } };
}

export function resolveGithubEvent(input: GithubEventInput): GithubEventResult {
  const { eventPath, readFile } = input;
  if (eventPath === undefined || eventPath === '') return absent();

  let text: string | undefined;
  try {
    text = readFile(eventPath);
  } catch {
    return absent();
  }
  if (text === undefined) return absent();

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return absent();
  }
  if (!isRecord(payload)) return absent();

  const provenance: Provenance = { provider: 'github', location: eventPath };

  const pr = payload.pull_request;
  if (isRecord(pr)) {
    const base = isRecord(pr.base) ? pr.base : {};
    const head = isRecord(pr.head) ? pr.head : {};
    const pullRequest: NonNullable<GithubEventResult['pullRequest']> = {};
    const title = str(pr.title);
    const body = str(pr.body);
    const baseSha = str(base.sha);
    const baseRef = str(base.ref);
    const headSha = str(head.sha);
    if (title !== undefined) pullRequest.title = title;
    if (body !== undefined) pullRequest.body = body;
    if (baseSha !== undefined) pullRequest.baseSha = baseSha;
    if (baseRef !== undefined) pullRequest.baseRef = baseRef;
    if (headSha !== undefined) pullRequest.headSha = headSha;
    return { pullRequest, provenance, status: { name: 'github', status: 'used' } };
  }

  const before = str(payload.before);
  if (before !== undefined) {
    return { push: { before }, provenance, status: { name: 'github', status: 'used' } };
  }

  return absent();
}
