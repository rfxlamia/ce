/**
 * Minimal glob matcher (Decision D20). Does not use fs.glob.
 *
 * Only two wildcards exist:
 * - `*`  matches any run of characters except `/`.
 * - `**` matches across `/`, including zero segments (`**\/x` matches `x`).
 * Every other character, including `?`, `[` and `{`, is literal.
 */

function escapeRegExp(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
}

/** Compile a glob into a RegExp anchored to the full string. */
export function compileGlob(pattern: string): RegExp {
  let source = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === "*") {
      let end = i;
      while (pattern[end] === "*") end++;
      if (end - i >= 2) {
        if (pattern[end] === "/") {
          // `**/` also matches zero segments.
          source += "(?:.*/)?";
          i = end + 1;
        } else {
          source += ".*";
          i = end;
        }
      } else {
        source += "[^/]*";
        i = end;
      }
    } else {
      source += escapeRegExp(ch);
      i++;
    }
  }
  return new RegExp(`^${source}$`, "s");
}

export function matchesGlob(pattern: string, path: string): boolean {
  return compileGlob(pattern).test(path);
}

export function matchesAny(patterns: string[], path: string): boolean {
  return patterns.some((pattern) => matchesGlob(pattern, path));
}
