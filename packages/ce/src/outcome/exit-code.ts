import type { Resolution } from './types.js';

/** The `output.fail-on` entries (journal section 6). */
export type FailOnEntry = 'error' | 'unsupported' | 'evidenced-not-reached';

const DEFAULT_FAIL_ON: readonly FailOnEntry[] = ['error'];

/**
 * Maps a Resolution to a process exit code. Pure: reads only `outcome`,
 * `finalState` and `failOn`. Order and duplicates in `failOn` do not matter.
 * Entries are not validated here (the config schema does that).
 */
export function exitCodeFor(
  resolution: Resolution,
  failOn: readonly FailOnEntry[] | undefined,
): 0 | 1 | 2 | 3 {
  const entries = new Set<FailOnEntry>(failOn ?? DEFAULT_FAIL_ON);

  if (resolution.outcome === 'ERROR' && entries.has('error')) return 1;
  if (resolution.outcome === 'UNSUPPORTED' && entries.has('unsupported')) return 2;
  if (
    resolution.outcome === 'EVIDENCED' &&
    resolution.finalState === 'not_reached' &&
    entries.has('evidenced-not-reached')
  ) {
    return 3;
  }
  return 0;
}
