// JUnit_Provider: reads JUnit XML files named by `context.checks` into
// Check_Results. Synchronous; every file-system access is injected.
//
// XML parsing: fast-xml-parser. `XMLValidator.validate` rejects malformed
// documents first, then `XMLParser` runs with `processEntities: false`, so
// entity references (including those declared in a DOCTYPE) are never
// expanded. The parser itself never reads external entities and throws on a
// `SYSTEM`/`PUBLIC` entity declaration; that throw is a parse failure
// (`source-malformed`), so a referenced file is never read (Requirement 1.13).
// `preserveOrder: true` keeps document order across nested suites.

import { posix } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { matchesGlob } from '../glob.js';
import type { Provenance, ReasonCode } from '../types.js';

export const MAX_JUNIT_BYTES = 10_485_760; // 10 MiB (Decision D30)

export interface JunitProviderInput {
  cwd: string;
  /** context.checks */
  checksPattern?: string;
  /**
   * Lists files under `dir` (absolute) recursively, never following symlinks.
   * Returns absolute paths. `pattern` is the cwd-relative pattern, for hints.
   */
  listFiles: (dir: string, pattern: string) => string[];
  /** Receives absolute paths. */
  lstat: (path: string) => { isSymbolicLink(): boolean } | undefined;
  /** Receives absolute paths. */
  readFile: (path: string) => { size: number; text: () => string } | undefined;
}

export interface JunitProviderResult {
  checks: {
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    provenance: Provenance;
  }[];
  status: { name: 'junit'; status: 'used' | 'unavailable'; reason?: ReasonCode };
}

type Check = JunitProviderResult['checks'][number];
type Node = Record<string, unknown>;

function unavailable(reason: ReasonCode): JunitProviderResult {
  return { checks: [], status: { name: 'junit', status: 'unavailable', reason } };
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function isUnsafePattern(pattern: string): boolean {
  const p = toPosix(pattern);
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return true;
  return p.split('/').includes('..');
}

function joinAbs(cwd: string, rel: string): string {
  return posix.join(toPosix(cwd), rel);
}

const parser = new XMLParser({
  processEntities: false,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
});

function attr(node: Node, key: string): string | undefined {
  const attrs = node[':@'] as Record<string, unknown> | undefined;
  const v = attrs?.[`@_${key}`];
  return v === undefined ? undefined : String(v);
}

function childTags(children: unknown): string[] {
  if (!Array.isArray(children)) return [];
  const tags: string[] = [];
  for (const c of children as Node[]) {
    for (const k of Object.keys(c)) if (k !== ':@') tags.push(k);
  }
  return tags;
}

function collect(nodes: unknown, location: string, out: Check[]): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes as Node[]) {
    for (const key of Object.keys(node)) {
      if (key === ':@') continue;
      if (key === 'testcase') {
        const name = attr(node, 'name') ?? '';
        const classname = attr(node, 'classname');
        const tags = childTags(node[key]);
        const status: Check['status'] =
          tags.includes('failure') || tags.includes('error')
            ? 'failed'
            : tags.includes('skipped')
              ? 'skipped'
              : 'passed';
        out.push({
          name: classname ? `${classname}.${name}` : name,
          status,
          provenance: { provider: 'junit', location },
        });
      } else {
        collect(node[key], location, out);
      }
    }
  }
}

type FileOutcome = { ok: true; checks: Check[] } | { ok: false; reason: ReasonCode };

function parseFile(input: JunitProviderInput, abs: string, rel: string): FileOutcome {
  const link = input.lstat(abs);
  if (link?.isSymbolicLink()) return { ok: false, reason: 'source-malformed' };
  let file: { size: number; text: () => string } | undefined;
  try {
    file = input.readFile(abs);
  } catch {
    return { ok: false, reason: 'source-unreadable' };
  }
  if (!file) return { ok: false, reason: 'source-unreadable' };
  if (file.size > MAX_JUNIT_BYTES) return { ok: false, reason: 'source-malformed' };
  let text: string;
  try {
    text = file.text();
  } catch {
    return { ok: false, reason: 'source-unreadable' };
  }
  try {
    if (XMLValidator.validate(text) !== true) return { ok: false, reason: 'source-malformed' };
    const doc = parser.parse(text) as unknown;
    const checks: Check[] = [];
    collect(doc, rel, checks);
    return { ok: true, checks };
  } catch {
    return { ok: false, reason: 'source-malformed' };
  }
}

export function resolveJunit(input: JunitProviderInput): JunitProviderResult {
  const raw = input.checksPattern;
  if (raw === undefined || raw === '') return unavailable('not-configured');
  if (isUnsafePattern(raw)) return unavailable('source-malformed');

  const pattern = posix.normalize(toPosix(raw));
  let rels: string[];

  if (!pattern.includes('*')) {
    const abs = joinAbs(input.cwd, pattern);
    if (input.lstat(abs) === undefined) return unavailable('source-absent');
    rels = [pattern];
  } else {
    const segments = pattern.split('/');
    const firstWild = segments.findIndex((s) => s.includes('*'));
    const prefix = segments.slice(0, firstWild).join('/');
    const dir = prefix === '' ? toPosix(input.cwd) : joinAbs(input.cwd, prefix);
    const base = toPosix(input.cwd).replace(/\/+$/, '');
    rels = input
      .listFiles(dir, pattern)
      .map((p) => toPosix(p))
      .map((p) => (p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p))
      .filter((p) => matchesGlob(pattern, p));
    rels = [...new Set(rels)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (rels.length === 0) return unavailable('source-absent');
  }

  const checks: Check[] = [];
  let parsed = false;
  let firstFailure: ReasonCode | undefined;
  for (const rel of rels) {
    const outcome = parseFile(input, joinAbs(input.cwd, rel), rel);
    if (outcome.ok) {
      parsed = true;
      checks.push(...outcome.checks);
    } else if (firstFailure === undefined) {
      firstFailure = outcome.reason;
    }
  }

  if (!parsed) return unavailable(firstFailure ?? 'source-absent');
  return { checks, status: { name: 'junit', status: 'used' } };
}
