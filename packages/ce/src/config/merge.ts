import type { ConfigSource } from './load.js';

/** Keys whose value is merged as one whole leaf (never concatenated or merged per key). */
const WHOLE_LEAF_PATHS: ReadonlySet<string> = new Set([
  'target.routes',
  'context.include',
  'context.exclude',
  'context.redact',
  'output.fail-on',
  'runtime.fixtures',
]);

export interface MergeInput {
  flags: Record<string, unknown>;
  envValues: Record<string, unknown>;
  fileValues: Record<string, unknown>;
  defaults: Record<string, unknown>;
}

export interface MergeResult {
  merged: Record<string, unknown>;
  sources: Record<string, ConfigSource>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects every leaf (dotted path -> value) of a source object. */
function collectLeaves(
  node: Record<string, unknown>,
  prefix: string,
  out: Map<string, unknown>,
): void {
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined) continue;
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (isPlainObject(value) && !WHOLE_LEAF_PATHS.has(path)) {
      collectLeaves(value, path, out);
    } else {
      out.set(path, value);
    }
  }
}

function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
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
  cursor[keys[keys.length - 1] as string] = value;
}

/**
 * Per-leaf precedence merge: flags, then env, then file, then defaults.
 * The first source defining a leaf path supplies it; `sources` records which.
 */
export function mergeSources(input: MergeInput): MergeResult {
  const ordered: Array<[ConfigSource, Record<string, unknown>]> = [
    ['flag', input.flags],
    ['env', input.envValues],
    ['file', input.fileValues],
    ['default', input.defaults],
  ];

  const merged: Record<string, unknown> = {};
  const sources: Record<string, ConfigSource> = {};

  for (const [source, values] of ordered) {
    const leaves = new Map<string, unknown>();
    collectLeaves(values, '', leaves);
    for (const [path, value] of leaves) {
      if (Object.hasOwn(sources, path)) continue;
      sources[path] = source;
      setAtPath(merged, path, structuredClone(value));
    }
  }

  return { merged, sources };
}
