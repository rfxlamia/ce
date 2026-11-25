import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 13: Config_Loader never fails on a missing provider API key
// **Validates: Requirements 6.10**

const cwd = mkdtempSync(join(tmpdir(), "ce-p13-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

// Absent, empty, whitespace-only, or present.
const keyValue = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  fc.constant("   "),
  fc.stringMatching(/^[A-Za-z0-9_-]{8,24}$/),
);

const scenario = fc.record({
  provider: fc.option(fc.constantFrom("openrouter", "typesafe"), { nil: undefined }),
  providerVia: fc.constantFrom("flag", "env"),
  maxSteps: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
  openrouterKey: keyValue,
  typesafeKey: keyValue,
});

describe("Property 13: a missing provider API key never fails loadConfig", () => {
  it("returns ok: true for any valid config and any key presence", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const flags: Record<string, unknown> = {};
        const env: Record<string, string | undefined> = {};
        if (s.provider !== undefined) {
          if (s.providerVia === "flag") flags["jev.provider"] = s.provider;
          else env["CE_JEV_PROVIDER"] = s.provider;
        }
        if (s.maxSteps !== undefined) flags["runtime.max-steps"] = s.maxSteps;
        env["OPENROUTER_API_KEY"] = s.openrouterKey;
        env["TYPESAFE_API_KEY"] = s.typesafeKey;

        const result = loadConfig({ cwd, flags, env });
        expect(result.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
