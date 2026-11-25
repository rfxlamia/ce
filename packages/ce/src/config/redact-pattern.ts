/** Guidance carried by InlineFlagError (Requirement 1.16). */
export const INLINE_FLAG_EXPECTED =
  "inline flags such as (?i) are not supported in JavaScript; use the form /pattern/i, for example /token\\s*[:=]\\s*\\S+/i";

/** Text carried by RegexCompileError (Requirement 1.17). */
export const REGEX_COMPILE_EXPECTED =
  "JavaScript RegExp source or the form /pattern/flags";

const DELIMITED = /^\/(.*)\/([a-z]*)$/s;
const INLINE_FLAG_GROUP = /^\(\?[a-zA-Z]+\)/;

export class InlineFlagError extends Error {
  readonly expected = INLINE_FLAG_EXPECTED;
  readonly item: string;

  constructor(item: string) {
    super(INLINE_FLAG_EXPECTED);
    this.name = "InlineFlagError";
    this.item = item;
  }
}

export class RegexCompileError extends Error {
  readonly expected = REGEX_COMPILE_EXPECTED;
  readonly item: string;

  constructor(item: string, options?: { cause?: unknown }) {
    super(REGEX_COMPILE_EXPECTED, options);
    this.name = "RegexCompileError";
    this.item = item;
  }
}

/**
 * Compile one `context.redact` item.
 * - `/pattern/flags` compiles with `new RegExp(pattern, flags)`.
 * - Any other item compiles as a plain RegExp source.
 * - A leading inline-flag group such as `(?i)` throws InlineFlagError.
 * - Any other compile failure throws RegexCompileError.
 */
export function compileRedactPattern(item: string): RegExp {
  const delimited = DELIMITED.exec(item);
  try {
    if (delimited) {
      return new RegExp(delimited[1] as string, delimited[2] as string);
    }
  } catch (cause) {
    throw new RegexCompileError(item, { cause });
  }

  if (INLINE_FLAG_GROUP.test(item)) {
    throw new InlineFlagError(item);
  }

  try {
    return new RegExp(item);
  } catch (cause) {
    throw new RegexCompileError(item, { cause });
  }
}
