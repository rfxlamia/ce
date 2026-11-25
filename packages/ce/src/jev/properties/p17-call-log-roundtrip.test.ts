import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CallLogEntry, CallLogEntrySchema, createJsonlCallLog } from "../log.js";

// Feature: jev-gateway, Property 17: Call_Log entries always round-trip through JSON and the schema
// **Validates: Requirements 12.10**

// Avoid -0, which JSON turns into 0.
const nonNegative = (max: number) =>
  fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true }).map((n) => n + 0);
const probability = nonNegative(1);
// "__proto__" is a valid [a-z0-9_] key, but as an own property it does not survive
// JSON/zod round-trips with deep equality. Exclude it and other prototype names.
const reservedKeys = new Set(["__proto__", "constructor", "prototype"]);
const key = fc.stringMatching(/^[a-z0-9_]{1,12}$/).filter((k) => !reservedKeys.has(k));
const probabilityMap = fc.dictionary(key, probability, { maxKeys: 6 });
const tokenCount = fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null });

const answer = fc.oneof(
  fc.record({ type: fc.constant("noul" as const), probability }),
  fc.record({ type: fc.constant("choice" as const), probabilities: probabilityMap }),
  fc.record({ type: fc.constant("score" as const), probabilities: probabilityMap }),
  fc.record({
    type: fc.constant("box" as const),
    box: fc.record({ top: probability, bottom: probability, left: probability, right: probability }),
    confidence: fc.option(probability, { nil: null }),
  }),
);

const question = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  version: fc.integer({ min: 1, max: 1000 }),
  type: fc.constantFrom("noul", "choice", "score", "box"),
});

const entry: fc.Arbitrary<CallLogEntry> = fc
  .record({
    timestamp: fc
      .date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z"), noInvalidDate: true })
      .map((d) => d.toISOString()),
    stage: fc.constantFrom("context", "assessment", "runtime", "evidence"),
    transport: fc.constantFrom("sdk", "json", "fake"),
    provider: fc.constantFrom("openrouter", "typesafe"),
    requestedModel: fc.string({ maxLength: 40 }),
    model: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
    questions: fc.array(question, { maxLength: 4 }),
    answers: fc.dictionary(key, answer, { maxKeys: 4 }),
    latencyMs: nonNegative(1e7),
    usage: fc.record({ input_tokens: tokenCount, output_tokens: tokenCount }),
    stateHash: fc.stringMatching(/^[0-9a-f]{64}$/),
    status: fc.constantFrom("ok", "error"),
    attempts: fc.integer({ min: 0, max: 20 }),
  })
  .chain((base) =>
    fc
      .record(
        {
          errorKind: fc.constantFrom(
            "bad_request",
            "rate_limited",
            "timeout",
            "connection",
            "server",
            "invalid_image",
            "invalid_response",
            "client",
            "rate_limit",
            "auth",
            "abort",
            "other",
          ),
          httpStatus: fc.integer({ min: 100, max: 599 }),
        },
        { requiredKeys: [] },
      )
      .map((optional) => ({ ...base, ...optional }) as CallLogEntry),
  );

describe("Property 17: Call_Log entries always round-trip through JSON and the schema", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ce-p17-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("JSON.stringify then parse then schema equals the original", () => {
    fc.assert(
      fc.property(entry, (e) => {
        const parsed = CallLogEntrySchema.parse(JSON.parse(JSON.stringify(e)));
        expect(parsed).toEqual(e);
      }),
      { numRuns: 200 },
    );
  });

  it("an entry written by createJsonlCallLog reads back as the same entry", async () => {
    let n = 0;
    await fc.assert(
      fc.asyncProperty(entry, async (e) => {
        const path = join(dir, `calls-${n++}.jsonl`);
        await createJsonlCallLog(path).append(e);
        const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
        expect(lines).toHaveLength(1);
        expect(CallLogEntrySchema.parse(JSON.parse(lines[0]!))).toEqual(e);
      }),
      { numRuns: 100 },
    );
  });
});
