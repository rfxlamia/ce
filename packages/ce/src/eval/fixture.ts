// Eval_Fixture schema and loader (Requirements 11.2-11.5, 12.1, 12.3-12.8, 12.10; Decision D18).
// Reads fixture files, never writes them, never throws, asks no Jev question.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Surface } from '../assessment/types.js';
import { ConfigDefaults } from '../config/defaults.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { buildFixtureContext } from './providers.js';

const SurfaceSchema = z.enum(SURFACE_LABELS);

export const EvalFixtureSchema = z
  .object({
    id: z.string().min(1),
    description: z.string(),
    change: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        commits: z.array(z.object({ sha: z.string(), message: z.string() }).strict()),
        files: z.array(
          z
            .object({
              path: z.string(),
              status: z.enum(['added', 'modified', 'deleted', 'renamed']),
              patch: z.string(),
            })
            .strict(),
        ),
        claims: z.array(z.string()).optional(),
      })
      .strict(),
    checks: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(['passed', 'failed', 'skipped']),
        })
        .strict(),
    ),
    labels: z
      .object({
        isBehavior: z.record(z.string(), z.boolean()),
        runtimeObservable: z.record(z.string(), z.boolean()),
        checksAdequate: z.record(z.string(), z.boolean()),
        surface: z.record(z.string(), SurfaceSchema),
        claimStatus: z.enum(['identified', 'not_identified']),
        required: z.boolean(),
      })
      .strict(),
  })
  .strict();

export interface EvalFixtureFile {
  id: string;
  description: string;
  change: {
    title?: string;
    description?: string;
    commits: { sha: string; message: string }[];
    files: {
      path: string;
      status: 'added' | 'modified' | 'deleted' | 'renamed';
      patch: string;
    }[];
    claims?: string[];
  };
  checks: { name: string; status: 'passed' | 'failed' | 'skipped' }[];
  labels: {
    isBehavior: Record<string, boolean>;
    runtimeObservable: Record<string, boolean>;
    checksAdequate: Record<string, boolean>;
    surface: Record<string, Surface>;
    claimStatus: 'identified' | 'not_identified';
    required: boolean;
  };
}

export interface LoadFixturesResult {
  ok: true;
  fixtures: { id: string; file: EvalFixtureFile }[];
}

export type LoadFixturesFailure =
  | { ok: false; kind: 'directory'; dir: string }
  | { ok: false; kind: 'schema'; file: string; path: string; value: unknown; expected: string }
  | {
      ok: false;
      kind: 'unlabelled-candidate';
      fixtureId: string;
      candidateText: string;
      missing: string;
    }
  | {
      ok: false;
      kind: 'unknown-label';
      fixtureId: string;
      candidateText: string;
      /** Which label map holds the offending key. */
      label: string;
    }
  /** Fixture context could not be built, or the Stub_Exec recorded a call (Requirement 12.10). */
  | { ok: false; kind: 'context'; fixtureId: string; error: StageError };

function schemaFailure(
  file: string,
  path: string,
  value: unknown,
  expected: string,
): LoadFixturesFailure {
  return { ok: false, kind: 'schema', file, path, value, expected };
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

export function loadFixtures(dir: string): LoadFixturesResult | LoadFixturesFailure {
  let names: string[];
  try {
    if (!statSync(dir).isDirectory()) return { ok: false, kind: 'directory', dir };
    names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return { ok: false, kind: 'directory', dir };
  }
  if (names.length === 0) return { ok: false, kind: 'directory', dir };

  // Pass 1: schema validation of every file, before any context is built.
  const parsed: { id: string; file: EvalFixtureFile }[] = [];
  for (const name of names) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (cause) {
      return schemaFailure(
        name,
        '',
        cause instanceof Error ? cause.message : String(cause),
        'a readable JSON file',
      );
    }
    const result = EvalFixtureSchema.safeParse(json);
    if (!result.success) {
      const issue = result.error.issues[0];
      if (issue === undefined) return schemaFailure(name, '', json, 'a valid Eval_Fixture');
      const path = issue.path.map(String).join('.');
      return schemaFailure(name, path, valueAt(json, issue.path), issue.message);
    }
    const file = result.data as EvalFixtureFile;
    const expectedId = name.slice(0, -'.json'.length);
    if (file.id !== expectedId) {
      return schemaFailure(name, 'id', file.id, `the file name without .json ("${expectedId}")`);
    }
    parsed.push({ id: file.id, file });
  }

  // Pass 2: build each context with production code and cross-check labels.
  for (const { id, file } of parsed) {
    let built: ReturnType<typeof buildFixtureContext>;
    try {
      built = buildFixtureContext(file, { config: ConfigDefaults, env: {} });
    } catch (cause) {
      return { ok: false, kind: 'context', fixtureId: id, error: new StageError('context', cause) };
    }
    if (built.execCalls.length > 0) {
      return {
        ok: false,
        kind: 'context',
        fixtureId: id,
        error: new StageError(
          'context',
          new Error(`fixture "${id}": resolveContext called exec ${built.execCalls.length} time(s)`),
        ),
      };
    }

    const { labels } = file;
    const has = (m: Record<string, unknown>, k: string): boolean =>
      Object.prototype.hasOwnProperty.call(m, k);
    const texts = new Map<string, boolean>(); // candidate text -> isCli
    for (const c of built.context.candidates) {
      const isCli = c.provenance.provider === 'cli';
      texts.set(c.text, (texts.get(c.text) ?? false) || isCli);
    }

    for (const [text, isCli] of texts) {
      if (isCli) {
        if (has(labels.isBehavior, text)) {
          return { ok: false, kind: 'unknown-label', fixtureId: id, candidateText: text, label: 'isBehavior' };
        }
      } else if (!has(labels.isBehavior, text)) {
        return { ok: false, kind: 'unlabelled-candidate', fixtureId: id, candidateText: text, missing: 'isBehavior' };
      }
      if (isCli || labels.isBehavior[text] === true) {
        for (const missing of ['runtimeObservable', 'checksAdequate', 'surface'] as const) {
          if (!has(labels[missing], text)) {
            return { ok: false, kind: 'unlabelled-candidate', fixtureId: id, candidateText: text, missing };
          }
        }
      }
    }
    for (const label of ['isBehavior', 'runtimeObservable', 'checksAdequate', 'surface'] as const) {
      for (const text of Object.keys(labels[label])) {
        if (!texts.has(text)) {
          return { ok: false, kind: 'unknown-label', fixtureId: id, candidateText: text, label };
        }
      }
    }
  }

  return { ok: true, fixtures: parsed };
}
