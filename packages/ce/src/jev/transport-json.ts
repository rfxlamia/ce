import { Image } from '@typesafe-ai/sdk';
import type { TextWithAssets } from '@typesafe-ai/sdk';
import { JevImageError } from './errors.js';
import { parseRetryAfterHeaders } from './retry-after.js';
import type { Jev_Request, RawSystemOneResult } from './types.js';

/**
 * JSON_Transport: the raw `fetch` POST to `/v1/systemone` used for requests that carry an
 * image (the SDK always sends images as multipart, which OpenRouter rejects).
 *
 * This is the only module that calls `fetch` for Jev. Exit plan (jev-gateway-decision steering
 * note): when the SDK can send images as JSON, or OpenRouter accepts multipart, delete this
 * file and route everything through the SDK transport.
 */

export type JsonFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface JsonTransportConfig {
  baseURL: string;
  apiKey: string;
  requestedModel: string;
  provider: 'openrouter' | 'typesafe';
  fetch?: JsonFetch;
}

export interface JsonSendOptions {
  /** Honoured only when the provider is `typesafe`. Never sent for `openrouter`. */
  dangerZoneHeader?: boolean;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface JsonTransport {
  send(request: Jev_Request, options: JsonSendOptions): Promise<RawSystemOneResult>;
}

export type JsonTransportErrorKind =
  | 'http'
  | 'timeout'
  | 'connection'
  | 'aborted'
  | 'invalid_response';

/**
 * Failure of one JSON request. `message` is sanitized and truncated: it carries no API key,
 * no Authorization header and no request body. The gateway classifies it.
 */
export class JsonTransportError extends Error {
  readonly kind: JsonTransportErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    kind: JsonTransportErrorKind,
    message: string,
    options: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'JsonTransportError';
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

const MAX_ERROR_TEXT = 300;

type ImageFormat = 'png' | 'jpeg';

/** Detects the format from magic bytes. `null` for anything else. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  return null;
}

function sanitize(text: string, apiKey: string): string {
  let out = text;
  if (apiKey.length > 0) out = out.split(apiKey).join('[redacted]');
  out = out.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\s+/g, ' ').trim();
  return out.length > MAX_ERROR_TEXT ? `${out.slice(0, MAX_ERROR_TEXT)}…` : out;
}

/** The SDK exports `TextWithAssets` as a type only, so detect it by shape. */
function isTextWithAssets(value: object): value is TextWithAssets {
  const candidate = value as { text?: unknown; assets?: unknown };
  return typeof candidate.text === 'string' && Array.isArray(candidate.assets);
}

/** Collects every image reachable from the state and the questions, keyed by reference. */
function collectImages(request: Jev_Request): Map<string, Image> {
  const found = new Map<string, Image>();
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof Image) {
      found.set(value.toString(), value);
    } else if (isTextWithAssets(value)) {
      for (const asset of value.assets) visit(asset);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(request.state);
  for (const built of Object.values(request.questions)) visit(built.question);
  return found;
}

async function imageBytes(image: Image): Promise<Uint8Array> {
  const data = image.data;
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createJsonTransport(config: JsonTransportConfig): JsonTransport {
  const { apiKey, requestedModel, provider } = config;
  const baseURL = config.baseURL.replace(/\/+$/, '');
  const doFetch: JsonFetch = config.fetch ?? ((input, init) => fetch(input, init));

  return {
    async send(request, options) {
      // Build the assets first so an unsupported image fails before any network call.
      const assets: Record<string, { type: 'image'; format: ImageFormat; data_base64: string }> =
        {};
      for (const [reference, image] of collectImages(request)) {
        const bytes = await imageBytes(image);
        const format = detectImageFormat(bytes);
        if (format === null) {
          throw new JevImageError('invalid_image', {
            message: 'Jev image request failed: invalid_image (not a PNG or JPEG)',
          });
        }
        assets[reference] = {
          type: 'image',
          format,
          data_base64: Buffer.from(bytes).toString('base64'),
        };
      }

      const questions: Record<string, unknown> = {};
      for (const [name, built] of Object.entries(request.questions)) {
        questions[name] = built.question;
      }

      const body = JSON.stringify({
        model: requestedModel,
        state: request.state,
        questions,
        assets,
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      if (provider === 'typesafe' && options.dangerZoneHeader === true) {
        headers['TypeSafe-Danger-Zone-Images'] = 'true';
      }

      const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
      const signal =
        options.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);

      let response: Response;
      try {
        response = await doFetch(`${baseURL}/v1/systemone`, {
          method: 'POST',
          headers,
          body,
          signal,
        });
      } catch (error) {
        if (options.signal?.aborted === true) {
          throw new JsonTransportError('aborted', 'Jev JSON request aborted by caller');
        }
        if (timeoutSignal.aborted) {
          throw new JsonTransportError(
            'timeout',
            `Jev JSON request timed out after ${options.timeoutMs} ms`,
          );
        }
        const name = error instanceof Error ? error.name : 'Error';
        throw new JsonTransportError('connection', `Jev JSON request failed to connect (${name})`);
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        if (timeoutSignal.aborted) {
          throw new JsonTransportError(
            'timeout',
            `Jev JSON request timed out after ${options.timeoutMs} ms`,
          );
        }
        throw new JsonTransportError('connection', 'Jev JSON response body could not be read');
      }

      if (!response.ok) {
        const retryAfterMs = parseRetryAfterHeaders(response.headers);
        throw new JsonTransportError(
          'http',
          `Jev JSON request failed with HTTP ${response.status}: ${sanitize(text, apiKey)}`,
          { status: response.status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) },
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new JsonTransportError('invalid_response', 'Jev JSON response is not valid JSON', {
          status: response.status,
        });
      }
      if (!isRecord(parsed) || typeof parsed.model !== 'string' || !isRecord(parsed.answers)) {
        throw new JsonTransportError(
          'invalid_response',
          'Jev JSON response lacks model or answers',
          { status: response.status },
        );
      }
      const usage = isRecord(parsed.usage) ? parsed.usage : {};
      return {
        model: parsed.model,
        answers: parsed.answers,
        usage: {
          input_tokens: tokenCount(usage.input_tokens),
          output_tokens: tokenCount(usage.output_tokens),
        },
      };
    },
  };
}
