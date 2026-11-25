import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileRedactPattern } from '../config/redact-pattern.js';
import { collectSecretValues } from '../config/secrets.js';
import { redact } from './redact.js';

// Feature: ce-context-resolver, Property 1: Redaction removes every embedded secret
// **Validates: Requirements 5.1, 5.3, 5.4, 5.7, 5.13, 11.1**

const chars = (set: string, min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...set.split('')), { minLength: min, maxLength: max })
    .map((a) => a.join(''));

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const UPPER_DIGIT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const URLSAFE = `${ALNUM}_-`;

const builtInSecret: fc.Arbitrary<string> = fc.oneof(
  chars(URLSAFE, 20, 40).map((s) => `sk-A1${s}`),
  chars(URLSAFE, 16, 30).map((s) => `sk_live_${s}`),
  chars(URLSAFE, 16, 30).map((s) => `xoxb-${s}`),
  chars(ALNUM, 36, 44).map((s) => `ghp_${s}`),
  chars(URLSAFE, 22, 40).map((s) => `github_pat_${s}`),
  chars(ALNUM, 36, 44).map((s) => `npm_${s}`),
  chars(URLSAFE, 35, 45).map((s) => `AIza${s}`),
  chars(UPPER_DIGIT, 16, 16).map((s) => `AKIA${s}`),
  fc
    .tuple(chars(URLSAFE, 5, 20), chars(URLSAFE, 5, 20), chars(URLSAFE, 5, 20))
    .map(([a, b, c]) => `eyJ${a}.eyJ${b}.${c}`),
);

// Surrounding text is lowercase words and spaces, so it never contains a secret.
const words = chars('abcdefghij .,;\n', 0, 30);

const secretVariable = chars(UPPER_DIGIT, 8, 24).filter((s) => !/^\d+$/.test(s));

const configured = fc
  .tuple(chars('QWXYZ', 3, 6), chars('0123456789abcdef', 8, 16))
  .map(([prefix, body]) => ({ pattern: `${prefix}-[0-9a-f]{8,16}`, secret: `${prefix}-${body}` }));

describe('Property 1: Redaction removes every embedded secret', () => {
  it('Feature: ce-context-resolver, Property 1 (built-in patterns)', () => {
    fc.assert(
      fc.property(
        builtInSecret,
        words,
        words,
        fc.constantFrom('patch', 'text'),
        (secret, before, after, textKind) => {
          const prefix = textKind === 'patch' ? '+' : '';
          const input = `${prefix}${before} ${secret} ${after}`;
          const out = redact(input, { secrets: [], configuredPatterns: [], textKind });
          expect(out.text).not.toContain(secret);
          expect(out.count).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: ce-context-resolver, Property 1 (Secret_Variable values)', () => {
    fc.assert(
      fc.property(
        secretVariable,
        fc.constantFrom('MY_API_KEY', 'DB_PASSWORD', 'AUTH_TOKEN', 'OPENROUTER_API_KEY'),
        words,
        words,
        (value, name, before, after) => {
          const secrets = collectSecretValues({ [name]: value });
          expect(secrets).toContain(value);
          const out = redact(`${before} ${value} ${after}`, {
            secrets,
            configuredPatterns: [],
            textKind: 'text',
          });
          expect(out.text).not.toContain(value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Feature: ce-context-resolver, Property 1 (configured patterns)', () => {
    fc.assert(
      fc.property(configured, words, words, ({ pattern, secret }, before, after) => {
        const out = redact(`${before} ${secret} ${after}`, {
          secrets: [],
          configuredPatterns: [compileRedactPattern(pattern)],
          textKind: 'text',
        });
        expect(out.text).not.toContain(secret);
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: ce-context-resolver, Property 1 (all three kinds combined)', () => {
    fc.assert(
      fc.property(
        builtInSecret,
        secretVariable,
        configured,
        words,
        words,
        (builtIn, variable, cfg, before, after) => {
          const input = `${before} ${builtIn} ${variable} ${cfg.secret} ${after}`;
          const out = redact(input, {
            secrets: collectSecretValues({ SERVICE_TOKEN: variable }),
            configuredPatterns: [compileRedactPattern(cfg.pattern)],
            textKind: 'text',
          });
          for (const s of [builtIn, variable, cfg.secret]) expect(out.text).not.toContain(s);
        },
      ),
      { numRuns: 100 },
    );
  });
});
