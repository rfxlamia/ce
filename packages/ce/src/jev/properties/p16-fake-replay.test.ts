import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../catalog.js";
import { FakeJevGateway, FakeRecordingMissingError } from "../fake.js";
import type { Recording } from "../fake.js";
import { stateHash } from "../hash.js";
import type { Jev_Request } from "../types.js";

// Feature: jev-gateway, Property 16: Fake_Gateway replay is a total, correct lookup
// **Validates: Requirements 11.3, 11.4, 11.12**

const ENTRIES = [
  CATALOG.claimIsBehavior,
  CATALOG.assessRuntimeObservable,
  CATALOG.assessChecksAdequate,
  CATALOG.runtimeStateReachedDom,
] as const;

const fixtureRecordings = JSON.parse(
  readFileSync(new URL("../fixtures/recordings.json", import.meta.url), "utf8"),
) as Recording[];

const state = fc.string({ unit: "grapheme", minLength: 1, maxLength: 60 });
const names = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/), {
  minLength: 1,
  maxLength: 4,
});
const entryIndexes = fc.array(fc.integer({ min: 0, max: ENTRIES.length - 1 }), {
  minLength: 4,
  maxLength: 4,
});
const answerValue = fc.integer({ min: 0, max: 1 });

const scenario = fc
  .record({ state, names, entryIndexes, answerValues: fc.array(answerValue, { minLength: 4, maxLength: 4 }) })
  .map(({ state: s, names: ns, entryIndexes: idx, answerValues }) => {
    const questions: Jev_Request["questions"] = {};
    const recordings: Recording[] = [];
    ns.forEach((name, i) => {
      const entry = ENTRIES[idx[i] ?? 0];
      if (entry === undefined) throw new Error("entry index out of range");
      questions[name] = entry.built();
      recordings.push({
        idVersion: entry.idVersion,
        stateHash: stateHash(s),
        question: name,
        answer: { type: "noul", noul: answerValues[i] ?? 0 } as Recording["answer"],
      });
    });
    const request: Jev_Request = { stage: "assessment", state: s, questions };
    return { request, recordings, names: ns };
  });

describe("Property 16: Fake_Gateway replay is a total, correct lookup", () => {
  it("returns exactly the recorded answers when every key matches", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async ({ request, recordings, names: ns }) => {
        const gateway = new FakeJevGateway([...fixtureRecordings, ...recordings]);
        const response = await gateway.ask(request);
        expect(Object.keys(response.answers).sort()).toEqual([...ns].sort());
        for (const recording of recordings) {
          expect(response.answers[recording.question]).toEqual(recording.answer);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("throws FakeRecordingMissingError naming the key when one question has no Recording", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, fc.nat(), async ({ request, recordings }, pick) => {
        const missing = recordings[pick % recordings.length];
        if (missing === undefined) throw new Error("no recording");
        const kept = recordings.filter((r) => r !== missing);
        const gateway = new FakeJevGateway([...fixtureRecordings, ...kept]);
        const error = await gateway.ask(request).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(FakeRecordingMissingError);
        const e = error as FakeRecordingMissingError;
        expect(e.idVersion).toBe(missing.idVersion);
        expect(e.question).toBe(missing.question);
        expect(e.stateHash).toBe(missing.stateHash);
        expect(e.message).toContain(missing.idVersion);
        expect(e.message).toContain(missing.question);
        expect(e.message).toContain(missing.stateHash);
      }),
      { numRuns: 100 },
    );
  });

  it("treats a Recording of another version of the same entry as missing", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, fc.integer({ min: 2, max: 9 }), async ({ request, recordings }, version) => {
        const shifted = recordings.map((r) => ({
          ...r,
          idVersion: r.idVersion.replace(/@\d+$/, `@${version}`),
        }));
        const gateway = new FakeJevGateway(shifted);
        const error = await gateway.ask(request).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(FakeRecordingMissingError);
        const first = recordings[0];
        if (first === undefined) throw new Error("no recording");
        const built = request.questions[first.question];
        expect((error as FakeRecordingMissingError).idVersion).toBe(built?.idVersion);
      }),
      { numRuns: 100 },
    );
  });

  it("throws for a different state even when the question and entry match", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, state, async ({ request, recordings }, otherState) => {
        fc.pre(stateHash(otherState) !== stateHash(request.state));
        const gateway = new FakeJevGateway([...fixtureRecordings, ...recordings]);
        const error = await gateway.ask({ ...request, state: otherState }).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(FakeRecordingMissingError);
        expect((error as FakeRecordingMissingError).stateHash).toBe(stateHash(otherState));
      }),
      { numRuns: 100 },
    );
  });
});
