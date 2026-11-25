import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { requireJevCredentials } from "../credentials.js";
import type { LoadedConfig } from "../load.js";

// Feature: ce-config-loader, Property 15: Credential_Check outcome depends only on provider and key presence, and never leaks the key value
// **Validates: Requirements 6.12, 6.13, 6.14**

type Provider = "openrouter" | "typesafe";
type Source = "flag" | "env" | "file" | "default";

const KEY_NAME: Record<Provider, string> = {
  openrouter: "OPENROUTER_API_KEY",
  typesafe: "TYPESAFE_API_KEY",
};

const providerArb = fc.constantFrom<Provider>("openrouter", "typesafe");
const sourceArb = fc.constantFrom<Source>("flag", "env", "file", "default");

// Unique, recognisable key values so a substring search cannot match by accident.
const keyValueArb = fc
  .stringMatching(/^[0-9a-f]{16,40}$/)
  .map((hex) => `sk-zzkey-${hex}`);

// A key that counts as "not set": absent, empty, or whitespace only.
const missingArb = fc.constantFrom<string | undefined>(undefined, "", " ", "   ", "\t", "\n ");

// Arbitrary unrelated settings that must not influence the outcome.
const extraConfigArb = fc.record(
  {
    runtime: fc.record({ "max-steps": fc.integer({ min: 1, max: 100 }) }, { requiredKeys: [] }),
    output: fc.record({ "fail-on": fc.constantFrom(["error"], ["unsupported"], []) }, { requiredKeys: [] }),
  },
  { requiredKeys: [] },
);

const unrelatedEnvArb = fc.dictionary(
  fc.stringMatching(/^(CE|FOO|PATH|HOME)_[A-Z]{1,8}$/),
  fc.string({ maxLength: 12 }),
  { maxKeys: 4 },
);

function makeLoaded(provider: Provider, source: Source, extra: Record<string, unknown>): LoadedConfig {
  const config = { ...extra, jev: { provider } };
  return {
    ok: true,
    config,
    meta: {
      fileRead: undefined,
      fileIgnored: undefined,
      ignoredEnvNames: [],
      sources: { "jev.provider": source },
    },
    redacted: { config, meta: {} },
  } as unknown as LoadedConfig;
}

describe("Property 15: Credential_Check outcome depends only on provider and key presence", () => {
  it("succeeds iff the selected provider's key is non-empty, regardless of the other key or unrelated env", () => {
    fc.assert(
      fc.property(
        providerArb,
        sourceArb,
        extraConfigArb,
        unrelatedEnvArb,
        fc.oneof(keyValueArb, missingArb),
        fc.oneof(keyValueArb, missingArb),
        (provider, source, extra, unrelated, selectedKey, otherKey) => {
          const other: Provider = provider === "openrouter" ? "typesafe" : "openrouter";
          const env: Record<string, string | undefined> = { ...unrelated };
          env[KEY_NAME[provider]] = selectedKey;
          env[KEY_NAME[other]] = otherKey;

          const result = requireJevCredentials(makeLoaded(provider, source, extra), env);
          const present = (selectedKey ?? "").trim() !== "";
          expect(result.ok).toBe(present);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("on failure returns one error with path, provider value, recorded source and the variable name", () => {
    fc.assert(
      fc.property(
        providerArb,
        sourceArb,
        missingArb,
        fc.oneof(keyValueArb, missingArb),
        (provider, source, selectedKey, otherKey) => {
          const other: Provider = provider === "openrouter" ? "typesafe" : "openrouter";
          const env: Record<string, string | undefined> = {
            [KEY_NAME[provider]]: selectedKey,
            [KEY_NAME[other]]: otherKey,
          };
          const result = requireJevCredentials(makeLoaded(provider, source, {}), env);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.errors).toHaveLength(1);
          const [error] = result.errors;
          expect(error.path).toBe("jev.provider");
          expect(error.value).toBe(provider);
          expect(error.source).toBe(source);
          expect(error.expected).toContain(KEY_NAME[provider]);
          expect(error.expected).not.toContain(KEY_NAME[other]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never includes any API key value in the result", () => {
    fc.assert(
      fc.property(
        providerArb,
        sourceArb,
        fc.boolean(),
        keyValueArb,
        keyValueArb,
        (provider, source, selectedMissing, selectedValue, otherValue) => {
          fc.pre(selectedValue !== otherValue);
          const other: Provider = provider === "openrouter" ? "typesafe" : "openrouter";
          const env: Record<string, string | undefined> = {
            [KEY_NAME[provider]]: selectedMissing ? "" : selectedValue,
            [KEY_NAME[other]]: otherValue,
          };
          const result = requireJevCredentials(makeLoaded(provider, source, {}), env);
          const text = JSON.stringify(result);
          expect(text).not.toContain(selectedValue);
          expect(text).not.toContain(otherValue);
        },
      ),
      { numRuns: 100 },
    );
  });
});
