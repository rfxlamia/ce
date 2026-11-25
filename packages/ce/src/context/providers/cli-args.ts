// CLI_Provider: reads the --claim and --base arguments. Pure and synchronous.

import type { Provenance, ReasonCode } from '../types.js';

export interface CliArgsInput {
  claim?: string[];
  base?: string;
}

export interface CliProviderResult {
  claims: { text: string; provenance: Provenance }[];
  base?: { ref: string; provenance: Provenance };
  status: { name: 'cli'; status: 'used' | 'unavailable'; reason?: ReasonCode };
}

export function resolveCliArgs(input: CliArgsInput): CliProviderResult {
  const claims = (input.claim ?? []).map((text, i) => ({
    text,
    provenance: { provider: 'cli' as const, location: `--claim[${i + 1}]` },
  }));
  const base =
    input.base !== undefined && input.base !== ''
      ? { ref: input.base, provenance: { provider: 'cli' as const, location: '--base' } }
      : undefined;

  if (claims.length === 0 && base === undefined) {
    return { claims, status: { name: 'cli', status: 'unavailable', reason: 'no-input' } };
  }
  const result: CliProviderResult = { claims, status: { name: 'cli', status: 'used' } };
  if (base) result.base = base;
  return result;
}
