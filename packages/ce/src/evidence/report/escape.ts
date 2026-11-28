/**
 * The one place that turns Run_Record strings into safe HTML.
 * Pure and total: no function here throws.
 */

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape `& < > " '` for element text and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch] ?? ch);
}

/**
 * Escape for use inside a quoted attribute value. Quotes are already
 * entity-encoded by `escapeHtml`; backtick and `=` are also encoded so the
 * value stays inert in legacy unquoted-attribute parsing.
 */
export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/`/g, "&#96;").replace(/=/g, "&#61;");
}

/** Returned by `hrefFor` for input that must never become a link target. */
export const UNSAFE_HREF_PLACEHOLDER = "#";

// eslint-disable-next-line no-control-regex
const IGNORED_IN_SCHEME = /[\u0000-\u0020\u007f-\u009f\u200b-\u200d\u2060\ufeff]/g;
const DANGEROUS_SCHEME = /^(?:javascript|vbscript|data):/i;

/**
 * Convert a bundle-relative path into a percent-encoded relative URL,
 * encoding each `/`-separated segment independently. Returns a safe
 * placeholder for `javascript:`-looking input or anything that cannot be
 * encoded. Never throws.
 */
export function hrefFor(relativePath: string): string {
  try {
    if (typeof relativePath !== "string" || relativePath === "") {
      return UNSAFE_HREF_PLACEHOLDER;
    }
    if (DANGEROUS_SCHEME.test(relativePath.replace(IGNORED_IN_SCHEME, ""))) {
      return UNSAFE_HREF_PLACEHOLDER;
    }
    return relativePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  } catch {
    // encodeURIComponent throws URIError on lone surrogates.
    return UNSAFE_HREF_PLACEHOLDER;
  }
}

/**
 * Make pretty-printed JSON safe to place in element text (and, as a second
 * layer, inside a script body): HTML-escape, then turn `</` into `<\/`.
 * After the first step no `<` remains, so the second step is defense in depth.
 */
export function rawJsonScriptSafe(json: string): string {
  return escapeHtml(json).replace(/<\//g, "<\\/");
}
