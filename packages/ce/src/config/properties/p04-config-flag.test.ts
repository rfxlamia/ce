import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 4: Non-existent or blank `--config` paths are always rejected the same way
// **Validates: Requirements 4.14, 4.15**

let cwd: string;

beforeAll(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ce-p04-"));
  // An existing, valid ce.yml that must never be used as a fallback.
  fs.writeFileSync(path.join(cwd, "ce.yml"), "version: 0\n");
});

afterAll(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

const segment = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,11}$/);

// Relative or absolute paths that cannot exist: the first segment is a name
// that is never created, so no prefix of the path exists.
const missingPath = fc
  .tuple(fc.boolean(), segment, fc.array(segment, { maxLength: 3 }))
  .map(([absolute, head, rest]) => {
    const parts = [`missing-${head}`, ...rest];
    return absolute ? path.join(cwd, ...parts) : parts.join("/");
  });

const WHITESPACE = [" ", "\t", "\n", "\r", "\v", "\f", "\u00a0", "\u2003", "\ufeff"];
const blank = fc.array(fc.constantFrom(...WHITESPACE), { maxLength: 12 }).map((a) => a.join(""));

function expectSingleFlagError(result: ReturnType<typeof loadConfig>) {
  expect(result.ok).toBe(false);
  if (result.ok || !("errors" in result)) throw new Error("expected errors result");
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]!.path).toBe("config");
  expect(result.errors[0]!.source).toBe("flag");
  return result.errors[0]!;
}

describe("Property 4: --config rejection", () => {
  it("rejects non-existent paths with path 'config', source 'flag' and the path in the message", () => {
    fc.assert(
      fc.property(missingPath, (given) => {
        const result = loadConfig({ cwd, flags: { config: given }, env: {} });
        const error = expectSingleFlagError(result);
        expect(error.value).toBe(given);
        expect(error.expected).toContain(given);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects blank or whitespace-only paths as non-empty violations", () => {
    fc.assert(
      fc.property(blank, (given) => {
        const result = loadConfig({ cwd, flags: { config: given }, env: {} });
        const error = expectSingleFlagError(result);
        expect(error.value).toBe(given);
        expect(error.expected).toContain("non-empty");
      }),
      { numRuns: 100 },
    );
  });

  it("never falls back to the existing ce.yml", () => {
    fc.assert(
      fc.property(fc.oneof(missingPath, blank), (given) => {
        const result = loadConfig({ cwd, flags: { config: given }, env: {} });
        expect(result.ok).toBe(false);
        expect("fileError" in result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
