import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatReport, type ValidationError } from '../errors.js';

// Feature: ce-config-loader, Property 12: Secret-matching values are always redacted in the printed report

// Secret-shaped strings. The "sk-" prefix and alphanumeric body ensure a secret
// can never occur inside the fixed report text or inside "[REDACTED]".
const secretArb = fc
  .tuple(
    fc.constantFrom('sk-or-v1-', 'sk-ts-', 'sk-'),
    fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), minLength: 8, maxLength: 40 }),
  )
  .map(([prefix, body]) => prefix + body);

// Surrounding text that contains no secret-like prefix.
const fillerArb = fc.string({
  unit: fc.constantFrom(...'ABCDEFGH 0123_.:/'.split('')),
  maxLength: 20,
});

const sourceArb = fc.constantFrom('flag', 'env', 'file', 'default', undefined);

describe('Property 12: secret redaction in the printed report', () => {
  it('never prints a secret that appears in a ValidationError value, and keeps the stored value intact', () => {
    fc.assert(
      fc.property(
        fc.array(secretArb, { minLength: 1, maxLength: 3 }),
        fc.array(fillerArb, { minLength: 4, maxLength: 4 }),
        fc.boolean(),
        sourceArb,
        (secrets, fillers, wrapInObject, source) => {
          const text = fillers[0] + secrets[0] + fillers[1] + secrets[secrets.length - 1] + fillers[2];
          const value: unknown = wrapInObject ? { k: [text] } : text;
          const error: ValidationError = {
            path: 'jev.model',
            value,
            expected: 'a known configuration key',
            ...(source !== undefined ? { source } : {}),
          };
          const before = JSON.stringify(error);

          const report = formatReport([error], secrets);

          for (const secret of secrets) expect(report).not.toContain(secret);
          expect(report).toContain('[REDACTED]');
          // Stored error is not modified and keeps the true value.
          expect(JSON.stringify(error)).toBe(before);
          expect(error.value).toBe(value);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('redacts a value that equals a secret exactly, and secrets that are substrings of each other', () => {
    fc.assert(
      fc.property(secretArb, fc.string({ unit: fc.constantFrom(...'xyz789'.split('')), minLength: 1, maxLength: 6 }), (secret, extra) => {
        const longer = secret + extra;
        const errors: ValidationError[] = [
          { path: 'a', value: secret, expected: 'x' },
          { path: 'b', value: longer, expected: 'x' },
        ];
        const report = formatReport(errors, [secret, longer]);
        expect(report).not.toContain(secret);
        expect(report).not.toContain(longer);
        expect(report.match(/\[REDACTED\]/g)?.length).toBe(2);
      }),
      { numRuns: 100 },
    );
  });

  it('leaves values without secrets unchanged', () => {
    const report = formatReport([{ path: 'runtime.max-steps', value: 'abc', expected: 'positive integer' }], ['sk-secret-value']);
    expect(report).toContain('"abc"');
    expect(report).not.toContain('[REDACTED]');
  });
});
