/**
 * Test-only helpers for `escape.ts`. Not imported by production code.
 */

/**
 * Exact inverse of `rawJsonScriptSafe`: undo the `</` layer, then decode the
 * entities `escapeHtml` produces (`&amp;` last so `&amp;lt;` decodes to `&lt;`).
 */
export function decodeEscapedRawSection(escaped: string): string {
  return escaped
    .replace(/<\\\//g, "</")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
