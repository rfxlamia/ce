# Implementation Plan: ce-config-loader

## Overview

Implement the configuration layer of CE (GitHub issue #4) in TypeScript under `packages/ce/src/config/`, following `design.md`. Order of work: dependencies and scaffolding, then schema primitives (duration, redact pattern, `ConfigSchema`, defaults), then the loader collaborators (errors, file, env, merge), then redaction, credential check and `loadConfig`, then JSON Schema generation, then the public API. The last task verifies every acceptance criterion of issue #4 with evidence and opens a pull request that contains `Closes #4`, per Requirement 10 and the "Closing the issue" section of the design.

Conventions used by these tasks:

- Unit tests sit next to the module they test, as `<module>.test.ts` in `packages/ce/src/config/`.
- Each correctness property is one fast-check test in its own file, `packages/ce/src/config/properties/pNN-<name>.test.ts`, with `numRuns` of at least 100 and a comment `// Feature: ce-config-loader, Property N: <title>` above the test.
- All tests pass `env`, `flags` and `cwd` explicitly and need no API key. File-based tests use temporary directories (`fs.mkdtempSync`).
- Nothing in `config/` imports `outcome/resolve.ts` or anything in `jev/`. No `Outcome` value is produced in `config/`.
- Commands run from the repository root. Do not run watch-mode commands; use `vitest run` (through `npm test`).

## Tasks

- [x] 1. Add dependencies, scripts and test scaffolding
  - In `packages/ce/package.json` add `zod` (^4) and `yaml` (^2) as dependencies, and `fast-check` (^4), `ajv` (^8) and `tsx` as devDependencies. Keep the existing `vitest` pin.
  - Add the script `"generate:config-schema": "tsx src/scripts/generate-config-schema.ts"` and make sure `build`, `typecheck` and `test` (`vitest run --passWithNoTests`) scripts exist. Do not wire the generator into `build` or `test`.
  - Create the empty directories' first files only when later tasks need them; do not add placeholder code.
  - Run `npm install` from the repository root so the lockfile updates.
  - Do not add any key or credential value to any committed file.
  - _Requirements: 9.13, 9.14, 9.15_

- [x] 2. Implement schema primitives and defaults
  - [x] 2.1 Implement `duration.ts`
    - Export `DURATION_PATTERN` (`^[1-9]\d*(ms|s|m)$`), `parseDuration(text): number` (milliseconds) and `formatDuration(ms): string`.
    - `parseDuration` throws or returns a typed failure for text that does not match the pattern, so `env.ts` can keep the original text.
    - _Requirements: 1.9, 5.9_

  - [x] 2.2 Implement `redact-pattern.ts`
    - Export `compileRedactPattern(item: string): RegExp`, `InlineFlagError` and `RegexCompileError`.
    - Delimited form `/pattern/flags` compiles with `new RegExp(pattern, flags)`. Other items compile as plain source. An item starting with `(?i)` or another inline-flag group throws `InlineFlagError` carrying the `/pattern/i` guidance. Any other compile failure throws `RegexCompileError` carrying the "JavaScript RegExp source or the form /pattern/flags" text.
    - _Requirements: 1.11, 1.14, 1.15, 1.16, 1.17_

  - [x] 2.3 Write property test for redact-pattern compilation
    - File: `packages/ce/src/config/properties/p02-redact-pattern.test.ts`
    - **Property 2: Redact-pattern compilation is total and classified**
    - Exactly one of three outcomes occurs for any string (compiles, `InlineFlagError`, `RegexCompileError`). For the delimited form the resulting `flags` equal the captured flags, and an `i` flag makes an upper-case occurrence match.
    - **Validates: Requirements 1.11, 1.14, 1.15, 1.16, 1.17**

  - [x] 2.4 Implement `schema.ts`
    - Export `ConfigSchema` built with `z.strictObject` at every level, every key optional, with the constraints of Requirement 1 criteria 3 to 11 (`version` literal 0, numbers 0..1, enums, positive integers, `DurationString`, absolute `http`/`https` URL, `RedactPattern` via `compileRedactPattern`). Use `z.record` for `runtime.fixtures`.
    - Export `EffectiveConfig = z.infer<typeof ConfigSchema>` and `CREDENTIAL_KEY_NAME_PATTERN`.
    - Add the credential-key check so that a key named like `api-key`, `apikey`, `secret`, `token` or `password` outside `context.redact` and `runtime.fixtures` yields the "secrets belong in environment variables" message instead of the generic unknown-key message.
    - Map `InlineFlagError` and `RegexCompileError` to zod issues whose `path` is `context.redact.<index>` and which carry the matching `expected` text.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.16, 1.17_

  - [x] 2.5 Write property test for unknown and credential-named keys
    - File: `packages/ce/src/config/properties/p01-unknown-keys.test.ts`
    - **Property 1: Unknown and credential-named keys are always rejected**
    - Inject an undefined key at any object level of a valid config; assert an error whose path includes the key. For credential-named keys outside `context.redact` and `runtime.fixtures`, assert the message says secrets belong in environment variables.
    - **Validates: Requirements 1.12, 1.13**

  - [x] 2.6 Write unit tests for `ConfigSchema`
    - File: `packages/ce/src/config/schema.test.ts`
    - One test per Validation_Error category: wrong type, out-of-range number, invalid enum, malformed duration, invalid URL (including a non-http scheme), invalid regular expression, unknown key, credential-named key.
    - `context.redact`: `token\s*[:=]\s*\S+` accepted; `/token\s*[:=]\s*\S+/i` accepted and matches `TOKEN: abc`; `(?i)token\s*[:=]\s*\S+` rejected with `expected` naming `/pattern/i`, `path` `context.redact.0` and `value` equal to the item.
    - Every key of Requirement 1 criterion 1 is accepted when valid, and an empty object is valid.
    - _Requirements: 1.1 to 1.17, 9.2, 9.3_

  - [x] 2.7 Implement `defaults.ts`
    - Export `ConfigDefaults: EffectiveConfig` with exactly the defaults of Requirement 2 criterion 1. Omit `target.*`, `context.*` and `runtime.fixtures`.
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.8 Write unit tests for `ConfigDefaults`
    - File: `packages/ce/src/config/defaults.test.ts`
    - Assert each default value, that keys without a default are `undefined`, and that `ConfigSchema.safeParse(ConfigDefaults).success` is `true`.
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Checkpoint - Ensure typecheck and tests pass
  - Run `npm run typecheck` and `npm test` from the repository root. Ensure both pass, ask the user if questions arise.

- [x] 4. Implement loader collaborators (types, errors, file, env, merge)
  - [x] 4.1 Declare shared types in `load.ts`
    - Export `ConfigSource` (`'flag' | 'env' | 'file' | 'default'`), `ConfigMeta`, `LoadedConfig`, `LoadConfigOptions`, `LoadFailure` and `LoadConfigResult` exactly as in the design. `ConfigMeta` holds `fileRead`, `fileIgnored`, `ignoredEnvNames` and `sources`, and no values from `env`. `EffectiveConfig` has no `meta` field.
    - `LoadFailure` is the union `{ ok: false; errors: ValidationError[] } | { ok: false; fileError: ConfigFileError }`. A `fileError` result has no `errors` field and an `errors` result has no `fileError` field. `LoadConfigResult` is the `ok: true` Loaded_Config shape or `LoadFailure`.
    - In `errors.ts`, declare only the types `ValidationError` (`path`, `value`, `expected`, optional `source`) and `ConfigFileError` (`kind: 'read' | 'parse'`, `file`, `code`, `message`, optional `line`, optional `column`; no `path`, `value`, `expected` or `source` field) so `load.ts` can import them. Task 4.2 adds the functions to the same file.
    - Leave the `loadConfig` implementation to task 6.7. Declare it so it throws "not implemented" until then, or add the function in 6.7 only.
    - _Requirements: 4.6, 4.9, 6.9, 6.19, 6.20, 7.12, 7.13, 7.14, 8.1, 8.4_

  - [x] 4.2 Implement `errors.ts`
    - Export the `ValidationError` type (`path`, `value`, `expected`, optional `source`), `fromZodError(error, source?)`, `sortByPath(errors)` and `formatReport(errors, secrets)`.
    - `fromZodError` joins `issue.path` with dots and fills `expected` from a table of readable shapes (`number between 0 and 1`, `one of "evidence", "skip"`, `positive integer`, `duration string like "90s"`, `absolute http or https URL`, `mapping`, and so on). The stored error keeps the true value.
    - `formatReport` sorts by path, prints one entry per error with path, value, expected and source when present, and replaces any value or substring that equals a secret with `[REDACTED]` in the printed text only.
    - Export `formatFileError(error: ConfigFileError): string`. For `kind: 'read'` it renders `<file>: cannot read config file (<code>): <message>`. For `kind: 'parse'` it renders `<file>:<line>:<column>: invalid YAML (<code>): <message>`, leaving out line and column when the parser gave none. It prints no path, value or expected-shape text and never prints file contents.
    - Do not represent malformed YAML or unreadable-file errors as `ValidationError`-shaped objects (no `'(root)'` or `'(file)'` placeholder paths). They use the separate `ConfigFileError` type declared in task 4.1, and `formatReport` handles only `ValidationError`s. A non-mapping root stays a `ValidationError` with path `(root)`.
    - _Requirements: 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.7, 6.9, 6.19, 6.20_

  - [x] 4.3 Write property test for secret redaction in the printed report
    - File: `packages/ce/src/config/properties/p12-report-redaction.test.ts`
    - **Property 12: Secret-matching values are always redacted in the printed report**
    - **Validates: Requirements 6.7**

  - [x] 4.4 Implement `file.ts`
    - Export `discoverConfigFile({ cwd, configFlag })` and `readAndParseConfigFile(path)` as specified in the design.
    - Discovery: `ce.yml`, then `.ce.yml`, record the ignored one when both exist, no upward or `$HOME` lookup. With `configFlag`: trim, reject empty or whitespace (`path: 'config'`, `source: 'flag'`), resolve relative paths against `cwd`, reject unreadable paths with `expected` stating the path must name a readable YAML file and the message containing the path as given, and never read or record `ce.yml` or `.ce.yml`.
    - Parsing: `YAML.parse(text, { schema: 'core' })`, treat empty or comment-only content as `{}`. Return `{ ok: false, fileError }` with `kind: 'parse'`, `file`, `code`, `message` and `line`/`column` (from `linePos`, only when present) for a `YAMLParseError`. Return `{ ok: false, fileError }` with `kind: 'read'`, `file`, `code: error.code` and `message` for other `fs` errors, including a read failure after a successful `--config` precheck. Neither result has a `path`, `value` or `expected` field. Report a non-mapping root as a `ValidationError` with `path: '(root)'`, `expected: 'mapping'` and `source: 'file'`. The function never throws.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 6.9, 6.19, 6.20_

  - [x] 4.5 Write unit tests for file discovery and parsing
    - File: `packages/ce/src/config/file.test.ts`
    - Cases: only `ce.yml`; only `.ce.yml`; both (ignored one recorded); neither; empty file; comments-only file; malformed YAML (a `ConfigFileError` with `kind: 'parse'`, the file name, a non-empty `code` and `message`, and `line` and `column` when the parser gives them; the result has no `errors` field and the error object has no `path`, `value` or `expected` property; `reportConfigFailure` prints the file name and code, and the run signal is exit code `1`, Requirement 9 criterion 16); scalar and array roots (`ValidationError` with `(root)`, `mapping`); YAML custom tag is not executed; `--config` pointing to another existing file while `ce.yml` exists (`ce.yml` not read, not listed as ignored); missing `--config` file (path `config`, source `flag`, message contains the path as given); relative `--config` resolved against the `cwd` parameter and not `process.cwd()`; empty and whitespace `--config`; simulated `EACCES` yields a `ConfigFileError` with `kind: 'read'` naming the file and the code, with no `path`, `value` or `expected`, not a `ValidationError`.
    - _Requirements: 4.1 to 4.16, 6.9, 6.19, 6.20, 9.2, 9.8, 9.16_

  - [x] 4.6 Implement `env.ts`
    - Export `ENV_KEY_MAP` derived from `ConfigSchema` (not hand-maintained): `CE_` plus the path, with `.` and `-` replaced by `_`, upper-cased, skipping `runtime.fixtures`.
    - Export `readEnvSource(env)` returning `{ values, ignoredNames }`. Coerce numbers, split list-valued keys on commas and trim each item, keep durations and enums as strings. When coercion fails, keep the original text so zod reports it with the original `value`. Names starting with `CE_RUNTIME_FIXTURES` and unknown `CE_` names go to `ignoredNames` and never to `values`.
    - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.11, 5.15, 5.16_

  - [x] 4.7 Write unit tests for `env.ts`
    - File: `packages/ce/src/config/env.test.ts`
    - Name mapping for every key (for example `CE_RUNTIME_MAX_STEPS`, `CE_ASSESSMENT_THRESHOLDS_CLAIM`, `CE_OUTPUT_FAIL_ON`), list splitting with whitespace, number coercion, un-coercible text preserved, `CE_RUNTIME_FIXTURES_X` and `CE_UNKNOWN` ignored and listed, non-`CE_` variables ignored silently.
    - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.11, 5.16_

  - [x] 4.8 Implement `merge.ts`
    - Export `mergeSources({ flags, envValues, fileValues, defaults })` returning `{ merged, sources }`. Merge recursively per leaf path in the order flags, env, file, defaults. Treat the five list-valued keys as whole leaves (replace, never concatenate). Record the supplying source for every leaf path in `sources`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.13, 5.14_

  - [x] 4.9 Write property test for list replacement
    - File: `packages/ce/src/config/properties/p06-list-replacement.test.ts`
    - **Property 6: List-valued keys replace rather than concatenate**
    - **Validates: Requirements 5.6**

  - [x] 4.10 Write unit tests for `merge.ts`
    - File: `packages/ce/src/config/merge.test.ts`
    - The three precedence pairs: flags over env, env over file, file over defaults. A nested object keeps untouched sibling leaves from a lower source. `sources` records the right source per leaf.
    - _Requirements: 5.1 to 5.6, 5.14, 9.1_

- [x] 5. Checkpoint - Ensure typecheck and tests pass
  - Run `npm run typecheck` and `npm test` from the repository root. Ensure both pass, ask the user if questions arise.

- [x] 6. Implement redaction, credential check and `loadConfig`
  - [x] 6.1 Implement `redact.ts`
    - Export `RedactedConfig` (`{ config, meta }`) and `buildRedactedConfig(config, meta, env)`.
    - Secret set: trimmed, non-empty values of `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` from `env`, plus values matched by compiled `context.redact` patterns. Deep-clone `config`, replace Secret substrings in every string leaf with `[REDACTED]`, and attach `meta` as a sibling key. The result is a plain JSON-serializable object, and the function writes no file.
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.10, 7.12, 7.13, 7.14_

  - [x] 6.2 Write property test for redaction and idempotence
    - File: `packages/ce/src/config/properties/p16-redaction.test.ts`
    - **Property 16: Redaction removes every Secret and is idempotent**
    - **Validates: Requirements 7.6, 7.8, 7.9**

  - [x] 6.3 Write property test for JSON round-trip
    - File: `packages/ce/src/config/properties/p17-redacted-roundtrip.test.ts`
    - **Property 17: Redacted_Config round-trips through JSON**
    - **Validates: Requirements 7.7, 7.11**

  - [x] 6.4 Implement `credentials.ts`
    - Export `requireJevCredentials(loaded, env)`. Read `loaded.config.jev?.provider` (falling back to `ConfigDefaults`) and `loaded.meta.sources['jev.provider'] ?? 'default'`. Check only that the matching key is set and non-empty after trimming. On failure return one `ValidationError` with `path: 'jev.provider'`, `value` the provider, `source` the recorded source and `expected` naming `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`. Never put a key value in any error. Do no file I/O, no re-merge and no call to `loadConfig`.
    - _Requirements: 6.10, 6.11, 6.12, 6.13, 6.14, 6.16, 8.2, 8.5_

  - [x] 6.5 Write property test for the Credential_Check
    - File: `packages/ce/src/config/properties/p15-credentials.test.ts`
    - **Property 15: Credential_Check outcome depends only on provider and key presence, and never leaks the key value**
    - **Validates: Requirements 6.12, 6.13, 6.14**

  - [x] 6.6 Write unit tests for the Credential_Check
    - File: `packages/ce/src/config/credentials.test.ts`
    - Missing and empty key for `openrouter` and for `typesafe` fail, name the variable and do not contain a key value; a present key succeeds. Four cases with `jev.provider` supplied by flag, `CE_JEV_PROVIDER`, the Config_File and defaults, each with the key missing: the failure `source` is `flag`, `env`, `file`, `default`, and the output of `formatReport` contains that source name. A spy test shows `requireJevCredentials` does not call `fs` or `loadConfig`.
    - _Requirements: 6.10 to 6.16, 9.5, 9.6_

  - [x] 6.7 Implement `loadConfig` in `load.ts`
    - Follow the 11 orchestration steps of the design: discover and parse the file (return `{ ok: false, errors }` early on a `--config` flag error or a non-mapping root, and `{ ok: false, fileError }` early on an unreadable file or invalid YAML, with no `errors` field in that case); split out the `config` flag so it never reaches merge or `ConfigSchema`; reject `runtime.fixtures` in flags (dotted and nested spellings) with `path: 'runtime.fixtures'`, `source: 'flag'` and the "only in ce.yml or .ce.yml" `expected`; `readEnvSource`; validate flags, env and file fragments separately against a deep-partial `ConfigSchema` and tag errors with their source; `mergeSources`; `ConfigSchema.safeParse` on the merge with errors tagged from `sources`; build `meta`; `buildRedactedConfig`; return `{ ok: true, config, meta, redacted }`.
    - Return failures as data and sort `errors` by path. Never throw for invalid configuration, an unreadable file or invalid YAML. Never read `process.env` or `process.cwd()`. Never check provider API keys. Never import `outcome/resolve.ts` or `jev/`.
    - _Requirements: 2.4, 4.1 to 4.16, 5.1 to 5.17, 6.1, 6.4, 6.8, 6.9, 6.10, 6.17, 6.19, 6.20, 7.1, 8.1, 8.3, 8.5, 8.7_

  - [x] 6.8 Add `reportConfigFailure` helper in `errors.ts`
    - Export `reportConfigFailure(failure: LoadFailure, secrets: string[], stderr: { write(text: string): unknown }): 1`. Import `LoadFailure` as a type only. It branches on the failure shape: `errors` present writes `formatReport(failure.errors, secrets)`; `fileError` present writes `formatFileError(failure.fileError)`. A Credential_Check failure (`{ ok: false, errors }`) takes the first branch. Both branches write to the given stream and return exit code `1`. It does not decide an Outcome and does not call `process.exit`; the run pipeline (out of scope) maps the failure to `ERROR` through `outcome/resolve.ts`.
    - _Requirements: 6.5, 6.6, 6.9, 6.15, 6.18, 6.19, 6.20_

  - [x] 6.9 Write property test for `--config` rejection
    - File: `packages/ce/src/config/properties/p04-config-flag.test.ts`
    - **Property 4: Non-existent or blank `--config` paths are always rejected the same way**
    - **Validates: Requirements 4.14, 4.15**

  - [x] 6.10 Write property test for precedence and source attribution
    - File: `packages/ce/src/config/properties/p05-precedence.test.ts`
    - **Property 5: Precedence and source attribution hold per leaf key**
    - Generate valid fragments for flags, env (as text), and file; run through `loadConfig` and assert per-leaf values and `meta.sources`.
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.13, 5.14**

  - [x] 6.11 Write property test for env mapping and coercion
    - File: `packages/ce/src/config/properties/p07-env-roundtrip.test.ts`
    - **Property 7: Environment variable mapping and type coercion round-trip**
    - **Validates: Requirements 5.7, 5.8, 5.9**

  - [x] 6.12 Write property test for untypeable text
    - File: `packages/ce/src/config/properties/p08-untypeable-text.test.ts`
    - **Property 8: Untypeable environment or flag text is always rejected with the offending text preserved**
    - **Validates: Requirements 5.10**

  - [x] 6.13 Write property test for ignored `CE_` variables
    - File: `packages/ce/src/config/properties/p09-ignored-env.test.ts`
    - **Property 9: Unknown and fixtures-prefixed `CE_` variables are always ignored and recorded, never applied**
    - **Validates: Requirements 5.11, 5.16**

  - [x] 6.14 Write property test for `runtime.fixtures` in flags
    - File: `packages/ce/src/config/properties/p10-fixtures-flags.test.ts`
    - **Property 10: `runtime.fixtures` is never accepted from flags**
    - **Validates: Requirements 5.15, 5.17**

  - [x] 6.15 Write property test for error reporting
    - File: `packages/ce/src/config/properties/p11-error-reporting.test.ts`
    - **Property 11: Every violation is reported, sorted, and never thrown**
    - Generate syntactically valid configs with one or more schema violations. Assert `loadConfig` never throws, returns `ok: false` with at least one `ValidationError` per distinct violation (non-empty `path`, `value`, `expected`), `errors` sorted by `path`, and no `config` field. Invalid YAML syntax and unreadable files are out of this property's generator and are covered by Property 18.
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.8, 6.17**

  - [x] 6.16 Write property test for missing provider keys
    - File: `packages/ce/src/config/properties/p13-no-key-no-failure.test.ts`
    - **Property 13: Config_Loader never fails on a missing provider API key**
    - **Validates: Requirements 6.10**

  - [x] 6.17 Write property test for `output.fail-on` on failed configuration
    - File: `packages/ce/src/config/properties/p14-fail-on-irrelevant.test.ts`
    - **Property 14: `output.fail-on` is irrelevant to a failed configuration's outcome signal**
    - For an invalid configuration, any `output.fail-on` value from any single source gives `ok: false` with at least one `ValidationError` in `errors`. For an unreadable or invalid-YAML Config_File, the result is `ok: false` with a `fileError` whatever `output.fail-on` is in Flags or the Environment.
    - **Validates: Requirements 6.18, 6.19, 6.20**

  - [x] 6.20 Write property test for invalid YAML and unreadable files
    - File: `packages/ce/src/config/properties/p18-file-error.test.ts`
    - **Property 18: Invalid YAML syntax is always a file error, never a Validation_Error**
    - Generate invalid YAML from known-bad constructs (unclosed flow collection, bad indentation, duplicate mapping key, tab indentation) combined with arbitrary key names, written to a temporary directory as `ce.yml` or `.ce.yml`. Assert `loadConfig` returns `{ ok: false, fileError }` with `kind: 'parse'`, a `file` containing the file name, non-empty `code` and `message`, and no `errors` or `config` field. Assert `reportConfigFailure` prints text that contains the file name and the code and no `path`, `value` or `expected` entry, and returns `1`. Repeat for an unreadable file with `kind: 'read'`.
    - **Validates: Requirements 4.6, 6.9, 6.19, 6.20, 9.16**

  - [x] 6.18 Write unit tests for `loadConfig`
    - File: `packages/ce/src/config/load.test.ts`
    - Three precedence pairs end to end (flag over env, env over file, file over default). Empty `env`, no file: success and equal to `ConfigDefaults`, with or without provider keys in `env`. `config` has no `meta` key; `redacted.meta.sources['jev.provider']` exists and no Secret appears in `JSON.stringify(redacted)`. `redacted` records `jev.provider` and the credential variable name, not the value. `runtime.fixtures`: accepted in file, `CE_RUNTIME_FIXTURES_X` ignored and listed in `meta.ignoredEnvNames`, rejected in flags. Config_Flag cases (a) to (d) of Requirement 9 criterion 8, including that a missing `--config` file does not fall back to an existing `ce.yml`. Multiple violations are reported together, sorted. `EACCES` returns `{ ok: false, fileError }` with `kind: 'read'`. Malformed YAML returns `{ ok: false, fileError }` with `kind: 'parse'`, no `errors` field and no `path`, `value` or `expected` property (Requirement 9 criterion 16). A spy shows `process.env` and `process.cwd` are not read when `env` and `cwd` are given.
    - _Requirements: 2.4, 4.x, 5.x, 6.1 to 6.9, 7.1, 7.5, 8.3, 9.1, 9.2, 9.4, 9.7, 9.8, 9.9, 9.13_

  - [x] 6.19 Write wiring tests for stderr and exit code
    - File: `packages/ce/src/config/load.exit.test.ts`
    - For an invalid config supplied by the file, by flags and by `env`, each combined with `output.fail-on` values `[]`, `[error]` and `[unsupported]`: `loadConfig` returns `ok: false`, `reportConfigFailure` writes the report to a fake stderr, and the returned code is `1`. Include a Credential_Check failure with the same assertion. Assert the report prints a Secret value as `[REDACTED]`.
    - Add the file-error branch: a `ce.yml` with malformed YAML and an unreadable file (mocked `EACCES`), each combined with the same three `output.fail-on` values, give `{ ok: false, fileError }`; `reportConfigFailure` writes the `formatFileError` text (file name and code, no path/value/expected) to the fake stderr and returns `1`.
    - _Requirements: 6.5, 6.6, 6.9, 6.15, 6.18, 6.19, 6.20, 9.10, 9.16_

- [x] 7. Generate the JSON Schema
  - [x] 7.1 Implement `json-schema.ts`
    - Export `generateJsonSchema()` that calls `z.toJSONSchema(ConfigSchema, { target: 'draft-7', io: 'input' })` and adds `description` text to `context.redact` items and to `target.url` stating that the generated schema is looser than `ConfigSchema` on these rules and that `ConfigSchema` is authoritative.
    - _Requirements: 3.2, 3.3, 3.7, 3.8_

  - [x] 7.2 Implement the generator script and commit the artifact
    - Create `packages/ce/src/scripts/generate-config-schema.ts`. Serialize with `JSON.stringify(schema, null, 2) + '\n'` and write `schemas/ce.schema.json` at the repository root (resolve the path from the script location).
    - Run `npm run generate:config-schema --workspace` for the `ce` package and commit the generated `schemas/ce.schema.json`.
    - _Requirements: 3.1, 3.4_

  - [x] 7.3 Write property test for JSON Schema and zod consistency
    - File: `packages/ce/src/config/properties/p03-json-schema-consistency.test.ts`
    - **Property 3: JSON Schema and Config_Schema agree, within the two documented exceptions**
    - Use ajv against the generated schema and zod against `ConfigSchema`. The generator must emit only compilable `context.redact` items and only `http`/`https` URLs, and must produce both valid and invalid configs.
    - **Validates: Requirements 3.6, 3.9**

  - [x] 7.4 Write unit tests for the generated schema
    - File: `packages/ce/src/config/json-schema.test.ts`
    - Every key of Requirement 1 criterion 1 is declared; `additionalProperties` is `false` on every closed object; two generator runs are byte-identical; the two `description` fields exist; the staleness test compares the committed `schemas/ce.schema.json` to a fresh generation and fails with `schemas/ce.schema.json is stale — run "npm run generate:config-schema" and commit the result`.
    - _Requirements: 3.1 to 3.5, 3.7, 3.8_

- [x] 8. Expose the public API
  - [x] 8.1 Export from `packages/ce/src/index.ts`
    - Export `loadConfig`, `requireJevCredentials`, and the types `EffectiveConfig`, `ConfigMeta` and `LoadedConfig`. Keep existing exports.
    - _Requirements: 8.1, 8.2, 8.4, 8.6_

  - [x] 8.2 Write unit test for the public API
    - File: `packages/ce/src/config/index.test.ts`
    - Import from `../index.js` and assert `loadConfig` and `requireJevCredentials` are functions, and that the three types compile through a type-level assertion.
    - _Requirements: 8.4, 8.6_

- [x] 9. Checkpoint - Ensure typecheck and tests pass
  - Run `npm run typecheck` and `npm test` from the repository root. Ensure both pass, ask the user if questions arise.

- [-] 10. Verify issue #4 acceptance criteria and open the pull request
  - Gate A, `all_tasks_complete` (hard gate, checked first and on its own): read `.kiro/specs/ce-config-loader/tasks.md` and confirm every implementation task (1 to 9 and all their sub-tasks that are not marked optional, plus any optional sub-task the team chose to do) is checked complete. Do this by reading the task list, not by inferring it from passing tests. If any implementation task is incomplete, stop here: do not open the pull request, even if the verification below, the build and every test pass. Record the result of this gate.
  - Gate B, `verification_1_and_2_passed` (separate from Gate A): the verification of issue #4 criteria 1 and 2 below. Passing Gate B never substitutes for Gate A.
  - Open the pull request only when both Gate A and Gate B hold.
  - Run `npm install`, `npm run build`, `npm run typecheck` and `npm test` from the repository root. All must pass. If any step fails, fix the cause and re-run before continuing.
  - Verify each acceptance criterion of issue #4 and record evidence (test name, file path or command output):
    1. Zod schema and generated `schemas/ce.schema.json`: `packages/ce/src/config/schema.ts`, `packages/ce/src/config/json-schema.ts`, the committed `schemas/ce.schema.json`, and the passing staleness test in `json-schema.test.ts`.
    2. Loading with precedence flags > env > file > defaults: the passing Property 5 test (`p05-precedence.test.ts`) and the three precedence-pair unit tests in `merge.test.ts` and `load.test.ts`.
    3. Validation errors with path, value and expected shape resolving to `ERROR`: the passing Property 11 test (`p11-error-reporting.test.ts`) and the exit-code tests in `load.exit.test.ts` (exit code `1`, report on stderr).
    4. Effective configuration with secrets removed: the passing Property 16 and Property 17 tests and `packages/ce/src/config/redact.ts`.
  - Verify the "Done when" condition of issue #4 (unit tests cover precedence and invalid configs) by naming the test files `merge.test.ts`, `load.test.ts`, `file.test.ts` and `errors`-related tests (`p12-report-redaction.test.ts`, `p11-error-reporting.test.ts`, `p18-file-error.test.ts`, `schema.test.ts`). Confirm they ran and passed in the `npm test` output.
  - Create a feature branch from `main`, stage only files from this feature by name (never `.env`), and commit. Push the branch and open a pull request against `main` of `rfxlamia/ce` with `gh pr create --base main`.
  - The PR body MUST contain the line `Closes #4` and the four acceptance criteria with their recorded evidence. It MUST NOT contain any API key or other secret value.
  - Do NOT merge the pull request and do NOT close issue #4 manually. GitHub closes it when the PR is merged.
  - If the push or `gh pr create` fails because of authentication or permissions, stop and report the exact error instead of working around it.
  - _Requirements: 9.14, 9.15, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP. Requirement 9 asks for them, so skip them only knowingly.
- Each task references specific requirement clauses for traceability. Properties 1 to 18 each map to exactly one task: P1 2.5, P2 2.3, P3 7.3, P4 6.9, P5 6.10, P6 4.9, P7 6.11, P8 6.12, P9 6.13, P10 6.14, P11 6.15, P12 4.3, P13 6.16, P14 6.17, P15 6.5, P16 6.2, P17 6.3, P18 6.20.
- Property 11 covers schema violations reported as `ValidationError`s (Requirements 6.1 to 6.4, 6.8, 6.17). Property 14 covers both failure shapes: `errors` for invalid configuration and `fileError` for an unreadable or invalid-YAML Config_File (Requirements 6.18 to 6.20). Property 18 covers the `fileError` shape itself (Requirements 4.6, 6.9, 6.19, 6.20, 9.16).
- Malformed YAML and unreadable files are `ConfigFileError`s, a separate type from `ValidationError`, returned as `LoadFailure` `{ ok: false, fileError }`. They have no `path`, `value` or `expected` field, and `reportConfigFailure` renders them with `formatFileError`.
- Requirement 6 criteria 5, 6 and 18 are about the run pipeline, which is out of scope. This plan covers them with the `reportConfigFailure` helper and its wiring tests, and `config/` never decides an Outcome.
- Task 10 has two separate hard gates before the pull request: `all_tasks_complete` (Requirement 10 criteria 9 and 10) and `verification_1_and_2_passed` (Requirement 10 criterion 3).
- The `ConfigMeta` and result types are declared first in `load.ts` (task 4.1) so that `redact.ts` and `credentials.ts` can import them before `loadConfig` is implemented.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7"] },
    { "id": 4, "tasks": ["2.8"] },
    { "id": 5, "tasks": ["3"] },
    { "id": 6, "tasks": ["4.1"] },
    { "id": 7, "tasks": ["4.2", "4.6", "4.8"] },
    { "id": 8, "tasks": ["4.3", "4.4", "4.7", "4.9", "4.10"] },
    { "id": 9, "tasks": ["4.5"] },
    { "id": 10, "tasks": ["5"] },
    { "id": 11, "tasks": ["6.1", "6.4"] },
    { "id": 12, "tasks": ["6.2", "6.3", "6.5", "6.6", "6.7", "7.1"] },
    { "id": 13, "tasks": ["6.8", "6.9", "6.10", "6.11", "6.12", "6.13", "6.14", "6.15", "6.16", "6.17", "6.18", "7.2"] },
    { "id": 14, "tasks": ["6.19", "6.20", "7.3", "7.4", "8.1"] },
    { "id": 15, "tasks": ["8.2"] },
    { "id": 16, "tasks": ["9"] },
    { "id": 17, "tasks": ["10"] }
  ]
}
```
