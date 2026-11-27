import { redactSecretValues } from '../config/secrets.js';
import type { RunRecord } from './schema.js';

function walk(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactSecretValues(value, secrets);
  if (Array.isArray(value)) return value.map((item) => walk(item, secrets));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = walk(item, secrets);
    return out;
  }
  return value;
}

/**
 * Returns a copy of `record` with every string value passed through
 * `redactSecretValues`. Arrays and plain objects are walked recursively;
 * numbers, booleans and null pass through. Object keys and the input are
 * left unchanged.
 */
export function redactRunRecord(record: RunRecord, secrets: readonly string[]): RunRecord {
  return walk(record, secrets) as RunRecord;
}
