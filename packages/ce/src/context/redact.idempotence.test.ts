import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileRedactPattern } from '../config/redact-pattern.js';
import { redact } from './redact.js';

// Feature: ce-context-resolver, Property 2: Redaction is idempotent
// **Validates: Requirements 5.5, 5.6, 5.12, 11.2**

const SECRET = 'SECRETVAL1';
const SECRETS = [SECRET, 'hunter2-long-value'];

const PATTERNS = [
  'RED',
  '/[A-Z]+/',
  '/\\[REDACTED\\]/',
  '/^x+$/',
  '/^x+$/m',
  '/\\bfoo\\b/',
  '/(?<=a)b/',
  '/b(?=c)/',
  '/(?<!z)y(?!z)/',
  '/\\bSECRET\\w*/',
  '/x+$/',
  '/^\\s+/m',
  '/ED\\]/',
  '/\\[RED/',
];

const compiled = PATTERNS.map((p) => {
  const re = compileRedactPattern(p);
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return new RegExp(re.source, flags);
});

const pieces = fc.constantFrom(
  SECRET,
  'hunter2-long-value',
  '[REDACTED]',
  '[RED',
  'ACTED]',
  'RED',
  'xx',
  'x',
  'foo',
  'abc',
  'zyz',
  ' ',
  '\n',
  'API_KEY=abcdef123456',
  'password: "p4ssw0rdvalue"',
  'Authorization: Bearer abc.def-ghi123',
  'https://u:pw123456@host/',
  'AB',
  'z',
);

const textArb = fc
  .array(fc.oneof(pieces, fc.string({ maxLength: 6 })), { maxLength: 12 })
  .map((a) => a.join(''));

const optsArb = fc.record({
  patterns: fc.subarray(compiled),
  textKind: fc.constantFrom('text' as const, 'patch' as const),
  extension: fc.constantFrom(undefined, '.ts', '.css'),
});

describe('Property 2: Redaction is idempotent', () => {
  it('Feature: ce-context-resolver, Property 2: redact(redact(x)) = redact(x)', () => {
    fc.assert(
      fc.property(textArb, optsArb, (text, o) => {
        const opts = {
          secrets: SECRETS,
          configuredPatterns: o.patterns,
          textKind: o.textKind,
          extension: o.extension,
        };
        const once = redact(text, opts);
        const twice = redact(once.text, opts);
        expect(twice.text).toBe(once.text);
        expect(twice.count).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('example: /^x+$/ over xxSECRETVAL1xx', () => {
    const opts = {
      secrets: [SECRET],
      configuredPatterns: [compileRedactPattern('/^x+$/')].map(
        (r) => new RegExp(r.source, 'g'),
      ),
      textKind: 'text' as const,
    };
    const once = redact(`xx${SECRET}xx`, opts);
    expect(once.text).not.toContain(SECRET);
    expect(redact(once.text, opts).text).toBe(once.text);
  });
});
