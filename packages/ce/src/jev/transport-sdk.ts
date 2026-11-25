import { TypeSafeClient, type Fetch, type Questions } from '@typesafe-ai/sdk';
import type { Jev_Request, RawSystemOneResult } from './types.js';

/**
 * SDK transport for text-only requests.
 *
 * It never retries and never decides the final error class. SDK errors
 * (RateLimitError, APITimeoutError, ...) propagate to `gateway.ts`, which
 * classifies them and re-raises the gateway's own error types, so no SDK
 * class leaks outside `jev/`.
 */
export interface SdkTransport {
  send(
    request: Jev_Request,
    attemptOptions: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<RawSystemOneResult>;
}

export interface SdkTransportConfig {
  baseURL: string;
  apiKey: string;
  requestedModel: string;
  /** For test injection only. Never used to rewrite multipart requests. */
  fetch?: Fetch;
}

export function createSdkTransport(config: SdkTransportConfig): SdkTransport {
  // Every option is explicit so the SDK never reads TYPESAFE_* variables.
  const client = new TypeSafeClient({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    retry: { maxRetries: 0 },
    logLevel: 'off',
    compression: false,
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });

  return {
    async send(request, attemptOptions) {
      const questions: Record<string, unknown> = {};
      for (const [name, built] of Object.entries(request.questions)) {
        questions[name] = built.question;
      }
      const result = await client.systemOne(
        {
          model: config.requestedModel,
          state: request.state,
          questions: questions as Questions,
        },
        {
          timeout: attemptOptions.timeoutMs,
          ...(attemptOptions.signal ? { signal: attemptOptions.signal } : {}),
        },
      );
      return {
        model: result.model,
        answers: result.answers as Record<string, unknown>,
        usage: result.usage,
      };
    },
  };
}
