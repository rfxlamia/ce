import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compileRedactPattern,
  InlineFlagError,
  RegexCompileError,
} from "../redact-pattern.js";

type Outcome = "compiled" | "inline" | "regex";

function classify(item: string): Outcome {
  try {
    const re = compileRedactPattern(item);
    expect(re).toBeInstanceOf(RegExp);
    return "compiled";
  } catch (error) {
    if (error instanceof InlineFlagError) return "inline";
    if (error instanceof RegexCompileError) return "regex";
    throw error;
  }
}

const canonicalFlags = fc
  .subarray(["d", "g", "i", "m", "s", "u", "y"])
  .map((flags) => flags.join(""));

const anyItem = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc.string().map((s) => `(?i)${s}`),
  fc.string().map((s) => `/${s}/`),
  fc.tuple(fc.string(), fc.stringMatching(/^[a-z]{0,4}$/)).map(([p, f]) => `/${p}/${f}`),
);

describe("Property 2: Redact-pattern compilation is total and classified", () => {
  // Feature: ce-config-loader, Property 2: Redact-pattern compilation is total and classified
  it("yields exactly one of compiles, InlineFlagError, RegexCompileError for any string", () => {
    fc.assert(
      fc.property(anyItem, (item) => {
        const outcome = classify(item);
        if (outcome === "inline") {
          expect(() => compileRedactPattern(item)).toThrow(/\/pattern\/i/);
        }
        if (outcome === "regex") {
          expect(() => compileRedactPattern(item)).toThrow(
            "JavaScript RegExp source or the form /pattern/flags",
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: ce-config-loader, Property 2: Redact-pattern compilation is total and classified
  it("rejects a leading inline-flag group with InlineFlagError", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,3}$/),
        fc.stringMatching(/^[a-z0-9 ]{0,10}$/),
        (group, rest) => {
          expect(classify(`(?${group})${rest}`)).toBe("inline");
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: ce-config-loader, Property 2: Redact-pattern compilation is total and classified
  it("keeps the captured flags for the delimited form and honours the i flag", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        canonicalFlags,
        (source, flags) => {
          const re = compileRedactPattern(`/${source}/${flags}`);
          expect(re.flags).toBe(flags);
          expect(re.source).toBe(source);
          if (flags.includes("i")) {
            const upper = source.toUpperCase();
            re.lastIndex = 0;
            expect(re.test(`${upper} yy`)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: ce-config-loader, Property 2: Redact-pattern compilation is total and classified
  it("compiles a plain source without flags", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (source) => {
        const re = compileRedactPattern(source);
        expect(re.flags).toBe("");
        expect(re.test(source)).toBe(true);
        expect(re.test(source.toUpperCase())).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
