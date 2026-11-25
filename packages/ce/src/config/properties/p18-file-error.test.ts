import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reportConfigFailure } from "../errors.js";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 18: Invalid YAML syntax is always a file error, never a Validation_Error
// **Validates: Requirements 4.6, 6.9, 6.19, 6.20, 9.16**

const keyName = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
const fileName = fc.constantFrom("ce.yml", ".ce.yml");

const badYaml = fc.tuple(keyName, fc.constantFrom("flow", "indent", "duplicate", "tab")).map(([key, kind]) => {
  switch (kind) {
    case "flow":
      return `${key}: [1, 2\n`;
    case "indent":
      return `${key}:\n  a: 1\n b: 2\n`;
    case "duplicate":
      return `${key}: 1\n${key}: 2\n`;
    default:
      return `${key}:\n\ta: 1\n`;
  }
});

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ce-p18-"));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function freshDir(): string {
  return fs.mkdtempSync(path.join(root, "run-"));
}

function report(failure: Parameters<typeof reportConfigFailure>[0]): { text: string; code: number } {
  let text = "";
  const code = reportConfigFailure(failure, [], { write: (t) => ((text += t), true) });
  return { text, code };
}

function assertFileError(dir: string, name: string, kind: "read" | "parse"): void {
  const result = loadConfig({ cwd: dir, flags: {}, env: {} });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect("errors" in result).toBe(false);
  expect("config" in result).toBe(false);
  if (!("fileError" in result)) throw new Error("expected fileError");
  const fe = result.fileError;
  expect(fe.kind).toBe(kind);
  expect(fe.file).toContain(name);
  expect(fe.code.length).toBeGreaterThan(0);
  expect(fe.message.length).toBeGreaterThan(0);

  const { text, code } = report(result);
  expect(code).toBe(1);
  expect(text).toContain(name);
  expect(text).toContain(fe.code);
  expect(text).not.toMatch(/^\s*(path|value|expected):/m);
}

describe("Property 18: invalid YAML and unreadable files are file errors", () => {
  it("invalid YAML syntax yields a parse fileError", () => {
    fc.assert(
      fc.property(badYaml, fileName, (content, name) => {
        const dir = freshDir();
        fs.writeFileSync(path.join(dir, name), content);
        assertFileError(dir, name, "parse");
      }),
      { numRuns: 100 },
    );
  });

  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(isRoot || process.platform === "win32")("an unreadable file yields a read fileError", () => {
    fc.assert(
      fc.property(keyName, fileName, (key, name) => {
        const dir = freshDir();
        const file = path.join(dir, name);
        fs.writeFileSync(file, `version: 0\n${key}: 1\n`);
        fs.chmodSync(file, 0o000);
        try {
          assertFileError(dir, name, "read");
        } finally {
          fs.chmodSync(file, 0o600);
        }
      }),
      { numRuns: 100 },
    );
  });
});
