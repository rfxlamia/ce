import type { z } from 'zod';
import { CREDENTIAL_KEY_NAME_PATTERN, SECRETS_IN_ENV_MESSAGE } from './schema.js';
import type { ConfigSource, LoadFailure } from './load.js';

/** A single invalid configuration value. */
export interface ValidationError {
  path: string;
  value: unknown;
  expected: string;
  source?: ConfigSource;
}

/**
 * An unreadable Config_File or invalid YAML syntax.
 * Deliberately has no path, value, expected or source field, so it cannot be
 * mistaken for a ValidationError.
 */
export interface ConfigFileError {
  kind: 'read' | 'parse';
  file: string;
  code: string;
  message: string;
  line?: number;
  column?: number;
}

const TYPE_NAMES: Record<string, string> = {
  object: 'mapping',
  record: 'mapping',
  array: 'list',
  string: 'string',
  number: 'number',
  int: 'positive integer',
  boolean: 'boolean',
  null: 'null',
};

function lookup(input: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = input;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function joinPath(path: readonly PropertyKey[]): string {
  return path.map((part) => String(part)).join('.');
}

function expectedFor(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return TYPE_NAMES[issue.expected] ?? String(issue.expected);
    case 'too_small':
    case 'too_big': {
      if (issue.origin === 'number') {
        const minimum = issue.code === 'too_small' ? issue.minimum : undefined;
        if (minimum !== undefined && Number(minimum) === 0 && issue.inclusive === false) {
          return 'positive integer';
        }
        return 'number between 0 and 1';
      }
      return issue.message;
    }
    case 'invalid_value':
      return `one of ${issue.values.map((v) => JSON.stringify(v)).join(', ')}`;
    case 'invalid_format':
      return issue.format === 'url' ? 'absolute http or https URL' : issue.message;
    case 'custom': {
      const params = (issue as { params?: { expected?: unknown } }).params;
      return typeof params?.expected === 'string' ? params.expected : issue.message;
    }
    default:
      return issue.message;
  }
}

/**
 * Convert a ZodError into ValidationErrors. The stored value is the true
 * input value, looked up by path in `input` (zod issues carry no value).
 */
export function fromZodError(
  error: z.ZodError,
  source?: ConfigSource,
  input?: unknown,
): ValidationError[] {
  const out: ValidationError[] = [];
  const make = (path: readonly PropertyKey[], expected: string): void => {
    const entry: ValidationError = { path: joinPath(path), value: lookup(input, path), expected };
    if (source !== undefined) entry.source = source;
    out.push(entry);
  };
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        make(
          [...issue.path, key],
          CREDENTIAL_KEY_NAME_PATTERN.test(key)
            ? SECRETS_IN_ENV_MESSAGE
            : 'a known configuration key',
        );
      }
      continue;
    }
    make(issue.path, expectedFor(issue));
  }
  return out;
}

/** Return a copy sorted by path (stable, code-unit order). */
export function sortByPath(errors: readonly ValidationError[]): ValidationError[] {
  return [...errors].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function renderValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Render a report: one entry per error, sorted by path. Any secret that
 * appears in printed text is replaced with [REDACTED]; stored errors are
 * not modified.
 */
export function formatReport(
  errors: readonly ValidationError[],
  secrets: readonly string[],
): string {
  const ordered = [...new Set(secrets.filter((secret) => secret.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  const scrub = (text: string): string =>
    ordered.reduce((acc, secret) => acc.split(secret).join('[REDACTED]'), text);
  return sortByPath(errors)
    .map((error) => {
      const value =
        typeof error.value === 'string' && ordered.includes(error.value)
          ? '[REDACTED]'
          : scrub(renderValue(error.value));
      const lines = [
        `${scrub(error.path)}`,
        `  value: ${value}`,
        `  expected: ${scrub(error.expected)}`,
      ];
      if (error.source !== undefined) lines.push(`  source: ${error.source}`);
      return lines.join('\n');
    })
    .join('\n');
}

/** Render a ConfigFileError on one line; never prints file contents. */
export function formatFileError(error: ConfigFileError): string {
  // Only the first line: parser messages append a code frame quoting file lines.
  const message = (error.message.split(/\r?\n/, 1)[0] ?? '').trimEnd();
  if (error.kind === 'read') {
    return `${error.file}: cannot read config file (${error.code}): ${message}`;
  }
  const position =
    error.line !== undefined
      ? `:${error.line}${error.column !== undefined ? `:${error.column}` : ''}`
      : '';
  return `${error.file}${position}: invalid YAML (${error.code}): ${message}`;
}

/**
 * Write a configuration failure to `stderr` and return the exit code 1.
 * Does not decide an Outcome and does not exit the process.
 */
export function reportConfigFailure(
  failure: LoadFailure,
  secrets: string[],
  stderr: { write(text: string): unknown },
): 1 {
  const text =
    'errors' in failure
      ? formatReport(failure.errors, secrets)
      : formatFileError(failure.fileError);
  stderr.write(text.endsWith('\n') ? text : `${text}\n`);
  return 1;
}
