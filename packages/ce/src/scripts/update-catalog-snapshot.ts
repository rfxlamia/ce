import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Architecture rule: this script imports no jev/ module other than jev/catalog.
import { CATALOG } from '../jev/catalog.js';

/** Fixed sample inputs for entries whose question depends on arguments. */
const SAMPLE_NEXT_ACTION_OPTIONS = ['Click the Submit button', 'Type into the Email field'] as const;

export type SnapshotMap = Record<string, string>;

export function snapshotPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const beside = path.resolve(here, '../jev/catalog.snapshot.json');
  if (existsSync(beside)) return beside;
  // Compiled output (dist/) does not copy the JSON file; the source copy is the single source of truth.
  return path.resolve(here, '../../src/jev/catalog.snapshot.json');
}

/** SHA-256 hex of the JSON-serialized built question, per `id@version`. */
export function computeCatalogDigests(): SnapshotMap {
  const built = [
    CATALOG.claimIsBehavior.built(),
    CATALOG.assessRuntimeObservable.built(),
    CATALOG.assessChecksAdequate.built(),
    CATALOG.assessSurface.built(),
    CATALOG.runtimeNextAction.built(SAMPLE_NEXT_ACTION_OPTIONS),
    CATALOG.runtimeStateReachedDom.built(),
    CATALOG.runtimeStateReached.built(),
    CATALOG.runtimeLocateSubject.built(),
  ];
  const digests: SnapshotMap = {};
  for (const b of built) {
    digests[b.idVersion] = createHash('sha256').update(JSON.stringify(b.question)).digest('hex');
  }
  return digests;
}

export function readSnapshot(file: string = snapshotPath()): SnapshotMap {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as SnapshotMap;
}

export interface MergeResult {
  merged: SnapshotMap;
  added: string[];
  conflicts: string[];
}

/** Adds keys for new id@version values. Never removes or overwrites a stored key. */
export function mergeSnapshot(stored: SnapshotMap, computed: SnapshotMap): MergeResult {
  const merged: SnapshotMap = { ...stored };
  const added: string[] = [];
  const conflicts: string[] = [];
  for (const [key, digest] of Object.entries(computed)) {
    if (!(key in stored)) {
      merged[key] = digest;
      added.push(key);
    } else if (stored[key] !== digest) {
      conflicts.push(key);
    }
  }
  return { merged, added, conflicts };
}

export function main(): number {
  const file = snapshotPath();
  const { merged, added, conflicts } = mergeSnapshot(readSnapshot(file), computeCatalogDigests());
  if (conflicts.length > 0) {
    console.error(
      `catalog snapshot not updated. Built question differs from stored digest for: ${conflicts.join(', ')}. ` +
        'Increment the entry version instead of changing an existing id@version.',
    );
    return 1;
  }
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(added.length > 0 ? `added: ${added.join(', ')}` : 'no new entries');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
