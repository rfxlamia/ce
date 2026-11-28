import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOGO_DATA_URI, LOGO_HEIGHT, LOGO_WIDTH } from "./logo.js";

const bytes = readFileSync(fileURLToPath(new URL("./logo.webp", import.meta.url)));

function readWebpSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
  const chunk = buf.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (chunk === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

describe("logo asset", () => {
  it("is a WebP file", () => {
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("is at most 40960 bytes", () => {
    expect(bytes.length).toBeLessThanOrEqual(40960);
  });

  it("has pixel dimensions equal to LOGO_WIDTH and LOGO_HEIGHT", () => {
    expect(readWebpSize(bytes)).toEqual({ width: LOGO_WIDTH, height: LOGO_HEIGHT });
  });

  it("has a LOGO_DATA_URI that decodes to the same bytes as the file", () => {
    const prefix = "data:image/webp;base64,";
    expect(LOGO_DATA_URI.startsWith(prefix)).toBe(true);
    const decoded = Buffer.from(LOGO_DATA_URI.slice(prefix.length), "base64");
    expect(decoded.equals(bytes)).toBe(true);
  });
});
