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
  // Object.fromEntries defines own data properties, so a name such as
  // `__proto__` stays data and never mutates the prototype.
  const kept = Object.entries(env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !FORBIDDEN_PREFIXES.some((prefix) => entry[0].startsWith(prefix)) &&
      !FORBIDDEN_NAMES.includes(entry[0]) &&
      !(runToken.length > 0 && entry[1] === runToken),
  );
  return Object.fromEntries([...kept, ...Object.entries(mirrorEnv)]);
}
