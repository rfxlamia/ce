import { TypeSafeClient } from '@typesafe-ai/sdk';

export type Provider = 'openrouter' | 'typesafe';

export interface SpikeClientOptions {
  provider: Provider;
  /** Injectable for tests. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

/**
 * Sole place a TypeSafeClient is constructed. Never logs the key.
 * Retries are disabled so the spike measures raw behavior (rate limits, latency).
 */
export function buildClient(options: SpikeClientOptions): TypeSafeClient {
  const env = options.env ?? process.env;
  const common = { retry: { maxRetries: 0 }, logLevel: 'off' as const };
  if (options.provider === 'openrouter') {
    return new TypeSafeClient({ ...common, apiKey: env.OPENROUTER_API_KEY, baseURL: OPENROUTER_BASE_URL });
  }
  return new TypeSafeClient({ ...common, apiKey: env.TYPESAFE_API_KEY });
}
