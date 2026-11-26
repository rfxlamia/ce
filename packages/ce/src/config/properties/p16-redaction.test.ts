import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ConfigDefaults } from "../defaults.js";
import type { ConfigMeta } from "../load.js";
import { REDACTED, buildRedactedConfig } from "../redact.js";
import type { EffectiveConfig } from "../schema.js";

// Feature: ce-config-loader, Property 16: Redaction removes every Secret and is idempotent
// **Validates: Requirements 7.6, 7.8, 7.9**

const meta: ConfigMeta = {
  fileRead: null,
  fileIgnored: null,
  ignoredEnvNames: [],
  sources: {},
};

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
const body = fc
  .array(fc.constantFrom(...ALNUM), { minLength: 8, maxLength: 20 })
  .map((chars) => chars.join(""));
// The "sk-" prefix keeps a Secret from overlapping the "[REDACTED]" marker.
const secretArb = body.map((b) => `sk-${b}`);
const filler = fc.constantFrom("", " ", "x ", "/a/", "--", "path/");

function withSecret(secret: string, pre: string, post: string): string {
  return `${pre}${secret}${post}`;
}

describe("Property 16: redaction removes every Secret and is idempotent", () => {
  it("removes env credential values and is idempotent", () => {
    fc.assert(
      fc.property(
        secretArb,
        secretArb,
        secretArb,
        filler,
        filler,
        fc.constantFrom("openrouter", "typesafe"),
        (orKey, tsKey, stripeKey, pre, post, provider) => {
          const keys = [orKey, tsKey, stripeKey];
          fc.pre(keys.every((a) => keys.every((b) => a === b || !a.includes(b))));
          const config: EffectiveConfig = {
            ...ConfigDefaults,
            jev: { provider, model: withSecret(orKey, pre, post) },
            context: {
              include: [withSecret(tsKey, pre, post), `${orKey}${tsKey}`, withSecret(stripeKey, pre, post)],
            },
          };
          const env = {
            OPENROUTER_API_KEY: ` ${orKey} `,
            TYPESAFE_API_KEY: tsKey,
            STRIPE_API_KEY: stripeKey,
          };

          const first = buildRedactedConfig(config, meta, env);
          const json = JSON.stringify(first);
          expect(json).not.toContain(orKey);
          expect(json).not.toContain(tsKey);
          expect(json).not.toContain(stripeKey);

          const second = buildRedactedConfig(first.config, first.meta, env);
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("removes values matched by context.redact patterns and is idempotent", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(secretArb, { minLength: 1, maxLength: 3 }),
        filler,
        filler,
        (secrets, pre, post) => {
          fc.pre(secrets.every((a) => secrets.every((b) => a === b || !a.includes(b))));
          const config: EffectiveConfig = {
            ...ConfigDefaults,
            context: {
              include: secrets.map((s) => withSecret(s, pre, post)),
              redact: ["sk-[a-z0-9]{8,}"],
            },
            jev: { provider: "openrouter", model: withSecret(secrets[0]!, pre, post) },
          };
          const env = {};

          const first = buildRedactedConfig(config, meta, env);
          const json = JSON.stringify(first);
          for (const secret of secrets) expect(json).not.toContain(secret);
          expect(json).toContain(REDACTED);

          const second = buildRedactedConfig(first.config, first.meta, env);
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("holds when secret values overlap the marker (REDACTED, RED)", () => {
    // "RED" occurs inside "[REDACTED]", so check absence outside markers.
    const stripMarkers = (text: string) => text.split(REDACTED).join("");
    fc.assert(
      fc.property(filler, filler, fc.boolean(), (pre, post, redAsOpenRouter) => {
        const config: EffectiveConfig = {
          ...ConfigDefaults,
          jev: { provider: "openrouter", model: `${pre}REDACTED${post}` },
          context: { include: [`${pre}RED${post}`, "REDACTED", "RED", "[REDACTED]"] },
        };
        const env = redAsOpenRouter
          ? { OPENROUTER_API_KEY: "RED", STRIPE_API_KEY: "REDACTED" }
          : { TYPESAFE_API_KEY: "RED", STRIPE_API_KEY: "REDACTED" };

        const first = buildRedactedConfig(config, meta, env);
        const remaining = stripMarkers(JSON.stringify(first.config));
        expect(remaining).not.toContain("RED");

        const second = buildRedactedConfig(first.config, first.meta, env);
        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });
});
