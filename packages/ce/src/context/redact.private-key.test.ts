import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { REDACTED } from '../config/secrets.js';
import { redact } from './redact.js';

// Feature: ce-context-resolver, Property 15: Private_Key_Block redaction covers every partial and full form
// **Validates: Requirements 5.15, 5.16, 11.19, 11.20**

const NUM_RUNS = 100;

const labelArb = fc.constantFrom('', 'RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED ', 'DSA ');
const bodyLineArb = fc.stringMatching(/^[A-Za-z0-9+/]{24,64}$/);
const bodyArb = fc.array(bodyLineArb, { minLength: 1, maxLength: 6 });
// Plain surrounding lines that cannot look like secrets or markers.
const plainLineArb = fc.stringMatching(/^[a-z]{3,8}( [a-z]{3,8}){0,3}$/);
const plainArb = fc.array(plainLineArb, { minLength: 0, maxLength: 4 });
const formArb = fc.constantFrom('begin-only', 'end-only', 'full');

const opts = (textKind: 'patch' | 'text') => ({
  secrets: [] as string[],
  configuredPatterns: [] as RegExp[],
  textKind,
});

type Parts = {
  form: 'begin-only' | 'end-only' | 'full';
  label: string;
  body: string[];
  before: string[];
  after: string[];
};

const partsArb: fc.Arbitrary<Parts> = fc.record({
  form: formArb,
  label: labelArb,
  body: bodyArb,
  before: plainArb,
  after: plainArb,
});

/** Lines of one hunk (without prefixes) plus the indexes of the body lines. */
function build(p: Parts): { lines: string[]; bodyIdx: number[] } {
  const begin = `-----BEGIN ${p.label}PRIVATE KEY-----`;
  const end = `-----END ${p.label}PRIVATE KEY-----`;
  const lines: string[] = [];
  const bodyIdx: number[] = [];
  const pushBody = (): void => {
    for (const b of p.body) {
      bodyIdx.push(lines.length);
      lines.push(b);
    }
  };
  if (p.form === 'begin-only') {
    lines.push(...p.before, begin);
    pushBody();
  } else if (p.form === 'end-only') {
    // No earlier BEGIN: the body is at the start of the hunk.
    pushBody();
    lines.push(end, ...p.after);
  } else {
    lines.push(...p.before, begin);
    pushBody();
    lines.push(end, ...p.after);
  }
  return { lines, bodyIdx };
}

const prefixArb = fc.constantFrom('+', '-', ' ');

describe('Property 15: Private_Key_Block redaction covers every partial and full form', () => {
  it('patch kind: no body line survives, idempotent, line count and prefixes unchanged', () => {
    fc.assert(
      fc.property(
        partsArb,
        fc.array(prefixArb, { minLength: 40, maxLength: 40 }),
        plainArb,
        (p, prefixes, header) => {
          const { lines, bodyIdx } = build(p);
          const prefixed = lines.map((l, i) => `${prefixes[i]}${l}`);
          const input = [
            'diff --git a/k.txt b/k.txt',
            '--- a/k.txt',
            '+++ b/k.txt',
            `@@ -1,${lines.length} +1,${lines.length} @@ ${header.join(' ')}`.trimEnd(),
            ...prefixed,
          ].join('\n');

          const once = redact(input, opts('patch'));
          for (const i of bodyIdx) expect(once.text).not.toContain(lines[i] as string);

          const inLines = input.split('\n');
          const outLines = once.text.split('\n');
          expect(outLines.length).toBe(inLines.length);
          const hunkStart = 4;
          for (let i = 0; i < hunkStart; i += 1) expect(outLines[i]).toBe(inLines[i]);
          for (let i = hunkStart; i < inLines.length; i += 1) {
            expect((outLines[i] as string).charAt(0)).toBe((inLines[i] as string).charAt(0));
          }
          expect(once.count).toBeGreaterThan(0);

          const twice = redact(once.text, opts('patch'));
          expect(twice.text).toBe(once.text);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('text kind: no body line survives and the output is idempotent', () => {
    fc.assert(
      fc.property(partsArb, (p) => {
        const { lines, bodyIdx } = build(p);
        const input = lines.join('\n');
        const once = redact(input, opts('text'));
        for (const i of bodyIdx) expect(once.text).not.toContain(lines[i] as string);
        expect(once.text).toContain(REDACTED);
        expect(once.count).toBeGreaterThan(0);
        expect(redact(once.text, opts('text')).text).toBe(once.text);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  describe('examples', () => {
    it('a block containing an existing marker is redacted to its END line', () => {
      const input = [
        '-----BEGIN PRIVATE KEY-----',
        'AAAAAAAAAAAAAAAAAAAAAAAA1',
        REDACTED,
        'BBBBBBBBBBBBBBBBBBBBBBBB2',
        '-----END PRIVATE KEY-----',
        'after the block',
      ].join('\n');
      const out = redact(input, opts('text')).text;
      expect(out).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAA1');
      expect(out).not.toContain('BBBBBBBBBBBBBBBBBBBBBBBB2');
      expect(out).not.toContain('PRIVATE KEY');
      expect(out).toContain('after the block');
      expect(redact(out, opts('text')).text).toBe(out);
    });

    it('the same block in a patch keeps line count and prefixes', () => {
      const input = [
        '@@ -0,0 +1,5 @@',
        '+-----BEGIN PRIVATE KEY-----',
        '+AAAAAAAAAAAAAAAAAAAAAAAA1',
        `+${REDACTED}`,
        '+BBBBBBBBBBBBBBBBBBBBBBBB2',
        '+-----END PRIVATE KEY-----',
      ].join('\n');
      const out = redact(input, opts('patch')).text;
      expect(out.split('\n')).toEqual(['@@ -0,0 +1,5 @@', ...Array(5).fill(`+${REDACTED}`)]);
    });

    it('a text field with BEGIN and no END is redacted to the end of the text', () => {
      const input = [
        'before',
        '-----BEGIN RSA PRIVATE KEY-----',
        'CCCCCCCCCCCCCCCCCCCCCCCC3',
        'DDDDDDDDDDDDDDDDDDDDDDDD4',
      ].join('\n');
      const out = redact(input, opts('text')).text;
      expect(out).toBe(`before\n${REDACTED}`);
    });
  });
});
