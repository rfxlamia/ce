import { REDACTED, redactSecretValues } from '../config/secrets.js';

// Pure redactor (Requirement 5). No file, network or environment access and no
// import from jev/. Pass structure: Decisions D11, D12, D19, D22, D27.

export type RedactOptions = {
  /** Secret_Variable values from collectSecretValues(env). */
  secrets: readonly string[];
  /** Compiled `context.redact` patterns (compileRedactPattern). */
  configuredPatterns: readonly RegExp[];
  /** `patch` keeps diff prefixes and line counts in Private_Key_Blocks. */
  textKind: 'patch' | 'text';
  /** File extension of a Changed_File (for the .css/.scss/.less exception). */
  extension?: string;
};

type Range = readonly [number, number];

const BOUNDARY = '(?<![A-Za-z0-9_-])';

const BUILT_IN_PATTERNS: readonly RegExp[] = [
  // Authorization bearer / basic header value.
  /(?<![A-Za-z0-9_-])Authorization["']?[ \t]*[:=][ \t]*["']?(?:Bearer|Basic)[ \t]+(?<secret>[A-Za-z0-9._~+/=-]+)/gid,
  new RegExp(`${BOUNDARY}sk-(?=[A-Za-z0-9_-]*[0-9A-Z])[A-Za-z0-9_-]{20,}`, 'gd'),
  new RegExp(`${BOUNDARY}sk_(?:live|test)_[A-Za-z0-9_-]{16,}`, 'gd'),
  new RegExp(`${BOUNDARY}xox[bpars]-[A-Za-z0-9_-]{16,}`, 'gd'),
  new RegExp(`${BOUNDARY}gh[pousr]_[A-Za-z0-9]{36,}`, 'gd'),
  new RegExp(`${BOUNDARY}github_pat_[A-Za-z0-9_-]{22,}`, 'gd'),
  new RegExp(`${BOUNDARY}npm_[A-Za-z0-9]{36,}`, 'gd'),
  new RegExp(`${BOUNDARY}AIza[A-Za-z0-9_-]{35,}`, 'gd'),
  new RegExp(`${BOUNDARY}AKIA[A-Z0-9]{16}(?![A-Z0-9])`, 'gd'),
  new RegExp(`${BOUNDARY}eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+`, 'gd'),
  // Password in scheme://user:password@host
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:/@]+:(?<secret>[^\s@/]+)@/gd,
];

const STRICT_KEY_RULE =
  /(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]*(?:api[-_]?key|access[-_]key|secret[-_]key|private[-_]key|auth[-_]key|secret|token|password|passwd|pwd)["']?[ \t]*[:=][ \t]*(?:"(?<dq>[^"\s]+)"|'(?<sq>[^'\s]+)'|(?<uq>[^\s"'`]+))/gid;

const VALUE_DENY_LIST = new Set([
  'true',
  'false',
  'yes',
  'no',
  'on',
  'off',
  'null',
  'undefined',
  'none',
]);
const IDENTIFIER_SHAPED = /^[A-Za-z_$][\w$]*(\.[\w$]+)*(\(\))?[,;]?$/;
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.less']);

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

/** Replace the ranges chosen by `pick` for each non-empty match of `re`. */
function replaceMatches(
  segment: string,
  re: RegExp,
  pick: (m: RegExpMatchArray) => Range | undefined,
): { text: string; count: number } {
  let flags = re.flags;
  if (!flags.includes('g')) flags += 'g';
  if (!flags.includes('d')) flags += 'd';
  const global = new RegExp(re.source, flags);
  let out = '';
  let last = 0;
  let count = 0;
  for (const m of segment.matchAll(global)) {
    if (m[0].length === 0) continue;
    const range = pick(m);
    if (!range || range[1] <= range[0] || range[0] < last) continue;
    out += segment.slice(last, range[0]) + REDACTED;
    last = range[1];
    count += 1;
  }
  if (count === 0) return { text: segment, count: 0 };
  return { text: out + segment.slice(last), count };
}

function pickSecretGroup(m: RegExpMatchArray): Range | undefined {
  const indices = (m as RegExpMatchArray & { indices?: RegExpIndicesArray }).indices;
  const group = indices?.groups?.secret;
  if (group) return group;
  if (m.groups && 'secret' in m.groups) return undefined; // group did not participate
  return indices?.[0];
}

function pickCredentialValue(m: RegExpMatchArray): Range | undefined {
  const indices = (m as RegExpMatchArray & { indices?: RegExpIndicesArray }).indices;
  const groups = m.groups ?? {};
  const quoted = groups.dq !== undefined || groups.sq !== undefined;
  const name = groups.dq !== undefined ? 'dq' : groups.sq !== undefined ? 'sq' : 'uq';
  const value = groups[name];
  if (value === undefined) return undefined;
  if (value.length < 8) return undefined;
  if (/^\d+$/.test(value)) return undefined;
  if (VALUE_DENY_LIST.has(value.toLowerCase())) return undefined;
  if (!quoted && !/\d/.test(value) && IDENTIFIER_SHAPED.test(value)) return undefined;
  return indices?.groups?.[name];
}

function mapSegments(
  text: string,
  fn: (segment: string) => { text: string; count: number },
): { text: string; count: number } {
  const parts = text.split(REDACTED);
  let count = 0;
  const mapped = parts.map((part) => {
    if (part.length === 0) return part;
    const r = fn(part);
    count += r.count;
    return r.text;
  });
  return { text: mapped.join(REDACTED), count };
}

function countMarkers(text: string): number {
  return text.split(REDACTED).length - 1;
}

function redactSegment(
  segment: string,
  opts: RedactOptions,
  skipKeyRule: boolean,
): { text: string; count: number } {
  let text = segment;
  let count = 0;
  const stage = (fn: (s: string) => { text: string; count: number }): void => {
    const r = mapSegments(text, fn);
    text = r.text;
    count += r.count;
  };

  for (const pattern of BUILT_IN_PATTERNS) {
    stage((s) => replaceMatches(s, pattern, pickSecretGroup));
  }
  if (!skipKeyRule) {
    stage((s) => replaceMatches(s, STRICT_KEY_RULE, pickCredentialValue));
  }
  if (opts.secrets.length > 0) {
    stage((s) => {
      const next = redactSecretValues(s, opts.secrets);
      return { text: next, count: countMarkers(next) };
    });
  }
  for (const pattern of opts.configuredPatterns) {
    stage((s) => replaceMatches(s, pattern, pickSecretGroup));
  }
  return { text, count };
}

type Block = { from: number; to: number };

/** Find covered line ranges of Private_Key_Blocks in one Patch_Hunk (D22). */
function findBlocks(lines: string[], start: number, end: number): Block[] {
  const blocks: Block[] = [];
  let seenBoundary = false;
  let open: number | undefined;
  for (let i = start; i < end; i += 1) {
    const line = lines[i] as string;
    if (open === undefined) {
      if (PRIVATE_KEY_BEGIN.test(line)) {
        seenBoundary = true;
        if (PRIVATE_KEY_END.test(line)) blocks.push({ from: i, to: i });
        else open = i;
      } else if (!seenBoundary && PRIVATE_KEY_END.test(line)) {
        seenBoundary = true;
        blocks.push({ from: start, to: i });
      }
    } else if (PRIVATE_KEY_END.test(line)) {
      blocks.push({ from: open, to: i });
      open = undefined;
    }
  }
  if (open !== undefined) blocks.push({ from: open, to: end - 1 });
  return blocks;
}

function hunkBounds(lines: string[], kind: 'patch' | 'text'): [number, number][] {
  if (kind === 'text') return [[0, lines.length]];
  const bounds: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.startsWith('@@')) {
      bounds.push([start, i]);
      start = i + 1;
    } else if (line.startsWith('diff --git ')) {
      bounds.push([start, i]);
      start = i;
    }
  }
  bounds.push([start, lines.length]);
  return bounds;
}

function redactPrivateKeyBlocks(
  text: string,
  kind: 'patch' | 'text',
): { text: string; count: number } {
  if (!text.includes('PRIVATE KEY-----')) return { text, count: 0 };
  const lines = text.split('\n');
  const blocks: Block[] = [];
  for (const [s, e] of hunkBounds(lines, kind)) blocks.push(...findBlocks(lines, s, e));
  if (blocks.length === 0) return { text, count: 0 };

  const out: string[] = [];
  let i = 0;
  for (const block of blocks) {
    if (block.from < i) continue; // already covered
    while (i < block.from) out.push(lines[i++] as string);
    if (kind === 'patch') {
      for (; i <= block.to; i += 1) {
        const first = (lines[i] as string).charAt(0);
        const prefix = first === '+' || first === '-' || first === ' ' ? first : '';
        out.push(prefix + REDACTED);
      }
    } else {
      out.push(REDACTED);
      i = block.to + 1;
    }
  }
  while (i < lines.length) out.push(lines[i++] as string);
  return { text: out.join('\n'), count: blocks.length };
}

/**
 * Remove secrets from `text`. Repeats a Redaction_Pass until the output stops
 * changing, so `redact(redact(x)) === redact(x)`. `count` is the number of
 * replacements over all passes.
 */
export function redact(text: string, opts: RedactOptions): { text: string; count: number } {
  const ext = opts.extension?.toLowerCase();
  const normalized = ext === undefined ? undefined : ext.startsWith('.') ? ext : `.${ext}`;
  const skipKeyRule = normalized !== undefined && STYLE_EXTENSIONS.has(normalized);

  let current = text;
  let total = 0;
  for (;;) {
    const blocks = redactPrivateKeyBlocks(current, opts.textKind);
    const segments = mapSegments(blocks.text, (s) => redactSegment(s, opts, skipKeyRule));
    const next = segments.text;
    if (next === current) return { text: current, count: total };
    total += blocks.count + segments.count;
    current = next;
  }
}
