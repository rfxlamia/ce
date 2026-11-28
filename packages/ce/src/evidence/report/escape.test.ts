import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { escapeAttr, escapeHtml, hrefFor, rawJsonScriptSafe } from "./escape.js";
import { decodeEscapedRawSection } from "./escape.testing.js";

describe("escape", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("escapeAttr leaves no raw quote, angle bracket, backtick or equals", () => {
    expect(escapeAttr(`" onerror=alert(1) \`<>'`)).not.toMatch(/["'<>`=]/);
  });

  it("hrefFor encodes each segment and keeps separators", () => {
    expect(hrefFor("screenshots/a b#1.png")).toBe("screenshots/a%20b%231.png");
  });

  it.each(["javascript:alert(1)", " JaVa\tScRiPt:alert(1)", "data:text/html,x", ""])(
    "hrefFor returns a placeholder for %j",
    (input) => {
      expect(hrefFor(input)).toBe("#");
    },
  );

  it("hrefFor never throws, even on lone surrogates", () => {
    expect(hrefFor("a/\ud800.png")).toBe("#");
  });

  it("rawJsonScriptSafe contains no raw '<' and round-trips (property)", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        const safe = rawJsonScriptSafe(text);
        expect(safe).not.toContain("<");
        expect(decodeEscapedRawSection(safe)).toBe(text);
      }),
    );
  });

  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("escapeHtml and escapeAttr escape %j", (ch, entity) => {
    expect(escapeHtml(ch)).toBe(entity);
    expect(escapeAttr(ch)).toBe(entity);
  });

  it("hrefFor rejects vbscript: and obfuscated javascript:", () => {
    expect(hrefFor("vbscript:x")).toBe("#");
    expect(hrefFor("java\u200bscript:alert(1)")).toBe("#");
  });

  it("rawJsonScriptSafe neutralises </script>, <!-- and -->", () => {
    const safe = rawJsonScriptSafe("</script><!-- x -->");
    expect(safe).not.toContain("</script>");
    expect(safe).not.toContain("<!--");
    expect(safe).not.toContain("-->");
    expect(safe).not.toContain("<");
    expect(safe).toBe("&lt;/script&gt;&lt;!-- x --&gt;");
  });

  it("round-trips pretty-printed JSON with hostile strings", () => {
    const value = { a: "</script><!-- --> &amp; \"q\" '" };
    const json = JSON.stringify(value, null, 2);
    expect(JSON.parse(decodeEscapedRawSection(rawJsonScriptSafe(json)))).toEqual(value);
  });
});
