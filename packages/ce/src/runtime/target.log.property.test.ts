import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLogCapture } from './target.js';

const SECRET = 'S3cr€t-κλειδί';
const SECRET_NAME = 'MY_TARGET_SECRET';

// Multi-byte text: 1, 2, 3 and 4 byte UTF-8 characters, plus the secret value.
const pieceArb = fc.oneof(
  { arbitrary: fc.constantFrom('a', 'Z', '\n', ' ', 'é', 'ß', 'λ', '€', '日', '本', '😀', '𝒳'), weight: 6 },
  { arbitrary: fc.constant(SECRET), weight: 1 },
);
const textArb = fc.array(pieceArb, { minLength: 0, maxLength: 120 }).map((p) => p.join(''));

function redact(text: string): string {
  return text.split(SECRET).join('***');
}

function splitBytes(bytes: Buffer, cuts: number[]): Buffer[] {
  const points = [...new Set(cuts.map((c) => (bytes.length === 0 ? 0 : c % (bytes.length + 1))))].sort(
    (a, b) => a - b,
  );
  const parts: Buffer[] = [];
  let prev = 0;
  for (const p of [...points, bytes.length]) {
    parts.push(bytes.subarray(prev, p));
    prev = p;
  }
  return parts;
}

describe('log capture properties', () => {
  // Feature: runtime-target, Property 12: Log_Capture never exceeds its byte bound and is always a suffix of the redacted stream
  // **Validates: Requirements 5.3**
  it('Property 12: byte length never exceeds the bound and logs is a character-aligned suffix of the redacted stream', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(textArb, { minLength: 1, maxLength: 4 }),
        fc.array(fc.nat(2000), { maxLength: 12 }),
        fc.integer({ min: 4, max: 400 }),
        async (texts, cuts, maxBytes) => {
          const capture = createLogCapture({
            env: { [SECRET_NAME]: SECRET },
            secrets: [SECRET_NAME],
            maxBytes,
          });
          // One stream, fed at arbitrary byte offsets (may split multi-byte characters).
          const full = texts.join('');
          for (const part of splitBytes(Buffer.from(full, 'utf8'), cuts)) {
            capture.write('stdout', part);
            expect(Buffer.byteLength(capture.logs(), 'utf8')).toBeLessThanOrEqual(maxBytes);
          }
          capture.end('stdout');
          await capture.stop();

          const logs = capture.logs();
          const expected = redact(full);
          expect(Buffer.byteLength(logs, 'utf8')).toBeLessThanOrEqual(maxBytes);
          expect(expected.endsWith(logs)).toBe(true);
          expect(logs).not.toContain('\uFFFD');
          // Only whole characters are dropped: a cut loses less than one character (4 bytes max).
          if (Buffer.byteLength(expected, 'utf8') <= maxBytes) {
            expect(logs).toBe(expected);
          } else {
            expect(Buffer.byteLength(logs, 'utf8')).toBeGreaterThan(maxBytes - 4);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 12: the default bound is 262144 bytes', async () => {
    const capture = createLogCapture({ env: {} });
    const full = '日本😀é'.repeat(30000);
    // The repeat unit is 5 UTF-16 units, so a 7000-unit chunk never splits a surrogate pair.
    for (let i = 0; i < full.length; i += 7000) capture.write('stdout', full.slice(i, i + 7000));
    capture.end('stdout');
    await capture.stop();
    const logs = capture.logs();
    expect(Buffer.byteLength(logs, 'utf8')).toBeLessThanOrEqual(262144);
    expect(Buffer.byteLength(logs, 'utf8')).toBeGreaterThan(262144 - 4);
    expect(full.endsWith(logs)).toBe(true);
  });
});

describe('log capture chunking invariance', () => {
  // Feature: runtime-target, Property 13: Secret redaction is invariant to how a stream is chunked, including across the end-of-stream flush
  // **Validates: Requirements 5.8, 5.11**
  it('Property 13: stored text equals one-pass redaction of the unsplit stream and never contains the raw secret', async () => {
    // The secret starts with '#', which filler text never contains, so occurrences cannot overlap.
    const secretArb = fc
      .stringMatching(/^[A-Za-z0-9é€λ_-]{1,12}$/)
      .map((s) => `#${s}`);
    const fillerArb = fc.constantFrom('a', 'Z', '\n', ' ', 'é', 'λ', '€', '日', '😀', '𝒳', '-');
    await fc.assert(
      fc.asyncProperty(
        secretArb,
        fc.array(fc.oneof(fillerArb, fc.constant<string | null>(null)), { maxLength: 60 }),
        fc.array(fc.nat(1000), { maxLength: 10 }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('stdout', 'stderr') as fc.Arbitrary<'stdout' | 'stderr'>,
        async (secret, pieces, randomCuts, cutInsideSecret, cutBeforeSecret, stream) => {
          const chars: string[] = []; // code points, so a split never breaks a surrogate pair
          const starts: number[] = [];
          for (const p of pieces) {
            if (p === null) {
              starts.push(chars.length);
              chars.push(...Array.from(secret));
            } else {
              chars.push(p);
            }
          }
          const full = chars.join('');
          const secretLength = Array.from(secret).length;

          const cutSet = new Set<number>(randomCuts.map((c) => c % (chars.length + 1)));
          for (const start of starts) {
            if (cutInsideSecret) for (let k = 1; k < secretLength; k++) cutSet.add(start + k);
            if (cutBeforeSecret && start > 0) cutSet.add(start - 1);
          }
          const points = [...cutSet].sort((a, b) => a - b);

          const capture = createLogCapture({ env: { [SECRET_NAME]: secret }, secrets: [SECRET_NAME] });
          let prev = 0;
          for (const p of [...points, chars.length]) {
            capture.write(stream, chars.slice(prev, p).join(''));
            prev = p;
          }
          capture.end(stream);
          await capture.stop();

          const logs = capture.logs();
          expect(logs).toBe(full.split(secret).join('***'));
          expect(logs).not.toContain(secret);
        },
      ),
      { numRuns: 200 },
    );
  });
});
