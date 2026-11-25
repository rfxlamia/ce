import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "../retry-after.js";

// Feature: jev-gateway, Property 9: `Retry-After` delay parsing is total and correct
// **Validates: Requirements 7.15**

const isWholeNonNegative = (ms: unknown): boolean =>
  typeof ms === "number" && Number.isInteger(ms) && ms >= 0;

const digits = (min: number, max: number) =>
  fc.stringMatching(new RegExp(`^[0-9]{${min},${max}}$`));

const padding = fc.stringMatching(/^[ \t]{0,3}$/);

const deltaSeconds = fc.oneof(
  fc.integer({ min: 0, max: 1_000_000_000 }).map((n) => String(n)),
  fc
    .tuple(digits(1, 9), digits(1, 6))
    .map(([whole, frac]) => `${whole}.${frac}`),
);

const httpDate = fc.date({
  min: new Date("1970-01-01T00:00:00Z"),
  max: new Date("9999-12-31T23:59:59Z"),
  noInvalidDate: true,
});

const DELTA_MODEL = /^\d+(?:\.\d+)?$/;
const HTTP_DATE_MODEL =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

const otherText = fc.oneof(
  fc.constantFrom(
    "",
    " ",
    "abc",
    "-1",
    "-0.5",
    "+5",
    "1e3",
    "1.",
    ".5",
    "0x10",
    "NaN",
    "Infinity",
    "1,5",
    "5 seconds",
    "Sun, 06 Nov 1994",
    "2026-11-25T09:10:02Z",
    "Sunday, 06-Nov-94 08:49:37 GMT",
    "Sun Nov  6 08:49:37 1994",
  ),
  fc.string({ unit: "grapheme", maxLength: 40 }),
  fc.string({ unit: "grapheme-ascii", maxLength: 40 }),
).filter((s) => {
  const t = s.trim();
  return !DELTA_MODEL.test(t) && !HTTP_DATE_MODEL.test(t);
});

describe("Property 9: Retry-After delay parsing is total and correct", () => {
  it("delta-seconds text gives non-negative whole milliseconds equal to seconds * 1000", () => {
    fc.assert(
      fc.property(deltaSeconds, padding, padding, fc.integer({ min: 0, max: 2 ** 40 }), (text, lead, trail, now) => {
        const ms = parseRetryAfter(`${lead}${text}${trail}`, now);
        expect(isWholeNonNegative(ms)).toBe(true);
        expect(Math.abs((ms as number) - Number(text) * 1000)).toBeLessThanOrEqual(0.5);
      }),
      { numRuns: 200 },
    );
  });

  it("HTTP-date text gives the non-negative whole milliseconds from now to that date", () => {
    fc.assert(
      fc.property(httpDate, fc.integer({ min: 0, max: 2 ** 43 }), (date, now) => {
        const text = date.toUTCString();
        expect(text).toMatch(HTTP_DATE_MODEL);
        const ms = parseRetryAfter(text, now);
        expect(isWholeNonNegative(ms)).toBe(true);
        // HTTP-date has one-second resolution, so compare against the date as written.
        expect(ms).toBe(Math.max(0, Math.floor(date.getTime() / 1000) * 1000 - now));
      }),
      { numRuns: 200 },
    );
  });

  it("text in neither form gives undefined", () => {
    fc.assert(
      fc.property(otherText, fc.integer({ min: 0, max: 2 ** 40 }), (text, now) => {
        expect(parseRetryAfter(text, now)).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  it("never throws and returns either undefined or a non-negative whole number", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ unit: "grapheme", maxLength: 60 }), deltaSeconds, httpDate.map((d) => d.toUTCString())),
        (text) => {
          const ms = parseRetryAfter(text);
          expect(ms === undefined || isWholeNonNegative(ms)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
