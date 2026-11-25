import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 10: `runtime.fixtures` is never accepted from flags
// **Validates: Requirements 5.15, 5.17**

let emptyCwd: string;
let fixturesCwd: string;

beforeAll(() => {
  emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ce-p10a-"));
  // A Config_File that legitimately sets runtime.fixtures must not change the outcome.
  fixturesCwd = fs.mkdtempSync(path.join(os.tmpdir(), "ce-p10b-"));
  fs.writeFileSync(
    path.join(fixturesCwd, "ce.yml"),
    "version: 0\nruntime:\n  fixtures:\n    a: b\n",
  );
});

afterAll(() => {
  fs.rmSync(emptyCwd, { recursive: true, force: true });
  fs.rmSync(fixturesCwd, { recursive: true, force: true });
});

const fixturesValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.jsonValue(),
  fc.constant(null),
  fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/), fc.string(), { maxKeys: 4 }),
);

const subKey = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);

type Spelling = "dotted" | "dotted-sub" | "nested";

const flagsArb = fc
  .tuple(
    fc.constantFrom<Spelling>("dotted", "dotted-sub", "nested"),
    fixturesValue,
    subKey,
    // Unrelated valid flags that may sit beside the fixtures flag.
    fc.record({ "runtime.max-steps": fc.integer({ min: 1, max: 50 }) }, { requiredKeys: [] }),
  )
  .map(([spelling, value, sub, extra]) => {
    const flags: Record<string, unknown> = { ...extra };
    if (spelling === "dotted") flags["runtime.fixtures"] = value;
    else if (spelling === "dotted-sub") flags[`runtime.fixtures.${sub}`] = value;
    else flags.runtime = { fixtures: value };
    return { flags, value };
  });

describe("Property 10: runtime.fixtures is never accepted from flags", () => {
  for (const [label, getCwd] of [
    ["no Config_File", () => emptyCwd],
    ["Config_File that sets runtime.fixtures", () => fixturesCwd],
  ] as const) {
    it(`rejects every spelling with path/source/expected (${label})`, () => {
      fc.assert(
        fc.property(flagsArb, ({ flags, value }) => {
          const result = loadConfig({ cwd: getCwd(), flags, env: {} });
          expect(result.ok).toBe(false);
          if (result.ok || !("errors" in result)) throw new Error("expected errors result");
          expect(result.errors).toHaveLength(1);
          const error = result.errors[0]!;
          expect(error.path).toBe("runtime.fixtures");
          expect(error.source).toBe("flag");
          expect(error.expected).toMatch(/\.?ce\.yml/);
          expect(Object.is(error.value, value)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  }
});
