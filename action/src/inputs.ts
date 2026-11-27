import { ENV_KEY_MAP, envNameForPath } from 'continuous-evidence';

/** One row of the Input_Map: an Action input name and the CE_* variable it feeds. */
export interface MirrorEntry {
  inputName: string; // e.g. 'runtime-max-steps'
  envName: string; // e.g. 'CE_RUNTIME_MAX_STEPS'
}

/** Config keys that have a CE_* variable but deliberately no Action input (task 4.1). */
const NO_INPUT_PATHS: ReadonlySet<string> = new Set(['version', 'runtime.fixtures']);

/**
 * Builds the mirror rows from the dotted config keys in `envKeyMap`
 * (CE_* name -> dotted key). The input name is the dotted key with '.' replaced
 * by '-'; the variable name comes from `envNameForPath`.
 */
export function buildMirrorEntries(
  envKeyMap: ReadonlyMap<string, string> = ENV_KEY_MAP,
): MirrorEntry[] {
  const entries: MirrorEntry[] = [];
  for (const path of envKeyMap.values()) {
    if (NO_INPUT_PATHS.has(path)) continue;
    entries.push({ inputName: path.replace(/\./g, '-'), envName: envNameForPath(path) });
  }
  return entries;
}

export interface ActionInputs {
  /** Returns the input value, or '' when unset. */
  getInput(name: string): string;
}

export interface ChildInvocation {
  env: Record<string, string>;
  argv: string[];
  warnings: string[];
}

/**
 * Maps Action inputs to the child process env (CE_* variables) and argv
 * (--config, --base, --claim). Values are never joined into a shell command line.
 */
export function buildChildInvocation(
  inputs: ActionInputs,
  entries: readonly MirrorEntry[] = buildMirrorEntries(),
): ChildInvocation {
  const env: Record<string, string> = {};
  const argv: string[] = [];
  const warnings: string[] = [];

  for (const { inputName, envName } of entries) {
    const value = inputs.getInput(inputName).trim();
    if (value !== '') env[envName] = value;
  }

  const config = inputs.getInput('config').trim();
  if (config !== '') argv.push('--config', config);
  const base = inputs.getInput('base').trim();
  if (base !== '') argv.push('--base', base);

  const lines = inputs.getInput('claim').split('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    if (line.startsWith('--')) {
      warnings.push(`claim line ${index + 1} starts with '--' and was skipped`);
      return;
    }
    argv.push('--claim', line);
  });

  return { env, argv, warnings };
}
