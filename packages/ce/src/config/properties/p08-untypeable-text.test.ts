import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envNameForPath } from "../env.js";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 8: Untypeable environment or flag text is always rejected with the offending text preserved
// **Validates: Requirements 5.10**

let cwd: string;
beforeAll(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ce-p08-"));
});
afterAll(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

const NUMERIC_KEYS = [
  "assessment.thresholds.claim",
  "assessment.thresholds.observable",
  "assessment.thresholds.adequate",
  "assessment.uncertainty-band",
  "runtime.max-steps",
  "runtime.viewport.width",
  "runtime.viewport.height",
];
const DURATION_KEYS = ["runtime.timeout", "target.ready.timeout"];
const ENUM_KEYS: Array<[string, string[]]> = [
  ["assessment.on-uncertain", ["evidence", "skip"]],
  ["jev.provider", ["openrouter", "typesafe"]],
];

/** Text that is not a finite number even after trimming (env coercion trims). */
const nonNumeric = fc
  .string({ maxLength: 20 })
  .filter((s) => s.trim() !== "" && !Number.isFinite(Number(s.trim())))
  .map((s) => s);
const nonNumericOrBlank = fc.oneof(nonNumeric, fc.constantFrom("", " ", "NaN", "Infinity", "-Infinity", "abc"));

const invalidDuration = fc
  .string({ maxLength: 20 })
  .filter((s) => !/^[1-9]\d*(ms|s|m)$/.test(s));

interface Case {
  keyPath: string;
  text: string;
}

const untypeable: fc.Arbitrary<Case> = fc.oneof(
  fc.tuple(fc.constantFrom(...NUMERIC_KEYS), nonNumericOrBlank),
  fc.tuple(fc.constantFrom(...DURATION_KEYS), invalidDuration),
  ...ENUM_KEYS.map(([keyPath, valid]) =>
    fc
      .string({ maxLength: 20 })
      .filter((s) => !valid.includes(s))
      .map((s) => [keyPath, s] as [string, string]),
  ),
).map(([keyPath, text]) => ({ keyPath, text }));

function expectRejected(result: ReturnType<typeof loadConfig>, keyPath: string, text: string, source: "env" | "flag") {
  expect(result.ok).toBe(false);
  if (result.ok || !("errors" in result)) throw new Error(`expected errors for ${keyPath}=${JSON.stringify(text)}`);
  const match = result.errors.find((e) => e.path === keyPath);
  expect(match, `no error at ${keyPath} for ${JSON.stringify(text)}`).toBeDefined();
  expect(match!.value).toBe(text);
  expect(match!.source).toBe(source);
}

describe("Property 8: untypeable env or flag text is rejected with the text preserved", () => {
  it("rejects untypeable text supplied through an environment variable", () => {
    fc.assert(
      fc.property(untypeable, ({ keyPath, text }) => {
        const result = loadConfig({ cwd, flags: {}, env: { [envNameForPath(keyPath)]: text } });
        expectRejected(result, keyPath, text, "env");
      }),
      { numRuns: 100 },
    );
  });

  it("rejects untypeable text supplied through a flag", () => {
    fc.assert(
      fc.property(untypeable, ({ keyPath, text }) => {
        const result = loadConfig({ cwd, flags: { [keyPath]: text }, env: {} });
        expectRejected(result, keyPath, text, "flag");
      }),
      { numRuns: 100 },
    );
  });
});
