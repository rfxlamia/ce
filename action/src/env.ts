const FORBIDDEN_PREFIXES = ['INPUT_', 'ACTIONS_'] as const;
const FORBIDDEN_NAMES: readonly string[] = ['GITHUB_TOKEN', 'GH_TOKEN'];

/**
 * Builds the environment for the `ce run` child process.
 *
 * Removes every variable the Subject must not see: names starting with
 * `INPUT_` or `ACTIONS_`, `GITHUB_TOKEN`, `GH_TOKEN`, and any variable whose
 * value equals a non-empty `runToken` (a token under a different name).
 * Keeps `CE_*`, `GITHUB_EVENT_PATH` and other `GITHUB_*` variables, then adds
 * `mirrorEnv`. Returns a new object and never mutates `env`.
 */
export function sanitizeChildEnv(
  env: Readonly<Record<string, string | undefined>>,
  runToken: string,
  mirrorEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    if (FORBIDDEN_NAMES.includes(name)) continue;
    if (runToken.length > 0 && value === runToken) continue;
    result[name] = value;
  }
  return { ...result, ...mirrorEnv };
}
