import { ConfigDefaults } from './defaults.js';
import { readEnvSource } from './env.js';
import { fromZodError, sortByPath } from './errors.js';
import type { ConfigFileError, ValidationError } from './errors.js';
import { discoverConfigFile, readAndParseConfigFile } from './file.js';
import { mergeSources } from './merge.js';
import { buildRedactedConfig } from './redact.js';
import { ConfigSchema } from './schema.js';
import type { EffectiveConfig } from './schema.js';

/** Which Config_Source supplied a leaf value. */
export type ConfigSource = 'flag' | 'env' | 'file' | 'default';

/** Facts about how the configuration was loaded. Holds no environment values. */
export interface ConfigMeta {
  fileRead: string | null;
  fileIgnored: string | null;
  ignoredEnvNames: string[];
  sources: Record<string, ConfigSource>;
}

/**
 * Secret-free view of the configuration for the Evidence bundle.
 * `buildRedactedConfig` (redact.ts) produces it.
 */
export interface RedactedConfig {
  config: EffectiveConfig;
  meta: ConfigMeta;
  /** Selected Jev provider and the name (never the value) of its credential variable. */
  credentials: { provider: 'openrouter' | 'typesafe'; envVar: string };
}

export interface LoadedConfig {
  ok: true;
  config: EffectiveConfig;
  meta: ConfigMeta;
  redacted: RedactedConfig;
}

export interface LoadConfigOptions {
  cwd: string;
  /** Includes the optional `config` flag (Config_File path). */
  flags: Record<string, unknown>;
  env: Record<string, string | undefined>;
}

export type LoadFailure =
  | { ok: false; errors: ValidationError[] }
  | { ok: false; fileError: ConfigFileError };

export type LoadConfigResult = LoadedConfig | LoadFailure;

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merge `value` into `target` at the dotted `path`, deep-merging plain objects. */
function assignExpanded(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    const next = cursor[key];
    if (isPlainObject(next)) {
      cursor = next;
    } else {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    }
  }
  const last = keys[keys.length - 1] as string;
  const existing = cursor[last];
  if (isPlainObject(existing) && isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) assignExpanded(existing, k, v);
  } else {
    cursor[last] = value;
  }
}

/** Expand dotted flag keys ("runtime.timeout") into nested objects. */
function expandFlags(flags: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined) continue;
    assignExpanded(out, key, isPlainObject(value) ? structuredClone(value) : value);
  }
  return out;
}

function findFixturesFlag(flags: Record<string, unknown>): { value: unknown } | null {
  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined) continue;
    if (key === 'runtime.fixtures' || key.startsWith('runtime.fixtures.')) return { value };
    if (key === 'runtime' && isPlainObject(value) && value.fixtures !== undefined) {
      return { value: value.fixtures };
    }
  }
  return null;
}

/** Longest-prefix lookup of the source that supplied `path`. */
function sourceForPath(
  path: string,
  sources: Record<string, ConfigSource>,
): ConfigSource | undefined {
  let current = path;
  for (;;) {
    const hit = sources[current];
    if (hit !== undefined) return hit;
    const dot = current.lastIndexOf('.');
    if (dot < 0) return undefined;
    current = current.slice(0, dot);
  }
}

/**
 * Load, merge and validate the configuration. Pure function of its options:
 * never reads process.env or process.cwd(), never throws for invalid config.
 */
export function loadConfig(options: LoadConfigOptions): LoadConfigResult {
  const { cwd, flags, env } = options;

  // 3 (done first so the config flag feeds discovery): split out `config`.
  const { config: configFlagRaw, ...schemaFlagsRaw } = flags;
  if (configFlagRaw !== undefined && typeof configFlagRaw !== 'string') {
    return {
      ok: false,
      errors: [
        { path: 'config', value: configFlagRaw, expected: 'path must be a string', source: 'flag' },
      ],
    };
  }

  // 1. Discover.
  const discovered = discoverConfigFile({ cwd, configFlag: configFlagRaw });
  if ('flagError' in discovered) return { ok: false, errors: [discovered.flagError] };

  // 2. Read and parse.
  const read = readAndParseConfigFile(discovered.path);
  if (!read.ok) {
    if ('fileError' in read) return { ok: false, fileError: read.fileError };
    return { ok: false, errors: sortByPath(read.errors) };
  }
  const fileValues = read.value as Record<string, unknown>;

  // 4. runtime.fixtures is file-only.
  const fixtures = findFixturesFlag(schemaFlagsRaw);
  if (fixtures) {
    return {
      ok: false,
      errors: [
        {
          path: 'runtime.fixtures',
          value: fixtures.value,
          expected: 'only in ce.yml or .ce.yml',
          source: 'flag',
        },
      ],
    };
  }
  const schemaFlags = expandFlags(schemaFlagsRaw);

  // 5. Environment.
  const { values: envValues, ignoredNames } = readEnvSource(env);

  // 6. Validate each fragment separately. Every key of ConfigSchema is optional
  // and nested objects are optional strict objects, so the schema already
  // accepts partial fragments; no deep-partial helper is needed.
  const fragmentErrors: ValidationError[] = [];
  const fragments: Array<[ConfigSource, Record<string, unknown>]> = [
    ['flag', schemaFlags],
    ['env', envValues],
    ['file', fileValues],
  ];
  for (const [source, fragment] of fragments) {
    const result = ConfigSchema.safeParse(fragment);
    if (!result.success) fragmentErrors.push(...fromZodError(result.error, source, fragment));
  }
  if (fragmentErrors.length > 0) return { ok: false, errors: sortByPath(fragmentErrors) };

  // 7. Merge.
  const { merged, sources } = mergeSources({
    flags: schemaFlags,
    envValues,
    fileValues,
    defaults: ConfigDefaults as Record<string, unknown>,
  });

  // 8. Validate the merge.
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const errors = fromZodError(parsed.error, undefined, merged).map((error) => {
      const source = sourceForPath(error.path, sources);
      return source === undefined ? error : { ...error, source };
    });
    return { ok: false, errors: sortByPath(errors) };
  }
  const config = parsed.data;

  // 9. Meta.
  const meta: ConfigMeta = {
    fileRead: discovered.path,
    fileIgnored: discovered.ignoredPath,
    ignoredEnvNames: ignoredNames,
    sources,
  };

  // 10-11.
  const redacted = buildRedactedConfig(config, meta, env);
  return { ok: true, config, meta, redacted };
}
