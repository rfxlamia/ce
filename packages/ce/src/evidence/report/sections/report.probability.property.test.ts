// Feature: report-html-evidence-page, Property 7: Probability values are always shown within range
// **Validates: Requirements 5.6, 5.7, 5.8, 6.4, 6.5**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../schema.js";
import { signalBar } from "../signal.js";
import { renderAssessment } from "./assessment.js";
import { renderTimeline } from "./timeline.js";

const NUM_RUNS = 100;

// Finite probabilities, deliberately including out-of-range values.
const finiteArb = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(0, 1, -0, -0.001, 1.0001, 100, -100, 0.005, 0.995),
);
const nonFiniteArb = fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
const valueArb = fc.oneof(finiteArb, nonFiniteArb, fc.constant(null));

const expectedPercent = (v: number): number => Math.min(100, Math.max(0, v * 100));

interface ParsedBar {
  width: number;
  now: number;
  valueText: string;
  role: string | null;
  name: string | null;
}

function parseBars(html: string): ParsedBar[] {
  const bars: ParsedBar[] = [];
  const re =
    /<div class="track" role="([^"]*)" aria-label="([^"]*)"[^>]*aria-valuenow="([^"]*)"[^>]*><div class="fill" style="width:([^%"]*)%"><\/div><\/div><span class="val">([^<]*)<\/span>/g;
  for (const m of html.matchAll(re)) {
    bars.push({ role: m[1]!, name: m[2]!, now: Number(m[3]), width: Number(m[4]), valueText: m[5]! });
  }
  return bars;
}

function checkFiniteBar(html: string, value: number): void {
  const bars = parseBars(html);
  expect(bars).toHaveLength(1);
  const bar = bars[0]!;
  const pct = expectedPercent(value);
  expect(bar.role).toBe("meter");
  expect(bar.name ?? "").not.toBe("");
  expect(bar.width).toBeGreaterThanOrEqual(0);
  expect(bar.width).toBeLessThanOrEqual(100);
  expect(bar.now).toBeGreaterThanOrEqual(0);
  expect(bar.now).toBeLessThanOrEqual(100);
  expect(bar.width).toBeCloseTo(pct, 1);
  expect(bar.now).toBeCloseTo(pct, 1);
  expect(bar.valueText).toMatch(/^-?\d+\.\d{2}$/);
  expect(Math.abs(Number(bar.valueText) - value)).toBeLessThanOrEqual(0.0051);
  expect(html).not.toContain("no answer");
}

function checkNoBar(html: string): void {
  expect(html).toContain("no answer");
  expect(html).not.toContain("role=\"meter\"");
  expect(html).not.toContain("aria-valuenow");
}

const isFinite_ = (v: number | null): v is number => v !== null && Number.isFinite(v);

function assessmentRecord(questions: unknown[]): RunRecord {
  return {
    claims: [],
    context: null,
    assessment: {
      required: true,
      decidedBy: "classifier",
      surface: "browser",
      claimStatus: "ok",
      questions,
      perClaimProbabilities: [],
      settings: {
        claimThreshold: 0.5,
        observableThreshold: 0.5,
        adequateThreshold: 0.5,
        uncertaintyBand: 0.1,
        onUncertain: "run",
      },
    },
  } as unknown as RunRecord;
}

function timelineRecord(probability: number): RunRecord {
  return {
    outcomeReason: "r",
    eventLog: [],
    steps: [
      {
        step: 1,
        title: "t",
        url: "http://x/",
        screenshot: "screenshots/1.png",
        executed: true,
        action: { kind: "click", description: "go" },
        alternatives: [{ key: "a", description: "go", probability }],
      },
    ],
  } as unknown as RunRecord;
}

describe("Feature: report-html-evidence-page, Property 7", () => {
  it("signalBar clamps width and aria-valuenow, shows two decimals, has role=meter and a name", () => {
    fc.assert(
      fc.property(valueArb, fc.string({ minLength: 1, maxLength: 20 }), (value, label) => {
        const html = signalBar(label, value);
        if (isFinite_(value)) checkFiniteBar(html, value);
        else checkNoBar(html);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("assessment section: single probability and per-label probabilities obey the same rules", () => {
    fc.assert(
      fc.property(valueArb, fc.array(finiteArb, { minLength: 1, maxLength: 4 }), (single, many) => {
        const singleHtml = renderAssessment(
          assessmentRecord([{ idVersion: "q@1", subjectId: "s", probabilities: null, probability: single }]),
          () => undefined,
        );
        if (isFinite_(single)) checkFiniteBar(singleHtml, single);
        else checkNoBar(singleHtml);

        const probabilities = Object.fromEntries(many.map((p, i) => [`label${i}`, p]));
        const manyHtml = renderAssessment(
          assessmentRecord([{ idVersion: "q@1", subjectId: "s", probabilities, probability: null }]),
          () => undefined,
        );
        const bars = parseBars(manyHtml);
        expect(bars).toHaveLength(many.length);
        for (const bar of bars) {
          expect(bar.role).toBe("meter");
          expect(bar.width).toBeGreaterThanOrEqual(0);
          expect(bar.width).toBeLessThanOrEqual(100);
          expect(bar.now).toBeGreaterThanOrEqual(0);
          expect(bar.now).toBeLessThanOrEqual(100);
          expect(bar.valueText).toMatch(/^-?\d+\.\d{2}$/);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("assessment section: a question with no probability shows the no-answer text", () => {
    const html = renderAssessment(
      assessmentRecord([{ idVersion: "q@1", subjectId: "s", probabilities: null, probability: null }]),
      () => undefined,
    );
    expect(html).toContain("returned no answer");
    expect(html).not.toContain("role=\"meter\"");
  });

  it("timeline section: alternative bars obey the same rules; empty alternatives say so", () => {
    fc.assert(
      fc.property(valueArb, (value) => {
        const html = renderTimeline(timelineRecord(value as number));
        if (isFinite_(value)) checkFiniteBar(html, value);
        else checkNoBar(html);
      }),
      { numRuns: NUM_RUNS },
    );
    const empty = timelineRecord(0.5);
    (empty.steps[0] as { alternatives: unknown[] }).alternatives = [];
    expect(renderTimeline(empty)).toContain("no alternatives recorded");
  });
});
