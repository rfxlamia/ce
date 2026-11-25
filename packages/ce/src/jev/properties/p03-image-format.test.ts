import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { finalImageQuestions } from '../catalog.js';
import { JevImageError } from '../errors.js';
import { createJsonTransport, detectImageFormat } from '../transport-json.js';

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];

const tail = fc.uint8Array({ minLength: 0, maxLength: 32 });

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

/** Arbitrary bytes, biased so that PNG and JPEG prefixes (and near misses) occur often. */
// The SDK's image() rejects empty data, so empty arrays cannot reach the transport.
const anyBytes = fc
  .oneof(
  fc.uint8Array({ minLength: 1, maxLength: 64 }),
  tail.map((t) => Uint8Array.from([...PNG, ...t])),
  tail.map((t) => Uint8Array.from([...JPEG, ...t])),
  fc
    .tuple(fc.constantFrom(PNG, JPEG), fc.nat(3), tail)
    .map(([prefix, cut, t]) => Uint8Array.from([...prefix.slice(0, cut % prefix.length), ...t])),
  fc
    .tuple(fc.constantFrom(PNG, JPEG), fc.nat(10), fc.nat(255))
    .map(([prefix, at, v]) => {
      const copy = [...prefix];
      const i = at % copy.length;
      copy[i] = (copy[i] as number) ^ ((v % 255) + 1);
      return Uint8Array.from(copy);
    }),
  )
  .filter((bytes) => bytes.length > 0);

function okResponse(): Response {
  return new Response(
    JSON.stringify({ model: 'typesafe/jev-1.14-test', answers: {}, usage: {} }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('jev-gateway properties', () => {
  // Feature: jev-gateway, Property 3: Image format detection from magic bytes is total and correct
  // **Validates: Requirements 2.5, 2.6**
  it('Property 3: exactly one of png, jpeg or JevImageError(invalid_image) with no fetch call', async () => {
    await fc.assert(
      fc.asyncProperty(anyBytes, async (bytes) => {
        const expected = startsWith(bytes, PNG) ? 'png' : startsWith(bytes, JPEG) ? 'jpeg' : null;
        expect(detectImageFormat(bytes)).toBe(expected);

        const fetchSpy = vi.fn(async () => okResponse());
        const transport = createJsonTransport({
          baseURL: 'https://example.invalid/api',
          apiKey: 'test-key',
          requestedModel: 'typesafe/jev-1.14',
          provider: 'openrouter',
          fetch: fetchSpy,
        });
        const request = finalImageQuestions('claim', bytes);
        const outcome = await transport.send(request, { timeoutMs: 1000 }).then(
          () => 'sent' as const,
          (error: unknown) => error,
        );

        if (expected === null) {
          expect(outcome).toBeInstanceOf(JevImageError);
          expect((outcome as JevImageError).reason).toBe('invalid_image');
          expect(fetchSpy).not.toHaveBeenCalled();
        } else {
          expect(outcome).toBe('sent');
          expect(fetchSpy).toHaveBeenCalledTimes(1);
          const calls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
          const body = JSON.parse(calls[0]?.[1].body as string) as {
            assets: Record<string, { format: string }>;
          };
          const formats = Object.values(body.assets).map((a) => a.format);
          expect(formats).toEqual([expected]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
