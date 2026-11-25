import type { Provider } from './client.js';
import { assertNoEnvLeak, sanitizeResponse } from './sanitize.js';

export type RequestType =
  | 'choice' | 'noul' | 'score' | 'mixed_state' | 'mixed_state_no_image'
  | 'mixed_state_split_noul' | 'mixed_state_split_box' | 'mixed_state_typesafe_provider'
  | 'next_action' | 'final_image' | 'diagnostic';

export interface HarnessCallResult {
  requestType: RequestType;
  provider: Provider;
  modelRequested: string;
  modelReturned: string | null;
  ok: boolean;
  httpStatus?: number;
  errorClass?: string;
  errorMessage?: string;
  retryAfter?: string;
  /** Human-readable label for diagnostic attempts. */
  label?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  optionCount?: number;
  raw: { request: unknown; response: unknown };
}

export interface CallMeta {
  requestType: RequestType;
  provider: Provider;
  modelRequested: string;
  optionCount?: number;
  label?: string;
  /** The request body as sent, recorded in raw.request. */
  request: unknown;
}

export const MAX_MESSAGE = 2000;
const MAX_BODY_CHARS = 4000;

/** Credential-safe text: if a secret value appears, the whole text is replaced (assertNoEnvLeak still decides). */
function safeText(text: string): string {
  try {
    assertNoEnvLeak(text);
    return text;
  } catch {
    return '[redacted: text contained a credential value]';
  }
}

function safeBody(body: unknown): unknown {
  if (body === undefined) return undefined;
  const clean = sanitizeResponse(body);
  let text: string;
  try {
    text = typeof clean === 'string' ? clean : JSON.stringify(clean) ?? String(clean);
  } catch {
    text = String(clean);
  }
  const bounded = text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…[truncated]` : text;
  try {
    assertNoEnvLeak(bounded);
  } catch {
    return '[redacted: body contained a credential value]';
  }
  if (typeof clean === 'string' || text.length > MAX_BODY_CHARS) return bounded;
  return clean;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  const h = headers as { get?: (n: string) => string | null; [k: string]: unknown };
  if (typeof h.get === 'function') return h.get(name) ?? undefined;
  const v = h[name] ?? h[name.toLowerCase()];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Time one Jev call (no retry), never throw, and return a HarnessCallResult.
 * `fn` performs the call and returns the parsed response ({model, answers, usage}).
 */
export async function timedCall(
  meta: CallMeta,
  fn: () => Promise<unknown>,
  now: () => number = () => performance.now(),
): Promise<HarnessCallResult> {
  const base = {
    requestType: meta.requestType,
    provider: meta.provider,
    modelRequested: meta.modelRequested,
    ...(meta.optionCount !== undefined ? { optionCount: meta.optionCount } : {}),
    ...(meta.label !== undefined ? { label: meta.label } : {}),
  };
  const start = now();
  try {
    const response = await fn();
    const latencyMs = now() - start;
    const r = (response ?? {}) as { model?: unknown; usage?: { input_tokens?: number | null; output_tokens?: number | null } };
    return {
      ...base,
      modelReturned: typeof r.model === 'string' ? r.model : null,
      ok: true,
      latencyMs,
      ...(typeof r.usage?.input_tokens === 'number' ? { inputTokens: r.usage.input_tokens } : {}),
      ...(typeof r.usage?.output_tokens === 'number' ? { outputTokens: r.usage.output_tokens } : {}),
      raw: { request: meta.request, response },
    };
  } catch (err) {
    const latencyMs = now() - start;
    const e = err as { status?: unknown; statusCode?: unknown; headers?: unknown; message?: unknown; body?: unknown; error?: unknown; requestId?: unknown } | null;
    const isObj = typeof err === 'object' && err !== null;
    const isError = err instanceof Error;
    const errorClass = isError ? err.constructor.name : 'NonError';
    const status = isObj ? (typeof e?.status === 'number' ? e.status : typeof e?.statusCode === 'number' ? e.statusCode : undefined) : undefined;
    const retryAfter = isObj ? readHeader(e?.headers, 'retry-after') : undefined;
    const message = isError ? err.message : isObj && typeof e?.message === 'string' ? e.message : String(err);
    const errorMessage = safeText(message.slice(0, MAX_MESSAGE));
    // SDK APIError carries the parsed response body in `body`; some errors use `error`.
    const body = isObj ? safeBody(e?.body) : undefined;
    const errorField = isObj ? safeBody(e?.error) : undefined;
    const requestId = isObj && typeof e?.requestId === 'string' ? e.requestId : undefined;
    return {
      ...base,
      modelReturned: null,
      ok: false,
      ...(status !== undefined ? { httpStatus: status } : {}),
      errorClass,
      errorMessage,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      latencyMs,
      raw: {
        request: meta.request,
        response: {
          error: {
            class: errorClass,
            ...(status !== undefined ? { status } : {}),
            message: errorMessage,
            ...(body !== undefined ? { body } : {}),
            ...(errorField !== undefined ? { error: errorField } : {}),
            ...(requestId !== undefined ? { requestId } : {}),
          },
        },
      },
    };
  }
}
