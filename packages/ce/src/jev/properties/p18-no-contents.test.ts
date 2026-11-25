import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOG } from "../catalog.js";
import { HybridJevGateway } from "../gateway.js";
import { createJsonlCallLog } from "../log.js";
import type { SdkTransport } from "../transport-sdk.js";
import type { JsonTransport } from "../transport-json.js";

// Feature: jev-gateway, Property 18: The Call_Log never contains state text, option labels or the API key
// **Validates: Requirements 12.4, 12.5, 12.11**

const body = fc.stringMatching(/^[A-Za-z0-9]{8,30}$/);
// Prefixes keep generated secrets from colliding with fixed log vocabulary.
const stateText = fc.tuple(body, body).map(([a, b]) => `STATE-${a} ${b}`);
const label = body.map((s) => `LBL-${s}`);
const labels = fc.uniqueArray(label, { minLength: 1, maxLength: 8 });
const apiKey = body.map((s) => `sk-or-v1-${s}`);

const callSpec = fc.record({
  state: stateText,
  labels,
  key: apiKey,
  fail: fc.boolean(),
});

describe("Property 18: The Call_Log never contains state text, option labels or the API key", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ce-p18-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("the serialized log contains none of the state text, labels or keys", async () => {
    let n = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(callSpec, { minLength: 1, maxLength: 4 }), async (calls) => {
        const path = join(dir, `calls-${n++}.jsonl`);
        const callLog = createJsonlCallLog(path);

        for (const call of calls) {
          const secrets = `${call.key} ${call.state} ${call.labels.join(" ")}`;
          const probabilities: Record<string, number> = { done: 0.1, give_up: 0.1 };
          call.labels.forEach((_, i) => {
            probabilities[String(i)] = 0.5;
          });
          const sdkTransport: SdkTransport = {
            send: () =>
              call.fail
                ? Promise.reject(new Error(`boom ${secrets}`))
                : Promise.resolve({
                    model: "typesafe/jev-1.14-20261014",
                    answers: { next_action: { type: "choice", probabilities } },
                    usage: { input_tokens: 10, output_tokens: 2 },
                  }),
          };
          const jsonTransport: JsonTransport = {
            send: () => Promise.reject(new Error("json transport must not be used")),
          };
          const gateway = new HybridJevGateway({
            sdkTransport,
            jsonTransport,
            callLog,
            provider: "openrouter",
            requestedModel: "typesafe/jev-1.14",
            maxTransientRetries: 0,
            maxRateLimitRetries: 0,
            sleep: () => Promise.resolve(),
          });
          const request = {
            stage: "runtime" as const,
            state: call.state,
            questions: { next_action: CATALOG.runtimeNextAction.built(call.labels) },
          };
          const outcome = await gateway.ask(request).then(
            () => "ok",
            () => "error",
          );
          expect(outcome).toBe(call.fail ? "error" : "ok");
        }

        const text = await readFile(path, "utf8");
        expect(text.split("\n").filter(Boolean)).toHaveLength(calls.length);
        for (const call of calls) {
          expect(text).not.toContain(call.key);
          expect(text).not.toContain(call.state);
          for (const l of call.labels) expect(text).not.toContain(l);
        }
      }),
      { numRuns: 100 },
    );
  });
});
