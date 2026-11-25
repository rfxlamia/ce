// Git_Provider: two-stage diff (Decisions D3, D9, D10, D16, D24, D25, D26, D29).
// Reads git only through the injected `exec`; never contacts a remote, never
// writes, and never forwards git output (stderr included) into `reason`.
import { matchesAny } from '../glob.js';
import type {
  ChangedFile,
  Provenance,
  ReasonCode,
  TruncationReason,
} from '../types.js';

/** Stage 2 `maxBuffer` (Decision D26): 16 MiB. */
export const MAX_BUFFER = 16 * 1024 * 1024;
/** Raw_Patch_Limit (Decision D26): 1 MiB. */
export const RAW_PATCH_LIMIT = 1024 * 1024;
/** Patch_Batch caps (Decision D25). */
export const BATCH_MAX_ENTRIES = 50;
export const BATCH_MAX_BYTES = 65536;

export interface GitExecOptions {
  maxBuffer: number;
  cwd: string;
  env: Record<string, string>;
}
export type GitExecResult =
  | { stdout: string; stderr: string }
  | { error: NodeJS.ErrnoException };

export interface GitProviderInput {
  cwd: string;
  baseRef?: { ref: string; provenance: Provenance };
  /** Chosen head; defaults to `HEAD`. `headMissing` marks Decision D29. */
  headRef?: { ref: string; provenance: Provenance; headMissing?: boolean };
  include?: string[];
  exclude?: string[];
  exec: (args: string[], options: GitExecOptions) => GitExecResult;
  /** Test hook: lowers the Stage 2 maxBuffer (default 16 MiB). */
  maxBuffer?: number;
}

export interface GitProviderResult {
  files: ChangedFile[];
  commits: { sha: string; message: string; provenance: Provenance }[];
  head?: { sha: string; provenance: Provenance };
  truncated: { file: string; reason: TruncationReason }[];
  status: { name: 'git'; status: 'used' | 'unavailable'; reason?: ReasonCode };
}

/** Decision D24 names, compared in lower case on the base name. */
const SENSITIVE_EXACT = new Set([
  '.env',
  'id_rsa',
  'id_ed25519',
  '.npmrc',
  'id_ecdsa',
  'id_dsa',
  '.netrc',
  '.git-credentials',
  '.pypirc',
]);
const SENSITIVE_SUFFIX = ['.pem', '.key', '.p12', '.pfx'];
/** Pathspec names for the Stage 2 `exclude,glob,icase` magic. */
const SENSITIVE_PATHSPEC_NAMES = [
  '.env',
  '.env.*',
  '*.pem',
  'id_rsa',
  'id_ed25519',
  '.npmrc',
  'id_ecdsa',
  'id_dsa',
  '*.key',
  '*.p12',
  '*.pfx',
  '.netrc',
  '.git-credentials',
  '.pypirc',
];

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return (i === -1 ? path : path.slice(i + 1)).toLowerCase();
}
function isEnvName(path: string): boolean {
  const b = baseName(path);
  return b === '.env' || b.startsWith('.env.');
}
function isSensitiveName(path: string): boolean {
  const b = baseName(path);
  return (
    SENSITIVE_EXACT.has(b) ||
    b.startsWith('.env.') ||
    SENSITIVE_SUFFIX.some((s) => b.endsWith(s))
  );
}

const GIT_OPTIONS = [
  '--no-optional-locks',
  '-c', 'core.quotePath=false',
  '-c', 'diff.noprefix=false',
  '-c', 'diff.mnemonicPrefix=false',
  '-c', 'diff.renameLimit=1000',
];
const DIFF_OPTIONS = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '-M',
  '--diff-algorithm=myers',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--unified=3',
];

interface Entry {
  path: string;
  oldPath?: string;
  status: ChangedFile['status'];
}

function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function mapStatus(letter: string): ChangedFile['status'] {
  switch (letter[0]) {
    case 'A':
    case 'C':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
}

function parseNameStatus(out: string): Entry[] | undefined {
  const tokens = out.split('\0');
  if (tokens[tokens.length - 1] === '') tokens.pop();
  const entries: Entry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const letter = tokens[i++] as string;
    if (letter === '') return undefined;
    if (letter[0] === 'R' || letter[0] === 'C') {
      const oldPath = tokens[i++];
      const path = tokens[i++];
      if (oldPath === undefined || path === undefined) return undefined;
      entries.push({ path, oldPath, status: mapStatus(letter) });
    } else {
      const path = tokens[i++];
      if (path === undefined) return undefined;
      entries.push({ path, status: mapStatus(letter) });
    }
  }
  return entries;
}

/** Git's C-style quoting of a path inside a `diff --git` header (quotePath=false). */
function quoteGitName(name: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/["\\\x00-\x1f\x7f]/.test(name)) return name;
  let out = '"';
  for (const byte of Buffer.from(name)) {
    const ch = String.fromCharCode(byte);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (byte === 0x0a) out += '\\n';
    else if (byte === 0x09) out += '\\t';
    else if (byte === 0x0d) out += '\\r';
    else if (byte < 0x20 || byte === 0x7f) out += '\\' + byte.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out + '"';
}

function headerKeys(e: Entry): string[] {
  const a = `a/${e.oldPath ?? e.path}`;
  const b = `b/${e.path}`;
  const raw = `diff --git ${a} ${b}`;
  const quotedWhole = `diff --git ${quoteGitName(a)} ${quoteGitName(b)}`;
  return raw === quotedWhole ? [raw] : [raw, quotedWhole];
}

function isMaxBuffer(error: NodeJS.ErrnoException): boolean {
  return error.code === 'ENOBUFS' || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}

function isBinaryBlock(block: string): boolean {
  return /^(Binary files .* differ|GIT binary patch)$/m.test(block);
}

function unavailable(reason: ReasonCode): GitProviderResult {
  return {
    files: [],
    commits: [],
    truncated: [],
    status: { name: 'git', status: 'unavailable', reason },
  };
}

function buildBatches(entries: Entry[]): Entry[][] {
  const batches: Entry[][] = [];
  let current: Entry[] = [];
  let bytes = 0;
  for (const e of entries) {
    const size =
      Buffer.byteLength(e.path) + (e.oldPath === undefined ? 0 : Buffer.byteLength(e.oldPath));
    if (current.length > 0 && (current.length >= BATCH_MAX_ENTRIES || bytes + size > BATCH_MAX_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(e);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function resolveGit(input: GitProviderInput): GitProviderResult {
  const maxBuffer = input.maxBuffer ?? MAX_BUFFER;
  const run = (args: string[], buffer = MAX_BUFFER): GitExecResult =>
    input.exec([...GIT_OPTIONS, ...args], {
      maxBuffer: buffer,
      cwd: input.cwd,
      env: { GIT_OPTIONAL_LOCKS: '0' },
    });
  const ok = (r: GitExecResult): r is { stdout: string; stderr: string } => !('error' in r);

  // 1. Work tree.
  const inside = run(['rev-parse', '--is-inside-work-tree']);
  if (!ok(inside) || inside.stdout.trim() !== 'true') return unavailable('not-a-repository');

  // 2. Base.
  if (!input.baseRef) return unavailable('base-unresolved');
  const baseRes = run(['rev-parse', '--verify', '--quiet', `${input.baseRef.ref}^{commit}`]);
  const baseSha = ok(baseRes) ? baseRes.stdout.trim() : '';
  if (!ok(baseRes) || baseSha === '') return unavailable('base-unresolved');

  // 3. Head.
  const headRef = input.headRef ?? {
    ref: 'HEAD',
    provenance: { provider: 'git' as const, location: 'HEAD' },
  };
  const headRes = run(['rev-parse', '--verify', '--quiet', `${headRef.ref}^{commit}`]);
  const headSha = ok(headRes) ? headRes.stdout.trim() : '';
  if (!ok(headRes) || headSha === '') return unavailable('git-failed');

  // 4. Merge base.
  const mb = run(['merge-base', baseSha, headSha]);
  const mergeBase = ok(mb) ? mb.stdout.trim() : '';
  if (!ok(mb) || mergeBase === '') return unavailable('merge-base-missing');

  // 5. Stage 1: no pathspec.
  const s1 = run(['diff', '--name-status', '-z', ...DIFF_OPTIONS, mergeBase, headSha]);
  if (!ok(s1)) return unavailable('git-failed');
  const listing = parseNameStatus(s1.stdout);
  if (!listing) return unavailable('git-failed');

  // 6-7. Classify Sensitive_Files, then apply include/exclude to the rest.
  const include = input.include ?? [];
  const exclude = input.exclude ?? [];
  const sensitive: Entry[] = [];
  const wanted: Entry[] = [];
  for (const e of listing) {
    if (isSensitiveName(e.path) || (e.oldPath !== undefined && isSensitiveName(e.oldPath))) {
      sensitive.push(e);
      continue;
    }
    if (include.length > 0 && !matchesAny(include, e.path)) continue;
    if (exclude.length > 0 && matchesAny(exclude, e.path)) continue;
    wanted.push(e);
  }
  wanted.sort((a, b) => compareBytes(a.path, b.path));

  // 8-9. Stage 2 in Patch_Batches.
  const sensitiveExcludes = SENSITIVE_PATHSPEC_NAMES.map((n) => `:(exclude,glob,icase)**/${n}`);
  const patches = new Map<Entry, string>(); // entry -> raw patch block
  const unfit = new Set<Entry>(); // dropped because of size
  const keyIndex = new Map<string, Entry>();
  for (const e of wanted) for (const k of headerKeys(e)) keyIndex.set(k, e);

  const runBatch = (batch: Entry[]): GitExecResult => {
    const specs: string[] = [];
    for (const e of batch) {
      specs.push(`:(literal)${e.path}`);
      if (e.oldPath !== undefined) specs.push(`:(literal)${e.oldPath}`);
    }
    return run(
      ['diff', '-p', ...DIFF_OPTIONS, mergeBase, headSha, '--', ...specs, ...sensitiveExcludes],
      maxBuffer,
    );
  };
  const collect = (batch: Entry[], stdout: string): void => {
    const keys = new Map<string, Entry>();
    for (const e of batch) for (const k of headerKeys(e)) keys.set(k, e);
    for (const block of stdout.split(/^(?=diff --git )/m)) {
      if (!block.startsWith('diff --git ')) continue;
      const header = block.slice(0, block.indexOf('\n') === -1 ? undefined : block.indexOf('\n'));
      const entry = keys.get(header);
      if (!entry) continue; // orphan patch: discard
      if (Buffer.byteLength(block) > RAW_PATCH_LIMIT) unfit.add(entry);
      else patches.set(entry, block);
    }
  };

  for (const batch of buildBatches(wanted)) {
    const res = runBatch(batch);
    if (ok(res)) {
      collect(batch, res.stdout);
      continue;
    }
    if (!isMaxBuffer(res.error)) return unavailable('git-failed');
    for (const e of batch) {
      const single = runBatch([e]);
      if (ok(single)) collect([e], single.stdout);
      else if (isMaxBuffer(single.error)) unfit.add(e);
      else return unavailable('git-failed');
    }
  }

  // 10-12. Assemble files and Truncation_Records.
  const truncated: { file: string; reason: TruncationReason }[] = [];
  const out: { entry: Entry; file: ChangedFile }[] = [];
  const make = (e: Entry, patch: string): ChangedFile => {
    const f: ChangedFile = {
      path: e.path,
      status: e.status,
      patch,
      provenance: { provider: 'git', ref: headSha, location: e.path },
    };
    if (e.oldPath !== undefined) f.oldPath = e.oldPath;
    return f;
  };
  const records = new Map<Entry, TruncationReason>();
  for (const e of sensitive) {
    out.push({ entry: e, file: make(e, '') });
    const env = isEnvName(e.path) || (e.oldPath !== undefined && isEnvName(e.oldPath));
    records.set(e, env ? 'env-file' : 'sensitive-file');
  }
  for (const e of wanted) {
    const block = patches.get(e);
    if (unfit.has(e) || block === undefined) {
      out.push({ entry: e, file: make(e, '') });
      records.set(e, 'dropped');
    } else if (isBinaryBlock(block)) {
      out.push({ entry: e, file: make(e, '') });
      records.set(e, 'binary');
    } else {
      out.push({ entry: e, file: make(e, block) });
    }
  }
  out.sort((a, b) => compareBytes(a.file.path, b.file.path));
  for (const { entry } of out) {
    const reason = records.get(entry);
    if (reason) truncated.push({ file: entry.path, reason });
  }

  // 13. Commits, oldest first, no merges.
  const log = run([
    'log',
    '--no-merges',
    '--reverse',
    '--format=%H%x00%B%x03',
    `${mergeBase}..${headSha}`,
  ]);
  if (!ok(log)) return unavailable('git-failed');
  const commits: GitProviderResult['commits'] = [];
  for (const rec of log.stdout.split('\x03')) {
    const r = rec.replace(/^\n/, '');
    const nul = r.indexOf('\0');
    if (nul === -1) continue;
    const sha = r.slice(0, nul);
    const message = r.slice(nul + 1).replace(/\s+$/, '');
    commits.push({ sha, message, provenance: { provider: 'git', ref: sha, location: 'message' } });
  }

  // 14. Status.
  const status: GitProviderResult['status'] = { name: 'git', status: 'used' };
  if (headRef.headMissing) status.reason = 'head-missing';
  return {
    files: out.map((o) => o.file),
    commits,
    head: { sha: headSha, provenance: headRef.provenance },
    truncated,
    status,
  };
}
