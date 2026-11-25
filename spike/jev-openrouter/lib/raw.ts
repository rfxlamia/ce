import { OPENROUTER_BASE_URL } from './client.js';

/**
 * Diagnostic only. The SDK always sends images as multipart/form-data. The API reference
 * (https://docs.typesafe.ai/api.md) also documents a JSON form where an `assets` entry carries
 * `{ type: 'image', format: 'png', data_base64 }`. This helper sends that JSON form directly so a
 * run can tell whether the OpenRouter route rejects multipart specifically.
 * The key is read from the environment, used only in the Authorization header, and never returned.
 */
export interface RawSystemOneInput {
  model: string;
  /** State text containing the placeholder. */
  state: string;
  questions: Record<string, { type: 'noul' | 'box'; instructions: string }>;
  placeholder: string;
  pngBase64: string;
  imagesHeader: boolean;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}

export class RawHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
  constructor(status: number, body: unknown, headers: Headers) {
    super(`${status} ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 2000));
    this.name = 'RawHttpError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export async function rawJsonSystemOne(input: RawSystemOneInput): Promise<unknown> {
  const env = input.env ?? process.env;
  const doFetch = input.fetchFn ?? fetch;
  const res = await doFetch(`${OPENROUTER_BASE_URL}/v1/systemone`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ''}`,
      ...(input.imagesHeader ? { 'TypeSafe-Danger-Zone-Images': 'true' } : {}),
    },
    body: JSON.stringify({
      model: input.model,
      state: input.state,
      questions: input.questions,
      assets: { [input.placeholder]: { type: 'image', format: 'png', data_base64: input.pngBase64 } },
    }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new RawHttpError(res.status, parsed, res.headers);
  return parsed;
}
