import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envNameForPath } from "../env.js";
import { loadConfig } from "../load.js";

// Feature: ce-config-loader, Property 7: Environment variable mapping and type coercion round-trip
// **Validates: Requirements 5.7, 5.8, 5.9**

let cwd: string;
beforeAll(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ce-p07-"));
});
afterAll(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function read(obj: unknown, keyPath: string): unknown {
  let cursor: unknown = obj;
  for (const key of keyPath.split(".")) {
    cursor = (cursor as Record<string, unknown> | undefined)?.[key];
  }
  return cursor;
}

function load(keyPath: string, text: string) {
  const result = loadConfig({ cwd, flags: {}, env: { [envNameForPath(keyPath)]: text } });
  if (!result.ok) {
    throw new Error(`loadConfig failed for ${keyPath}=${JSON.stringify(text)}: ${JSON.stringify(result)}`);
  }
  return result.config;
}

/** Whitespace padding that `trim()` removes. */
const pad = fc.stringMatching(/^[ \t]{0,3}$/);

interface Case {
  keyPath: string;
  value: unknown;
  text: string;
}

const probability = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });
const positiveInt = fc.integer({ min: 1, max: 100_000 });

const numericCase: fc.Arbitrary<Case> = fc.oneof(
  ...[
    "assessment.thresholds.claim",
    "assessment.thresholds.observable",
    "assessment.thresholds.adequate",
    "assessment.uncertainty-band",
  ].map((keyPath) =>
    probability.map((value) => ({ keyPath, value, text: String(value) })),
  ),
  ...["runtime.max-steps", "runtime.viewport.width", "runtime.viewport.height"].map((keyPath) =>
    positiveInt.map((value) => ({ keyPath, value, text: String(value) })),
  ),
);

const durationCase: fc.Arbitrary<Case> = fc
  .tuple(
    fc.constantFrom("runtime.timeout", "target.ready.timeout"),
    fc.integer({ min: 1, max: 100_000 }),
    fc.constantFrom("ms", "s", "m"),
  )
  .map(([keyPath, n, unit]) => ({ keyPath, value: `${n}${unit}`, text: `${n}${unit}` }));

const enumCase: fc.Arbitrary<Case> = fc.oneof(
  fc
    .constantFrom("evidence", "skip")
    .map((value) => ({ keyPath: "assessment.on-uncertain", value, text: value })),
  fc
    .constantFrom("openrouter", "typesafe")
    .map((value) => ({ keyPath: "jev.provider", value, text: value })),
);

/** Non-empty items with no comma and no leading or trailing whitespace. */
const plainItem = fc.stringMatching(/^[A-Za-z0-9_./*-]{1,12}$/);

function listCase(keyPath: string, item: fc.Arbitrary<string>): fc.Arbitrary<Case> {
  return fc
    .array(fc.tuple(pad, item, pad), { minLength: 1, maxLength: 6 })
    .map((parts) => ({
      keyPath,
      value: parts.map(([, v]) => v),
      text: parts.map(([l, v, r]) => `${l}${v}${r}`).join(","),
    }));
}

const listCaseArb: fc.Arbitrary<Case> = fc.oneof(
  listCase("target.routes", plainItem),
  listCase("context.include", plainItem),
  listCase("context.exclude", plainItem),
  listCase("context.redact", fc.stringMatching(/^[A-Za-z0-9_]{1,12}$/)),
  listCase(
    "output.fail-on",
    fc.constantFrom("error", "unsupported", "evidenced-not-reached"),
  ),
);

describe("Property 7: env mapping and type coercion round-trip", () => {
  it("numeric keys round-trip through CE_* text", () => {
    fc.assert(
      fc.property(numericCase, ({ keyPath, value, text }) => {
        expect(read(load(keyPath, text), keyPath)).toBe(value);
      }),
      { numRuns: 100 },
    );
  });

  it("duration keys round-trip as the same string", () => {
    fc.assert(
      fc.property(durationCase, ({ keyPath, value, text }) => {
        expect(read(load(keyPath, text), keyPath)).toBe(value);
      }),
      { numRuns: 100 },
    );
  });

  it("enum keys round-trip", () => {
    fc.assert(
      fc.property(enumCase, ({ keyPath, value, text }) => {
        expect(read(load(keyPath, text), keyPath)).toBe(value);
      }),
      { numRuns: 100 },
    );
  });

  it("list keys round-trip through comma join with whitespace trimming", () => {
    fc.assert(
      fc.property(listCaseArb, ({ keyPath, value, text }) => {
        expect(read(load(keyPath, text), keyPath)).toEqual(value);
      }),
      { numRuns: 100 },
    );
  });
});
