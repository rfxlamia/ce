// Candidate_Extractor (Requirement 9). Extracts Claim candidates as exact,
// trimmed slices of already-redacted, already-budgeted text. Never rewrites
// text, never calls Jev, never imports from jev/.

import type { BudgetedChangeContext, ChangedFile, ClaimCandidate, Provenance } from './types.js';

export const CANDIDATE_CAP = 50;

export interface ExtractResult {
  candidates: ClaimCandidate[];
  truncated?: { file: '<candidates>'; reason: 'candidate-cap' };
}

type Raw = { text: string; provenance: Provenance };

/** Trim whitespace of text.slice(start, end) by moving offsets; returns the exact slice. */
function trimmedSlice(text: string, start: number, end: number): string {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  return text.slice(s, e);
}

// ---------------------------------------------------------------------------
// Prose splitting (title, description, commit messages)
// ---------------------------------------------------------------------------

const LIST_MARKER = /^(\s*)(?:[-*+]|\d+\.)\s+/;
const HEADING = /^#{1,6}(?:\s|$)/;

/** Split one sentence-run segment [start,end) at terminal punctuation. */
function splitSentences(text: string, start: number, end: number, out: string[]): void {
  let pos = start;
  for (let i = start; i < end; i++) {
    const c = text[i];
    if ((c === '.' || c === '!' || c === '?') && (i + 1 >= end || /\s/.test(text[i + 1]!))) {
      const piece = trimmedSlice(text, pos, i + 1);
      if (piece) out.push(piece);
      pos = i + 1;
    }
  }
  const rest = trimmedSlice(text, pos, end);
  if (rest) out.push(rest);
}

export function splitProse(text: string): string[] {
  const out: string[] = [];
  let segStart = -1;
  let segEnd = -1;
  let fence: string | null = null;
  let inHtml = false;

  const flush = (): void => {
    if (segStart >= 0) splitSentences(text, segStart, segEnd, out);
    segStart = -1;
    segEnd = -1;
  };

  let offset = 0;
  while (offset <= text.length) {
    let nl = text.indexOf('\n', offset);
    if (nl < 0) nl = text.length;
    const line = text.slice(offset, nl);
    const trimmed = line.trim();
    const lineStart = offset;
    const lineEnd = nl;
    offset = nl + 1;

    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (inHtml) {
      if (trimmed.includes('-->')) inHtml = false;
      continue;
    }
    const fenceMatch = /^(```|~~~)/.exec(trimmed);
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1]!;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      flush();
      if (!trimmed.includes('-->', 4)) inHtml = true;
      continue;
    }
    if (trimmed === '') {
      flush();
      continue;
    }
    if (HEADING.test(trimmed) || trimmed.startsWith('|')) {
      flush();
      continue;
    }
    const m = LIST_MARKER.exec(line);
    if (m) {
      flush();
      segStart = lineStart + m[0].length;
      segEnd = lineEnd;
      continue;
    }
    if (segStart < 0) segStart = lineStart;
    segEnd = lineEnd;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Comment_Line extraction (patches)
// ---------------------------------------------------------------------------

type Syntax = 'c' | 'hash' | 'py' | 'dash' | 'html';

const C_EXT = ['js', 'jsx', 'ts', 'tsx', 'java', 'c', 'h', 'cc', 'cpp', 'cs', 'go', 'rs', 'swift', 'kt', 'css', 'scss'];
const HASH_EXT = ['rb', 'sh', 'yml', 'yaml', 'toml'];
const DASH_EXT = ['sql', 'lua'];
const HTML_EXT = ['html', 'hbs', 'vue', 'svelte', 'md'];

function syntaxFor(path: string): Syntax | undefined {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  if (C_EXT.includes(ext)) return 'c';
  if (ext === 'py') return 'py';
  if (HASH_EXT.includes(ext)) return 'hash';
  if (DASH_EXT.includes(ext)) return 'dash';
  if (HTML_EXT.includes(ext)) return 'html';
  return undefined;
}

const DIRECTIVES = [
  'eslint-disable',
  'eslint-enable',
  'noqa',
  '@ts-expect-error',
  '@ts-ignore',
  '@ts-nocheck',
  'prettier-ignore',
  'istanbul ignore',
  'c8 ignore',
  'pylint:',
  'type: ignore',
];
const LICENSE = /^(?:copyright|spdx-license-identifier|licensed under|all rights reserved)/i;

function isDirective(content: string): boolean {
  return DIRECTIVES.some((d) => content.includes(d)) || LICENSE.test(content);
}

/** Content between the last stripped opener and a closer; trimmed exact slice. */
function between(line: string, from: number, to: number): string {
  return trimmedSlice(line, from, to);
}

interface LineState {
  block: boolean; // inside /* */ or <!-- -->
  doc: boolean; // inside python """ docstring
  docPending: { content: string; line: number }[];
}

/**
 * Extract the comment content of one line (without the diff prefix).
 * Mutates state. Returns the content, or undefined when not a comment line.
 */
function commentContent(syntax: Syntax, line: string, st: LineState): string | undefined {
  const t = line.trim();
  switch (syntax) {
    case 'c': {
      if (st.block) {
        const close = line.indexOf('*/');
        let from = line.search(/\S/);
        if (from < 0) from = line.length;
        if (line[from] === '*' && line[from + 1] !== '/') {
          from += 1;
          if (line[from] === ' ') from += 1;
        }
        if (close >= 0 && close >= from) {
          st.block = false;
          return between(line, from, close);
        }
        if (close >= 0) {
          st.block = false;
          return '';
        }
        return between(line, from, line.length);
      }
      if (t.startsWith('//')) {
        const i = line.indexOf('//');
        return between(line, i + 2, line.length);
      }
      if (t.startsWith('/*')) {
        const i = line.indexOf('/*');
        let from = i + 2;
        if (line[from] === '*' && line[from + 1] !== '/') from += 1;
        const close = line.indexOf('*/', from);
        if (close >= 0) return between(line, from, close);
        st.block = true;
        return between(line, from, line.length);
      }
      return undefined;
    }
    case 'hash':
    case 'py': {
      if (syntax === 'py' && t.startsWith('#')) {
        let i = line.indexOf('#');
        while (line[i] === '#') i++;
        return between(line, i, line.length);
      }
      if (syntax === 'hash' && t.startsWith('#')) {
        let i = line.indexOf('#');
        while (line[i] === '#') i++;
        return between(line, i, line.length);
      }
      return undefined;
    }
    case 'dash': {
      if (t.startsWith('--')) return between(line, line.indexOf('--') + 2, line.length);
      return undefined;
    }
    case 'html': {
      if (st.block) {
        const close = line.indexOf('-->');
        if (close >= 0) {
          st.block = false;
          return between(line, 0, close);
        }
        return between(line, 0, line.length);
      }
      if (t.startsWith('<!--')) {
        const from = line.indexOf('<!--') + 4;
        const close = line.indexOf('-->', from);
        if (close >= 0) return between(line, from, close);
        st.block = true;
        return between(line, from, line.length);
      }
      return undefined;
    }
  }
}

/** Comment_Lines of one file's patch: content with 1-based new-file line number. */
function commentLines(file: ChangedFile): { content: string; line: number }[] {
  const syntax = syntaxFor(file.path);
  if (!syntax) return [];
  const out: { content: string; line: number }[] = [];
  const lines = file.patch.split('\n');
  let inHunk = false;
  let newLine = 0;
  let st: LineState = { block: false, doc: false, docPending: [] };

  const endHunk = (): void => {
    // Unclosed docstring lines are discarded (must open and close in the hunk).
    st = { block: false, doc: false, docPending: [] };
  };

  for (const raw of lines) {
    const hh = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hh) {
      endHunk();
      inHunk = true;
      newLine = Number(hh[1]);
      continue;
    }
    if (!inHunk) continue;
    const prefix = raw[0];
    if (prefix === '\\' || prefix === '-') continue;
    const body = raw.slice(1).replace(/\r$/, '');
    const lineNo = newLine;
    newLine++;
    if (prefix !== '+') {
      // Context line: keep block state in sync, emit nothing.
      if (syntax !== 'py') commentContent(syntax, body, st);
      continue;
    }
    if (syntax === 'py') {
      const t = body.trim();
      if (st.doc) {
        const close = body.indexOf('"""');
        if (close >= 0) {
          st.docPending.push({ content: between(body, 0, close), line: lineNo });
          for (const p of st.docPending) out.push(withShebangMark(p, lineNo));
          st.doc = false;
          st.docPending = [];
        } else {
          st.docPending.push({ content: between(body, 0, body.length), line: lineNo });
        }
        continue;
      }
      if (t.startsWith('"""')) {
        const from = body.indexOf('"""') + 3;
        const close = body.indexOf('"""', from);
        if (close >= 0) {
          out.push({ content: between(body, from, close), line: lineNo });
        } else {
          st.doc = true;
          st.docPending = [{ content: between(body, from, body.length), line: lineNo }];
        }
        continue;
      }
    }
    const content = commentContent(syntax, body, st);
    if (content === undefined) continue;
    if (lineNo === 1 && body.trim().startsWith('#!')) continue; // shebang
    out.push({ content, line: lineNo });
  }
  return out;
}

function withShebangMark(p: { content: string; line: number }, _last: number): { content: string; line: number } {
  return p;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

function fieldProvenance(context: BudgetedChangeContext, location: 'title' | 'description'): Provenance {
  return (
    context.change.provenance.find((p) => p.location === location) ?? { provider: 'github', location }
  );
}

export function extractCandidates(context: BudgetedChangeContext): ExtractResult {
  const raw: Raw[] = [];
  const { change } = context;

  for (const claim of change.claims) {
    const text = claim.text.trim();
    if (text) raw.push({ text, provenance: claim.provenance });
  }
  if (change.title) {
    const prov = fieldProvenance(context, 'title');
    for (const text of splitProse(change.title)) raw.push({ text, provenance: prov });
  }
  if (change.description) {
    const prov = fieldProvenance(context, 'description');
    for (const text of splitProse(change.description)) raw.push({ text, provenance: prov });
  }
  for (const commit of change.commits) {
    for (const text of splitProse(commit.message)) raw.push({ text, provenance: commit.provenance });
  }
  for (const file of change.files) {
    for (const { content, line } of commentLines(file)) {
      if (!content || isDirective(content)) continue;
      raw.push({
        text: content,
        provenance: { ...file.provenance, location: `${file.path}:${line}` },
      });
    }
  }

  const seen = new Set<string>();
  const unique: Raw[] = [];
  for (const r of raw) {
    if (seen.has(r.text)) continue;
    seen.add(r.text);
    unique.push(r);
  }

  const capped = unique.length > CANDIDATE_CAP;
  const kept = capped ? unique.slice(0, CANDIDATE_CAP) : unique;
  const candidates = kept.map((r, i) => ({ id: `c${i + 1}`, text: r.text, provenance: r.provenance }));
  return capped
    ? { candidates, truncated: { file: '<candidates>', reason: 'candidate-cap' } }
    : { candidates };
}
