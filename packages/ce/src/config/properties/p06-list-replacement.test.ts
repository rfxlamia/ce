import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mergeSources } from "../merge.js";

// Feature: ce-config-loader, Property 6: List-valued keys replace rather than concatenate
// **Validates: Requirements 5.6**

const LIST_KEYS = [
  "target.routes",
  "context.include",
  "context.exclude",
  "context.redact",
  "output.fail-on",
] as const;

type Level = "flags" | "envValues" | "fileValues" | "defaults";
// Highest precedence first.
const LEVELS: readonly Level[] = ["flags", "envValues", "fileValues", "defaults"];
const SOURCE_NAME: Record<Level, string> = {
  flags: "flag",
  envValues: "env",
  fileValues: "file",
  defaults: "default",
};

function wrap(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  let node: unknown = value;
  for (const key of keys.reverse()) node = { [key]: node };
  return node as Record<string, unknown>;
}

function read(obj: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = obj;
  for (const key of path.split(".")) {
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

const items = fc.string({ maxLength: 8 });
const list = fc.array(items, { maxLength: 6 });

const scenario = fc
  .record({
    key: fc.constantFrom(...LIST_KEYS),
    levelPair: fc
      .uniqueArray(fc.integer({ min: 0, max: 3 }), { minLength: 2, maxLength: 2 })
      .map(([a, b]) => (a! < b! ? [a!, b!] : [b!, a!])),
    higher: list,
    lower: list,
  })
  .filter(({ higher, lower }) => JSON.stringify(higher) !== JSON.stringify(lower));

describe("Property 6: list-valued keys replace rather than concatenate", () => {
  it("takes the higher-precedence array exactly", () => {
    fc.assert(
      fc.property(scenario, ({ key, levelPair, higher, lower }) => {
        const highLevel = LEVELS[levelPair[0]!]!;
        const lowLevel = LEVELS[levelPair[1]!]!;
        const input = { flags: {}, envValues: {}, fileValues: {}, defaults: {} } as Record<
          Level,
          Record<string, unknown>
        >;
        input[highLevel] = wrap(key, higher);
        input[lowLevel] = wrap(key, lower);

        const { merged, sources } = mergeSources(input);
        const result = read(merged, key) as string[];

        expect(result).toEqual(higher);
        expect(sources[key]).toBe(SOURCE_NAME[highLevel]);
        // No element of the lower array survives unless the higher array has it.
        for (const element of result) {
          expect(higher).toContain(element);
        }
        expect(result).toHaveLength(higher.length);
      }),
      { numRuns: 100 },
    );
  });

  it("does not mutate or alias the input arrays", () => {
    const high = ["a"];
    const { merged } = mergeSources({
      flags: { context: { include: high } },
      envValues: {},
      fileValues: { context: { include: ["b"] } },
      defaults: {},
    });
    expect(read(merged, "context.include")).toEqual(["a"]);
    expect(high).toEqual(["a"]);
  });
});
