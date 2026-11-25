import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ConfigDefaults } from "../defaults.js";
import { loadConfig } from "../load.js";
import { envNameForPath } from "../env.js";

// Feature: ce-config-loader, Property 5: Precedence and source attribution hold per leaf key
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.13, 5.14**

interface LeafSpec {
  path: string;
  value: fc.Arbitrary<unknown>;
}

const LEAVES: readonly LeafSpec[] = [
  { path: "runtime.max-steps", value: fc.integer({ min: 1, max: 500 }) },
  { path: "assessment.thresholds.claim", value: fc.integer({ min: 0, max: 1000 }).map((n) => n / 1000) },
  {
    path: "runtime.timeout",
    value: fc
      .tuple(fc.integer({ min: 1, max: 999 }), fc.constantFrom("ms", "s", "m"))
      .map(([n, unit]) => `${n}${unit}`),
  },
  { path: "jev.provider", value: fc.constantFrom("openrouter", "typesafe") },
  { path: "output.dir", value: fc.stringMatching(/^[a-z][a-z0-9._-]{0,11}$/) },
  { path: "assessment.on-uncertain", value: fc.constantFrom("evidence", "skip") },
];

type Layer = "flag" | "env" | "file";
const PRECEDENCE: readonly Layer[] = ["flag", "env", "file"];

function getPath(obj: unknown, path: string): unknown {
  let cursor = obj;
  for (const key of path.split(".")) cursor = (cursor as Record<string, unknown>)?.[key];
  return cursor;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cursor = obj;
  for (const key of keys.slice(0, -1)) {
    cursor = (cursor[key] ??= {}) as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
}

// For each leaf: an optional value per layer, plus how a flag is spelled.
const scenario = fc.tuple(
  ...LEAVES.map((leaf) =>
    fc.record({
      flag: fc.option(leaf.value, { nil: undefined }),
      env: fc.option(leaf.value, { nil: undefined }),
      file: fc.option(leaf.value, { nil: undefined }),
      dotted: fc.boolean(),
    }),
  ),
);

describe("Property 5: precedence and source attribution per leaf key", () => {
  it("each leaf equals its highest-precedence source's value and meta.sources names it", () => {
    fc.assert(
      fc.property(scenario, (entries) => {
        const flags: Record<string, unknown> = {};
        const env: Record<string, string> = {};
        const fileObj: Record<string, unknown> = {};

        LEAVES.forEach((leaf, i) => {
          const e = entries[i]!;
          if (e.flag !== undefined) {
            if (e.dotted) flags[leaf.path] = e.flag;
            else setPath(flags, leaf.path, e.flag);
          }
          if (e.env !== undefined) env[envNameForPath(leaf.path)] = String(e.env);
          if (e.file !== undefined) setPath(fileObj, leaf.path, e.file);
        });

        const cwd = mkdtempSync(join(tmpdir(), "ce-p05-"));
        try {
          if (Object.keys(fileObj).length > 0) {
            writeFileSync(join(cwd, "ce.yml"), JSON.stringify(fileObj), "utf8");
          }
          const result = loadConfig({ cwd, flags, env });
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          LEAVES.forEach((leaf, i) => {
            const e = entries[i]!;
            const winner = PRECEDENCE.find((layer) => e[layer] !== undefined);
            const expectedValue = winner ? e[winner] : getPath(ConfigDefaults, leaf.path);
            const expectedSource = winner ?? "default";
            expect(getPath(result.config, leaf.path)).toEqual(expectedValue);
            expect(result.meta.sources[leaf.path]).toBe(expectedSource);
          });
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
