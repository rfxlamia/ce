import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stateHash } from "../hash.js";

// Feature: jev-gateway, Property 14: `stateHash` is deterministic, fixed-length, and distinguishes different text
// **Validates: Requirements 10.4, 10.5, 10.6**

// Rich alphabet: ASCII, whitespace/control characters, and full Unicode (well-formed, no lone surrogates).
const text = fc.oneof(
  fc.string({ unit: "grapheme", maxLength: 200 }),
  fc.string({ unit: "grapheme-ascii", maxLength: 200 }),
  fc.stringMatching(/^[ \t\r\n\u0000-\u001f]{0,20}[a-z]{0,20}$/),
);

describe("Property 14: stateHash is deterministic, fixed-length, and distinguishes different text", () => {
  it("returns the same 64 lowercase hex characters on every call", () => {
    fc.assert(
      fc.property(text, (state) => {
        const first = stateHash(state);
        expect(stateHash(state)).toBe(first);
        expect(first).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 200 },
    );
  });

  it("gives distinct hashes for distinct texts", () => {
    fc.assert(
      fc.property(text, text, (a, b) => {
        fc.pre(a !== b);
        expect(stateHash(a)).not.toBe(stateHash(b));
      }),
      { numRuns: 200 },
    );
  });
});
