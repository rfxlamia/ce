import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ConfigMeta } from "../load.js";
import { buildRedactedConfig } from "../redact.js";
import type { EffectiveConfig } from "../schema.js";

// Feature: ce-config-loader, Property 17: Redacted_Config round-trips through JSON
// **Validates: Requirements 7.7, 7.11**

const text = fc.string({ maxLength: 20 });
const fraction = fc.double({ min: 0, max: 1, noNaN: true }).map((n) => (Object.is(n, -0) ? 0 : n));

const configArb: fc.Arbitrary<EffectiveConfig> = fc.record(
  {
    version: fc.constant(0 as const),
    assessment: fc.record(
      {
        thresholds: fc.record({ claim: fraction, observable: fraction, adequate: fraction }),
        "uncertainty-band": fraction,
        "on-uncertain": fc.constantFrom("evidence", "skip"),
      },
      { requiredKeys: [] },
    ),
    runtime: fc.record(
      {
        "max-steps": fc.integer({ min: 1, max: 100 }),
        timeout: fc.constantFrom("30s", "90s", "2m"),
        viewport: fc.record({ width: fc.integer({ min: 1, max: 4000 }), height: fc.integer({ min: 1, max: 4000 }) }),
      },
      { requiredKeys: [] },
    ),
    jev: fc.record(
      { provider: fc.constantFrom("openrouter", "typesafe"), model: text },
      { requiredKeys: [] },
    ),
    output: fc.record(
      { dir: text, "fail-on": fc.array(fc.constantFrom("error", "unsupported"), { maxLength: 2 }) },
      { requiredKeys: [] },
    ),
  },
  { requiredKeys: [] },
) as unknown as fc.Arbitrary<EffectiveConfig>;

const metaArb: fc.Arbitrary<ConfigMeta> = fc.record({
  fileRead: fc.option(text, { nil: null }),
  fileIgnored: fc.option(text, { nil: null }),
  ignoredEnvNames: fc.array(text, { maxLength: 4 }),
  sources: fc.dictionary(
    fc.stringMatching(/^[a-z]{1,8}(\.[a-z-]{1,8}){0,2}$/),
    fc.constantFrom("flag", "env", "file", "default"),
    { maxKeys: 6 },
  ),
});

const envArb = fc.record(
  {
    OPENROUTER_API_KEY: fc.option(fc.stringMatching(/^sk-[0-9a-f]{8,24}$/), { nil: undefined }),
    TYPESAFE_API_KEY: fc.option(fc.stringMatching(/^sk-[0-9a-f]{8,24}$/), { nil: undefined }),
    STRIPE_API_KEY: fc.option(fc.stringMatching(/^sk-[0-9a-f]{8,24}$/), { nil: undefined }),
  },
  { requiredKeys: [] },
);

describe("Property 17: Redacted_Config round-trips through JSON", () => {
  it("JSON.parse(JSON.stringify(r)) deep-equals r", () => {
    fc.assert(
      fc.property(configArb, metaArb, envArb, (config, meta, env) => {
        const redacted = buildRedactedConfig(config, meta, env);
        const roundTripped = JSON.parse(JSON.stringify(redacted));
        expect(roundTripped).toStrictEqual(redacted);
      }),
      { numRuns: 100 },
    );
  });
});
