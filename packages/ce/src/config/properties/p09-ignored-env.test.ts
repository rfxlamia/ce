import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigDefaults } from "../defaults.js";
import { ENV_KEY_MAP } from "../env.js";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 9: Unknown and fixtures-prefixed CE_ variables are always ignored and recorded, never applied
// **Validates: Requirements 5.11, 5.16**

const upperChars = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"];

const unknownName = fc
  .array(fc.constantFrom(...upperChars), { minLength: 1, maxLength: 20 })
  .map((chars) => `CE_${chars.join("")}`)
  .filter((name) => !ENV_KEY_MAP.has(name));

const fixturesName = fc
  .array(fc.constantFrom(...upperChars), { minLength: 0, maxLength: 12 })
  .map((chars) => `CE_RUNTIME_FIXTURES${chars.join("")}`);

const ignoredName = fc.oneof(unknownName, fixturesName);

const envText = fc.string({ maxLength: 30 });

describe("Property 9: ignored CE_ variables", () => {
  let cwd: string;

  beforeAll(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ce-p09-"));
  });

  afterAll(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("never applies unknown or fixtures-prefixed CE_ variables and records their names", () => {
    fc.assert(
      fc.property(
        fc.dictionary(ignoredName, envText, { minKeys: 1, maxKeys: 6 }),
        (env) => {
          const result = loadConfig({ cwd, flags: {}, env });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.config).toEqual(ConfigDefaults);
          for (const name of Object.keys(env)) {
            expect(result.meta.ignoredEnvNames).toContain(name);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
