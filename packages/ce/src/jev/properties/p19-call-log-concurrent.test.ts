import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CallLogEntrySchema, createJsonlCallLog, type CallLogEntry } from "../log.js";

// Feature: jev-gateway, Property 19: Concurrent log appends never interleave, drop, or duplicate a line
// **Validates: Requirements 12.12, 12.13**

const probability = fc.double({ min: 0, max: 1, noNaN: true });
const hex64 = fc.stringMatching(/^[0-9a-f]{64}$/);

// Long free text in `requestedModel` makes torn or interleaved writes likely if appends were not serialized.
const entryBase = fc.record({
  timestamp: fc
    .date({ min: new Date("2020-01-01T00:00:00Z"), max: new Date("2035-01-01T00:00:00Z"), noInvalidDate: true })
    .map((d) => d.toISOString()),
  stage: fc.constantFrom("context", "assessment", "runtime", "evidence"),
  transport: fc.constantFrom("sdk", "json", "fake"),
  provider: fc.constantFrom("openrouter", "typesafe"),
  requestedModel: fc.string({ unit: "grapheme", maxLength: 300 }),
  model: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
  questions: fc.array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 20 }),
      version: fc.integer({ min: 1, max: 50 }),
      type: fc.constantFrom("noul", "choice", "score", "box"),
    }),
    { maxLength: 3 },
  ),
  answers: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }),
    fc.oneof(
      fc.record({ type: fc.constant("noul" as const), probability }),
      fc.record({
        type: fc.constant("choice" as const),
        probabilities: fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), probability, { maxKeys: 4 }),
      }),
    ),
    { maxKeys: 3 },
  ),
  latencyMs: fc.double({ min: 0, max: 100000, noNaN: true }),
  usage: fc.record({
    input_tokens: fc.option(fc.nat(100000), { nil: null }),
    output_tokens: fc.option(fc.nat(100000), { nil: null }),
  }),
  stateHash: hex64,
  status: fc.constantFrom("ok", "error"),
  attempts: fc.nat(10),
});

const entries = fc
  .array(entryBase, { minLength: 1, maxLength: 25 })
  // Tag each entry with its call index so order is checkable and entries are distinct.
  .map((list) => list.map((e, i) => ({ ...e, requestedModel: `${i}:${e.requestedModel}` }) as CallLogEntry));

describe("Property 19: concurrent log appends never interleave, drop, or duplicate a line", () => {
  it("writes exactly N valid lines, the same entries, in call order", async () => {
    await fc.assert(
      fc.asyncProperty(entries, async (list) => {
        const dir = await mkdtemp(join(tmpdir(), "ce-p19-"));
        try {
          const path = join(dir, "nested", "jev-calls.jsonl");
          const log = createJsonlCallLog(path);

          // All appends start in the same tick, without awaiting each other.
          await Promise.all(list.map((entry) => log.append(entry)));

          const raw = await readFile(path, "utf8");
          expect(raw.endsWith("\n")).toBe(true);
          const lines = raw.slice(0, -1).split("\n");
          expect(lines).toHaveLength(list.length);

          const parsed = lines.map((line) => JSON.parse(line) as unknown);
          for (const value of parsed) {
            expect(CallLogEntrySchema.safeParse(value).success).toBe(true);
          }

          // Equal multisets: compare sorted canonical serializations.
          const canonical = (e: unknown) => JSON.stringify(CallLogEntrySchema.parse(e));
          expect(parsed.map(canonical).sort()).toEqual(list.map(canonical).sort());

          // Call order.
          expect(parsed.map(canonical)).toEqual(list.map(canonical));
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
