import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 14: output.fail-on is irrelevant to a failed configuration's outcome signal
// **Validates: Requirements 6.18, 6.19, 6.20**

const root = mkdtempSync(join(tmpdir(), "ce-p14-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
function freshDir(): string {
  const dir = join(root, `d${counter++}`);
  mkdirSync(dir);
  return dir;
}

const failOnValue = fc.uniqueArray(fc.constantFrom("error", "unsupported", "evidenced-not-reached"), {
  maxLength: 3,
});
const nonEmptyFailOn = fc.uniqueArray(fc.constantFrom("error", "unsupported", "evidenced-not-reached"), {
  minLength: 1,
  maxLength: 3,
});

// Each entry is an invalid value for a key that is not output.fail-on.
const invalidSetting = fc.constantFrom<[string, string, unknown]>(
  ["runtime.max-steps", "CE_RUNTIME_MAX_STEPS", -1],
  ["runtime.max-steps", "CE_RUNTIME_MAX_STEPS", "abc"],
  ["jev.provider", "CE_JEV_PROVIDER", "nope"],
  ["assessment.uncertainty-band", "CE_ASSESSMENT_UNCERTAINTY_BAND", 7],
);

function nested(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  let out: unknown = value;
  for (const key of [...keys].reverse()) out = { [key]: out };
  return out as Record<string, unknown>;
}

describe("Property 14: output.fail-on never changes whether a failed configuration fails", () => {
  it("invalid config gives ok: false with errors for any fail-on from flag, env or file", () => {
    fc.assert(
      fc.property(
        invalidSetting,
        fc.constantFrom("flag", "env", "file"),
        fc.constantFrom("flag", "env", "file"),
        failOnValue,
        nonEmptyFailOn,
        (setting, badSource, failOnSource, failOn, failOnNonEmpty) => {
          const [path, envName, bad] = setting;
          const cwd = freshDir();
          const flags: Record<string, unknown> = {};
          const env: Record<string, string | undefined> = {};
          const file: Record<string, unknown> = {};

          if (badSource === "flag") flags[path] = bad;
          else if (badSource === "env") env[envName] = String(bad);
          else Object.assign(file, nested(path, bad));

          if (failOnSource === "flag") flags["output.fail-on"] = failOn;
          else if (failOnSource === "env") env["CE_OUTPUT_FAIL_ON"] = failOnNonEmpty.join(",");
          else Object.assign(file, { output: { "fail-on": failOn } });

          if (Object.keys(file).length > 0) {
            // JSON is valid YAML 1.2.
            writeFileSync(join(cwd, "ce.yml"), JSON.stringify(file));
          }

          const result = loadConfig({ cwd, flags, env });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect("errors" in result).toBe(true);
            if ("errors" in result) expect(result.errors.length).toBeGreaterThanOrEqual(1);
            expect("fileError" in result).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("invalid YAML or unreadable file gives ok: false with fileError for any fail-on in flags or env", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("invalid-yaml", "unreadable"),
        fc.constantFrom("flag", "env", "both", "none"),
        failOnValue,
        nonEmptyFailOn,
        (fileKind, failOnSource, failOn, failOnNonEmpty) => {
          const cwd = freshDir();
          if (fileKind === "invalid-yaml") {
            writeFileSync(join(cwd, "ce.yml"), "a: [unclosed\n  b: : :\n");
          } else {
            // A file without read permission fails with EACCES.
            writeFileSync(join(cwd, "ce.yml"), "version: 0\n");
            chmodSync(join(cwd, "ce.yml"), 0o000);
          }

          const flags: Record<string, unknown> = {};
          const env: Record<string, string | undefined> = {};
          if (failOnSource === "flag" || failOnSource === "both") flags["output.fail-on"] = failOn;
          if (failOnSource === "env" || failOnSource === "both") {
            env["CE_OUTPUT_FAIL_ON"] = failOnNonEmpty.join(",");
          }

          const result = loadConfig({ cwd, flags, env });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect("fileError" in result).toBe(true);
            expect("errors" in result).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
