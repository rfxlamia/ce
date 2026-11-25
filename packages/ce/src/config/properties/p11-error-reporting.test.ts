import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 11: Every violation is reported, sorted, and never thrown
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.8, 6.17**

interface Violation {
  /** Key of the violation; also the dotted path the error must report. */
  path: string;
  /** Where to put `value` in the config object (dotted, the last segment may be a list index). */
  at: string;
  /** The value placed at `at`. */
  value: unknown;
}

/**
 * Independent violation sites. Each entry yields one error at `path` and no
 * two entries share or nest a path, so any subset has one error per entry.
 */
const SITES: ReadonlyArray<{ path: string; at: string; bad: fc.Arbitrary<unknown> }> = [
  { path: "version", at: "version", bad: fc.constantFrom(1, 2, "0", "x") },
  { path: "target.url", at: "target.url", bad: fc.constantFrom("ftp://example.com", "not a url", "localhost:3000", 5) },
  { path: "target.start", at: "target.start", bad: fc.constantFrom(5, true, ["npm"]) },
  { path: "target.ready.timeout", at: "target.ready.timeout", bad: fc.constantFrom("90", "0s", "1h", "-5s", 30) },
  { path: "target.routes", at: "target.routes", bad: fc.constantFrom("/a", 7, { a: 1 }) },
  { path: "context.redact.0", at: "context.redact", bad: fc.constantFrom(["(unclosed"], ["(?i)secret"], ["["]) },
  { path: "assessment.thresholds.claim", at: "assessment.thresholds.claim", bad: fc.constantFrom(1.5, -0.1, "high", 2) },
  { path: "assessment.thresholds.observable", at: "assessment.thresholds.observable", bad: fc.constantFrom(1.01, -1, "x") },
  { path: "assessment.uncertainty-band", at: "assessment.uncertainty-band", bad: fc.constantFrom(2, -0.5, "wide") },
  { path: "assessment.on-uncertain", at: "assessment.on-uncertain", bad: fc.constantFrom("maybe", "", 3) },
  { path: "runtime.max-steps", at: "runtime.max-steps", bad: fc.constantFrom(0, -3, 1.5, "12") },
  { path: "runtime.timeout", at: "runtime.timeout", bad: fc.constantFrom("90", "0m", "2h", 10) },
  { path: "runtime.viewport.width", at: "runtime.viewport.width", bad: fc.constantFrom(0, -1, 100.5, "wide") },
  { path: "runtime.viewport.height", at: "runtime.viewport.height", bad: fc.constantFrom(0, -1, 7.5, "tall") },
  { path: "runtime.fixtures.name", at: "runtime.fixtures", bad: fc.constantFrom({ name: 1 }, { name: ["a"] }) },
  { path: "jev.provider", at: "jev.provider", bad: fc.constantFrom("other", "OpenRouter", 1) },
  { path: "jev.model", at: "jev.model", bad: fc.constantFrom(5, false) },
  { path: "output.dir", at: "output.dir", bad: fc.constantFrom(5, ["x"]) },
  { path: "output.fail-on.0", at: "output.fail-on", bad: fc.constantFrom(["bogus"], ["Error"]) },
  { path: "bogus-key", at: "bogus-key", bad: fc.constantFrom(1, "x") },
  { path: "context.nope", at: "context.nope", bad: fc.constantFrom(1, "x") },
  { path: "runtime.viewport.depth", at: "runtime.viewport.depth", bad: fc.constantFrom(1, "x") },
];

const violationsArb: fc.Arbitrary<Violation[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: SITES.length - 1 }), { minLength: 1, maxLength: 8 })
  .chain((indexes) =>
    fc.tuple(...indexes.map((i) => SITES[i]!.bad)).map((values) =>
      indexes.map((i, n) => ({ path: SITES[i]!.path, at: SITES[i]!.at, value: values[n] })),
    ),
  );

function setAt(obj: Record<string, unknown>, at: string, value: unknown): void {
  const keys = at.split(".");
  let cursor = obj;
  for (const key of keys.slice(0, -1)) {
    cursor = (cursor[key] ??= {}) as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
}

const dir = mkdtempSync(join(tmpdir(), "ce-p11-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Property 11: every violation is reported, sorted, and never thrown", () => {
  it("reports one error per distinct violation, sorted by path, without config", () => {
    fc.assert(
      fc.property(violationsArb, (violations) => {
        const config: Record<string, unknown> = {};
        for (const v of violations) setAt(config, v.at, v.value);
        // JSON is valid YAML, so the file is syntactically valid.
        writeFileSync(join(dir, "ce.yml"), JSON.stringify(config));

        let result: ReturnType<typeof loadConfig> | undefined;
        expect(() => {
          result = loadConfig({ cwd: dir, flags: {}, env: {} });
        }).not.toThrow();

        expect(result).toBeDefined();
        expect(result!.ok).toBe(false);
        expect("config" in result!).toBe(false);
        expect("errors" in result!).toBe(true);
        if (result!.ok || !("errors" in result!)) return;

        const errors = result.errors;
        const paths = errors.map((e) => e.path);

        // At least one error per distinct violation.
        for (const v of violations) expect(paths).toContain(v.path);
        expect(errors.length).toBeGreaterThanOrEqual(violations.length);

        // Every error is fully described.
        for (const e of errors) {
          expect(e.path.length).toBeGreaterThan(0);
          expect(e.value).not.toBeUndefined();
          expect(typeof e.expected).toBe("string");
          expect(e.expected.length).toBeGreaterThan(0);
        }

        // Sorted in non-decreasing path order.
        for (let i = 1; i < paths.length; i++) {
          expect(paths[i - 1]! <= paths[i]!).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
