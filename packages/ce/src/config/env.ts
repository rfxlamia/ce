import type { z } from 'zod';
import { ConfigSchema } from './schema.js';

export type EnvInput = Record<string, string | undefined>;

export interface EnvSource {
  /** Nested partial config built from recognised CE_* variables. */
  values: Record<string, unknown>;
  /** CE_* names that were not applied (unknown or fixtures-prefixed). */
  ignoredNames: string[];
}

type LeafKind = 'number' | 'list' | 'string';

interface EnvKeyEntry {
  /** Dotted key path, for example `runtime.max-steps`. */
  path: string;
  segments: string[];
  kind: LeafKind;
}

interface ZodNode {
  _zod: { def: Record<string, unknown> };
}

const FIXTURES_PATH = 'runtime.fixtures';
const FIXTURES_ENV_PREFIX = 'CE_RUNTIME_FIXTURES';

function defOf(node: unknown): Record<string, unknown> {
  return (node as ZodNode)._zod.def;
}

/** Strip optional/nullable/default wrappers down to the underlying type. */
function unwrap(node: unknown): unknown {
  let current = node;
  for (;;) {
    const def = defOf(current);
    if (
      (def.type === 'optional' || def.type === 'nullable' || def.type === 'default') &&
      def.innerType
    ) {
      current = def.innerType;
      continue;
    }
    return current;
  }
}

function leafKind(node: unknown): LeafKind {
  const def = defOf(node);
  if (def.type === 'number') return 'number';
  if (def.type === 'array') return 'list';
  if (def.type === 'literal') {
    const values = (def.values as unknown[] | undefined) ?? [];
    if (values.length > 0 && values.every((v) => typeof v === 'number')) return 'number';
  }
  return 'string';
}

export function envNameForPath(path: string): string {
  return `CE_${path.replace(/[.-]/g, '_').toUpperCase()}`;
}

function collect(
  shape: Record<string, unknown>,
  prefix: string[],
  out: Map<string, EnvKeyEntry>,
): void {
  for (const [key, child] of Object.entries(shape)) {
    const segments = [...prefix, key];
    const path = segments.join('.');
    if (path === FIXTURES_PATH) continue;
    const inner = unwrap(child);
    const def = defOf(inner);
    if (def.type === 'object') {
      collect(def.shape as Record<string, unknown>, segments, out);
      continue;
    }
    out.set(envNameForPath(path), { path, segments, kind: leafKind(inner) });
  }
}

function buildEnvKeyEntries(schema: z.ZodType): Map<string, EnvKeyEntry> {
  const out = new Map<string, EnvKeyEntry>();
  collect(defOf(schema).shape as Record<string, unknown>, [], out);
  return out;
}

const ENTRIES = buildEnvKeyEntries(ConfigSchema);

/** Env variable name -> dotted config key path. Derived from `ConfigSchema`. */
export const ENV_KEY_MAP: ReadonlyMap<string, string> = new Map(
  [...ENTRIES].map(([name, entry]) => [name, entry.path]),
);

function coerce(kind: LeafKind, text: string): unknown {
  if (kind === 'list') return text.split(',').map((item) => item.trim());
  if (kind === 'number') {
    const trimmed = text.trim();
    if (trimmed === '') return text;
    const n = Number(trimmed);
    // Keep the original text when it is not a finite number so zod reports it.
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

function setPath(target: Record<string, unknown>, segments: string[], value: unknown): void {
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment];
    if (typeof next === 'object' && next !== null) {
      node = next as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      node[segment] = created;
      node = created;
    }
  }
  node[segments[segments.length - 1]!] = value;
}

export function readEnvSource(env: EnvInput): EnvSource {
  const values: Record<string, unknown> = {};
  const ignoredNames: string[] = [];

  for (const name of Object.keys(env).sort()) {
    if (!name.startsWith('CE_')) continue;
    const text = env[name];
    if (text === undefined) continue;
    if (name.startsWith(FIXTURES_ENV_PREFIX)) {
      ignoredNames.push(name);
      continue;
    }
    const entry = ENTRIES.get(name);
    if (!entry) {
      ignoredNames.push(name);
      continue;
    }
    setPath(values, entry.segments, coerce(entry.kind, text));
  }

  return { values, ignoredNames };
}
