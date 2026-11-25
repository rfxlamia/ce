# Requirements Document

## Introduction

This feature implements the configuration layer of Continuous Evidence (CE): GitHub issue #4 in rfxlamia/ce, "[M1] Config: ce.yml schema, loader and precedence" (labels `core`, `dx`; milestone M1 "Otak: konteks & assessment"). It implements R2 of `docs/journal/v0.0/requirements.md` and section 7 of `docs/journal/v0.0/design.md`. `SPEC.md` is normative and wins on any conflict.

The feature delivers four things, matching the four acceptance criteria of the issue:

1. A zod schema covering every key in design section 7, and a generated `schemas/ce.schema.json`.
2. A loader that reads `ce.yml` or `.ce.yml` and merges sources with the precedence flags > environment > file > defaults.
3. Validation errors that report the field path, the offending value and the expected shape, and resolve the run to `ERROR`.
4. An effective (merged) configuration with secrets removed, available to the evidence bundle writer.

Code lives in `packages/ce/src/config/` (`schema.ts`, `load.ts`, `defaults.ts`). Secrets live only in environment variables and never in `ce.yml`. Tests use vitest and fast-check and need no API key.

Assumptions (the design leaves these open):

- Environment variables use the prefix `CE_` followed by the key path in upper snake case, for example `CE_RUNTIME_MAX_STEPS`. Provider API keys keep their own names (`OPENROUTER_API_KEY`, `TYPESAFE_API_KEY`).
- Each configurable key has a CLI flag named after its path in kebab case, for example `--runtime-max-steps`. The flag parser for the CLI is out of scope; this feature accepts already-parsed flag values as an object.
- Durations are strings such as `60s` or `500ms`, as in design section 7.
- Unknown keys are validation errors, so a typo is reported instead of silently ignored.

- `context.redact` items are plain JavaScript RegExp sources, or the form `/pattern/flags`. Design section 7 shows the example `"(?i)token\\s*[:=]\\s*\\S+"`. That inline-flag syntax is not valid in JavaScript (it throws `Invalid group` on Node 22). These requirements replace that example: the equivalent item is `/token\s*[:=]\s*\S+/i`. The journal is not edited, and for this spec these requirements win.
- `loadConfig` validates configuration only and never checks provider API keys. The check for `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` happens in a separate function, `requireJevCredentials`, called when the Jev gateway is created.
- `runtime.fixtures` has free-form keys, so it can be set only from the Config_File. Environment variables and Flags cannot set it.

Out of scope: the CLI command wiring (`ce run`, `ce init`), writing `run.json` and the report (the Evidence bundle issue), the GitHub Action inputs, and the Jev gateway.

## Glossary

- **Config_Loader**: The module in `packages/ce/src/config/load.ts` that finds, reads, merges and validates configuration.
- **Config_Schema**: The zod schema in `packages/ce/src/config/schema.ts`. It is the single source for configuration keys, types and constraints.
- **Config_Defaults**: The default values in `packages/ce/src/config/defaults.ts`.
- **Config_File**: A YAML file named `ce.yml` or `.ce.yml` in the working directory.
- **JSON_Schema_File**: The generated file `schemas/ce.schema.json`.
- **Schema_Generator**: The script that generates the JSON_Schema_File from the Config_Schema.
- **Config_Source**: One of four inputs: CLI flags, environment variables, the Config_File, or Config_Defaults. In `source` fields and in Config_Meta, the four sources are named `flag`, `env`, `file` and `default`.
- **Config_Meta**: The metadata object (`meta`) that `loadConfig` returns next to the Effective_Config. It holds the file read (Requirement 4 criterion 9), the file ignored (criterion 3), the ignored `CE_` environment variable names (Requirement 5 criteria 11 and 16), and `sources`, which maps every leaf key path to its Config_Source (Requirement 5 criterion 14). It holds names and paths only and never holds a Secret. Wherever these requirements say "Effective_Config metadata", they mean the Config_Meta.
- **Loaded_Config**: The success result of `loadConfig`: `{ ok: true, config, meta, redacted }`, where `config` is the Effective_Config, `meta` is the Config_Meta and `redacted` is the Redacted_Config.
- **Config_Flag**: The Flags key `config`, written `--config <path>` on the command line. It names the Config_File and is a loader option. It is not a key of the Config_Schema and does not appear in `meta.sources`.
- **Flags**: Configuration values supplied as parsed CLI options, passed to the Config_Loader as an object.
- **Environment**: The set of environment variables passed to the Config_Loader as an object (defaults to `process.env`).
- **Effective_Config**: The validated configuration after merging all Config_Sources by precedence. Its type is the zod-inferred type of the Config_Schema and carries no metadata.
- **Redacted_Config**: The Effective_Config with all secrets removed, for the Evidence bundle.
- **Secret**: A credential value, namely the value of `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` or a value matching a configured redaction secret.
- **Validation_Error**: A structured error with `path`, `value` and `expected` fields, produced when a configuration value violates the Config_Schema.
- **Config_Error_Report**: The human-readable text that lists every Validation_Error.
- **Redact_Pattern**: One item of `context.redact`. It is either a plain JavaScript RegExp source (for example `token\s*[:=]\s*\S+`) or the delimited form `/pattern/flags` (for example `/token\s*[:=]\s*\S+/i`).
- **Credential_Check**: The function `requireJevCredentials(loaded, env)` that takes the Loaded_Config and verifies the provider API key for its Effective_Config. It reads the Config_Meta to name the source of `jev.provider`. It is called when the Jev gateway is created, not by the Config_Loader.
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC.md section 7.1).
- **Evidence_Bundle**: The output directory `.ce/runs/<id>` written by CE.

## Requirements

### Requirement 1: Configuration schema

**User Story:** As a maintainer, I want one schema that defines every `ce.yml` key, so that configuration is validated consistently and documented in one place.

#### Acceptance Criteria

1. THE Config_Schema SHALL define every key listed in design section 7: `version`, `target.url`, `target.start`, `target.ready.path`, `target.ready.timeout`, `target.routes`, `context.base`, `context.include`, `context.exclude`, `context.redact`, `context.checks`, `assessment.thresholds.claim`, `assessment.thresholds.observable`, `assessment.thresholds.adequate`, `assessment.uncertainty-band`, `assessment.on-uncertain`, `runtime.max-steps`, `runtime.timeout`, `runtime.viewport.width`, `runtime.viewport.height`, `runtime.fixtures`, `jev.provider`, `jev.model`, `output.dir` and `output.fail-on`.
2. THE Config_Schema SHALL treat every key as optional.
3. THE Config_Schema SHALL accept only the value `0` for `version`.
4. THE Config_Schema SHALL constrain `assessment.thresholds.claim`, `assessment.thresholds.observable`, `assessment.thresholds.adequate` and `assessment.uncertainty-band` to numbers from 0 to 1 inclusive.
5. THE Config_Schema SHALL constrain `assessment.on-uncertain` to `evidence` or `skip`.
6. THE Config_Schema SHALL constrain `jev.provider` to `openrouter` or `typesafe`.
7. THE Config_Schema SHALL constrain `output.fail-on` to a list whose items are `error`, `unsupported` or `evidenced-not-reached`.
8. THE Config_Schema SHALL constrain `runtime.max-steps`, `runtime.viewport.width` and `runtime.viewport.height` to positive integers.
9. THE Config_Schema SHALL constrain `target.ready.timeout` and `runtime.timeout` to duration strings made of a positive integer and one of the units `ms`, `s` or `m`.
10. THE Config_Schema SHALL constrain `target.url` to an absolute `http` or `https` URL.
11. THE Config_Schema SHALL constrain each item of `context.redact` to a Redact_Pattern that `new RegExp` can compile.
12. IF a configuration object contains a key that the Config_Schema does not define, THEN THE Config_Loader SHALL produce a Validation_Error for that key.
13. IF a configuration object contains a key that names a credential, namely a key whose name contains `api-key`, `apikey`, `secret`, `token` or `password` outside of `context.redact` and `runtime.fixtures`, THEN THE Config_Loader SHALL produce a Validation_Error that states that secrets belong in environment variables.
14. WHEN an item of `context.redact` has the form `/pattern/flags`, THE Config_Loader SHALL compile the item with `new RegExp(pattern, flags)`, so that `/token\s*[:=]\s*\S+/i` matches `TOKEN: abc` case-insensitively.
15. WHEN an item of `context.redact` does not have the form `/pattern/flags`, THE Config_Loader SHALL compile the whole item with `new RegExp(item)` as a plain RegExp source.
16. IF an item of `context.redact` begins with `(?i)` or another inline-flag group that JavaScript does not support, THEN THE Config_Loader SHALL produce a Validation_Error whose `path` is `context.redact` with the item index, whose `value` is the item, and whose `expected` field names the format `/pattern/i`.
17. IF an item of `context.redact` fails to compile with `new RegExp` for any other reason, THEN THE Config_Loader SHALL produce a Validation_Error whose `path` is `context.redact` with the item index, whose `value` is the item, and whose `expected` field states that the item must be a JavaScript RegExp source or the form `/pattern/flags`.

### Requirement 2: Defaults

**User Story:** As a developer, I want CE to run without a configuration file, so that adoption needs no setup.

#### Acceptance Criteria

1. THE Config_Defaults SHALL provide a value for every key of the Config_Schema that has a default in design section 7: `version` 0, `assessment.thresholds` (claim 0.6, observable 0.6, adequate 0.7), `assessment.uncertainty-band` 0.1, `assessment.on-uncertain` `evidence`, `runtime.max-steps` 12, `runtime.timeout` `90s`, `runtime.viewport` 1280 by 800, `jev.provider` `openrouter`, `jev.model` `typesafe/jev-1.14`, `output.dir` `.ce/runs` and `output.fail-on` `[error]`.
2. WHERE a key has no default in design section 7 (`target.url`, `target.start`, `target.ready`, `target.routes`, `context.*`, `runtime.fixtures`), THE Config_Defaults SHALL leave that key unset.
3. THE Config_Defaults SHALL pass validation against the Config_Schema without modification.
4. WHEN no Config_File exists and no flag or environment variable is set, THE Config_Loader SHALL return an Effective_Config equal to the Config_Defaults, whether or not any provider API key is set in the Environment.

### Requirement 3: Generated JSON Schema

**User Story:** As a maintainer, I want editors to autocomplete and validate `ce.yml`, so that mistakes are caught while typing.

#### Acceptance Criteria

1. WHEN the Schema_Generator runs, THE Schema_Generator SHALL write the JSON_Schema_File at `schemas/ce.schema.json` from the Config_Schema.
2. THE JSON_Schema_File SHALL declare every key listed in Requirement 1 criterion 1, with the same types, enumerations, numeric ranges and required-ness as the Config_Schema.
3. THE JSON_Schema_File SHALL set `additionalProperties` to `false` on every object that the Config_Schema declares as closed.
4. WHEN the Schema_Generator runs twice on the same Config_Schema, THE Schema_Generator SHALL write byte-identical output.
5. WHEN the Config_Schema changes and the committed JSON_Schema_File is not regenerated, THE test suite SHALL fail with a message that names the stale file.
6. FOR ALL configuration objects that violate neither exception in criterion 7, validating the object with the JSON_Schema_File and with the Config_Schema SHALL give the same accept or reject result. This covers every rule that JSON Schema can express: type, enumeration, numeric range, required-ness and `additionalProperties` (consistency property).
7. THE JSON_Schema_File MAY be looser than the Config_Schema on exactly two rules, and the Config_Schema SHALL be the authority for validation on both: (a) each item of `context.redact` compiles as a RegExp (Requirement 1 criterion 11), and (b) `target.url` uses only the `http` or `https` scheme (Requirement 1 criterion 10).
8. THE Schema_Generator SHALL document in the JSON_Schema_File `description` fields of `context.redact` and `target.url` that the generated schema is looser than the Config_Schema on these two rules.
9. THE fast-check generator used for the consistency property SHALL NOT produce an item of `context.redact` that fails to compile as a RegExp, and SHALL NOT produce a `target.url` with a scheme other than `http` or `https`.

### Requirement 4: Config file discovery and parsing

**User Story:** As a maintainer, I want CE to find my configuration file by its conventional name, so that I do not pass a path every time.

#### Acceptance Criteria

1. WHEN the Config_Flag is not given and `ce.yml` exists in the working directory, THE Config_Loader SHALL read `ce.yml` as the Config_File.
2. WHEN the Config_Flag is not given, `ce.yml` does not exist and `.ce.yml` exists in the working directory, THE Config_Loader SHALL read `.ce.yml` as the Config_File.
3. WHEN the Config_Flag is not given and both `ce.yml` and `.ce.yml` exist in the working directory, THE Config_Loader SHALL read `ce.yml` and record in the Config_Meta that `.ce.yml` was ignored.
4. WHEN the Config_Flag is not given and neither file exists, THE Config_Loader SHALL continue with the remaining Config_Sources and report no error.
5. WHEN the Config_File is empty or contains only comments, THE Config_Loader SHALL treat the Config_File as an empty configuration.
6. IF the Config_File exists and can be read but contains invalid YAML syntax, THEN THE Config_Loader SHALL return a failure result that is reported under Requirement 6 criteria 19 and 20, as a parse error and not as a Validation_Error.
7. IF the root of the Config_File is not a mapping, THEN THE Config_Loader SHALL produce a Validation_Error with the path `(root)`, the offending value and the expected shape `mapping`.
8. THE Config_Loader SHALL parse the Config_File using the YAML 1.2 core schema, with no custom tags and no code execution.
9. THE Config_Loader SHALL record in the Config_Meta the path of the Config_File that was read, or `null` when none was read.
10. THE Config_Loader SHALL read the working directory from an explicit `cwd` parameter and SHALL NOT read any file outside the working directory except the file named by the Config_Flag.
11. WHEN the Config_Flag is given with a path, THE Config_Loader SHALL read that file as the only Config_File, in place of the discovery of `ce.yml` and `.ce.yml`.
12. WHEN the Config_Flag is given, THE Config_Loader SHALL NOT read `ce.yml` or `.ce.yml`, SHALL NOT record either of them as ignored in the Config_Meta, and SHALL NOT fall back to either of them.
13. WHEN the Config_Flag holds a relative path, THE Config_Loader SHALL resolve the path against the `cwd` parameter. WHEN the Config_Flag holds an absolute path, THE Config_Loader SHALL use the path as given.
14. IF the file named by the Config_Flag does not exist or cannot be read, THEN THE Config_Loader SHALL return a failure result with a Validation_Error whose `path` is `config`, whose `value` is the path as given, whose `source` is `flag` and whose `expected` field states that the path must name a readable YAML file, and the message SHALL contain the path as given. The run SHALL resolve to the Outcome `ERROR` with exit code `1` (Requirement 6 criterion 18). This criterion takes precedence over Requirement 6 criterion 9 for the Config_Flag.
15. IF the Config_Flag is given with an empty string or a string of only whitespace, THEN THE Config_Loader SHALL return a failure result with a Validation_Error whose `path` is `config`, whose `value` is the given text, whose `source` is `flag` and whose `expected` field states that the path must be non-empty.
16. WHEN the Config_Flag names a file that exists, THE Config_Loader SHALL record that path in the Config_Meta as the file read, as in criterion 9, and SHALL parse the file under criteria 5 to 8.

### Requirement 5: Source precedence

**User Story:** As a maintainer, I want a predictable order between flags, environment, file and defaults, so that I can override a setting for one run without editing the file.

#### Acceptance Criteria

1. THE Config_Loader SHALL merge Config_Sources in the order Flags, Environment, Config_File, Config_Defaults, where an earlier source overrides a later source.
2. WHEN a key is set in both Flags and Environment, THE Config_Loader SHALL use the Flags value.
3. WHEN a key is set in both Environment and the Config_File, THE Config_Loader SHALL use the Environment value.
4. WHEN a key is set in both the Config_File and Config_Defaults, THE Config_Loader SHALL use the Config_File value.
5. THE Config_Loader SHALL resolve precedence per leaf key, so that a nested object set in a lower-precedence source keeps its other leaf keys.
6. WHEN a list-valued key (`target.routes`, `context.include`, `context.exclude`, `context.redact`, `output.fail-on`) is set in a higher-precedence source, THE Config_Loader SHALL replace the whole list and SHALL NOT concatenate lists across sources.
7. THE Config_Loader SHALL read the environment variable named `CE_` followed by the key path in upper snake case for every key of the Config_Schema except `runtime.fixtures`, where `-` and `.` in the path become `_`.
8. WHEN an environment variable holds a list-valued key, THE Config_Loader SHALL split the value on commas and trim whitespace around each item.
9. WHEN an environment variable or flag holds a numeric or duration key as text, THE Config_Loader SHALL convert the text to the type that the Config_Schema declares before validation.
10. IF an environment variable or flag text cannot be converted to the declared type, THEN THE Config_Loader SHALL produce a Validation_Error whose `path` is the key path and whose `value` is the original text.
11. THE Config_Loader SHALL ignore environment variables that start with `CE_` but name no key of the Config_Schema, and SHALL list their names in the Config_Meta.
12. THE Config_Loader SHALL validate the merged result, and SHALL validate each Config_Source before merging so that the Validation_Error names the Config_Source that supplied the invalid value.
13. FOR ALL pairs of configuration objects (high, low) that are valid, THE Config_Loader SHALL give an Effective_Config in which every leaf key set in high equals the value in high (precedence property).
14. THE Config_Loader SHALL record in `meta.sources`, for every leaf key path of the Effective_Config, the Config_Source (`flag`, `env`, `file` or `default`) that supplied its value.
15. THE Config_Loader SHALL accept `runtime.fixtures` only from the Config_File and Config_Defaults.
16. THE Config_Loader SHALL ignore every environment variable whose name starts with `CE_RUNTIME_FIXTURES`, SHALL NOT apply its value to any key, and SHALL list its name in the Config_Meta together with the unknown `CE_` names of criterion 11, marked as ignored.
17. IF the Flags object contains the key `runtime.fixtures`, THEN THE Config_Loader SHALL produce a Validation_Error with the path `runtime.fixtures`, the offending value, the source `flag` and an `expected` field that states that `runtime.fixtures` can be set only in `ce.yml` or `.ce.yml`.

### Requirement 6: Validation errors and the ERROR outcome

**User Story:** As a developer, I want a clear message when my configuration is wrong, so that I can fix the exact field without reading the schema.

#### Acceptance Criteria

1. IF the merged configuration violates the Config_Schema, THEN THE Config_Loader SHALL return a failure result that contains one Validation_Error for each violation.
2. THE Validation_Error SHALL contain a `path` field with the dotted key path (for example `assessment.thresholds.claim`), a `value` field with the offending value, an `expected` field with the expected shape in words (for example `number between 0 and 1`), and a `source` field with the Config_Source name.
3. THE Config_Error_Report SHALL print, for every Validation_Error, one entry that contains the path, the value and the expected shape.
4. WHEN the Config_Loader finds several violations, THE Config_Loader SHALL report all of them in one Config_Error_Report, in stable order sorted by path.
5. WHEN the Config_Loader returns a failure result, THE run pipeline SHALL resolve the run to the Outcome `ERROR`.
6. WHEN the Config_Loader returns a failure result, THE Config_Error_Report SHALL be written to standard error, and THE CE process SHALL exit with code `1`, the code that design section 6 defines for `ERROR`.
7. WHEN the Config_Loader returns a failure result and the offending value matches a Secret, THE Config_Error_Report SHALL print the value as `[REDACTED]`.
8. THE Config_Loader SHALL return a failure result as data and SHALL NOT throw for any input that is invalid configuration.
9. IF the Config_Loader fails for a reason other than invalid configuration (for example the Config_File cannot be read because of permissions), THEN THE Config_Loader SHALL return a failure result with a file error that names the file and carries the system error code and message, and the run SHALL resolve to the Outcome `ERROR`. The file error is not a Validation_Error and has no `path`, `value` or `expected` field.
10. THE Config_Loader SHALL NOT check whether `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` is set, and SHALL NOT return a failure result because a provider API key is missing.
11. THE Credential_Check `requireJevCredentials(loaded, env)` SHALL take the Loaded_Config (the success result of `loadConfig`, with `config` and `meta`) and the Environment, and SHALL NOT reload or re-merge the configuration.
12. IF `jev.provider` is `openrouter` and `OPENROUTER_API_KEY` is not set or is empty in the Environment, THEN THE Credential_Check SHALL return a failure result with a Validation_Error that has the path `jev.provider`, the value `openrouter`, a `source` equal to `loaded.meta.sources['jev.provider']` (`flag`, `env`, `file` or `default`) and an `expected` field that names `OPENROUTER_API_KEY`, and the Config_Error_Report entry SHALL print that source.
13. IF `jev.provider` is `typesafe` and `TYPESAFE_API_KEY` is not set or is empty in the Environment, THEN THE Credential_Check SHALL return a failure result with a Validation_Error that has the path `jev.provider`, the value `typesafe`, a `source` equal to `loaded.meta.sources['jev.provider']` (`flag`, `env`, `file` or `default`) and an `expected` field that names `TYPESAFE_API_KEY`, and the Config_Error_Report entry SHALL print that source.
14. THE Credential_Check SHALL NOT include the value of any API key in a Validation_Error, a report or a log.
15. WHEN the Credential_Check returns a failure result, THE run pipeline SHALL resolve the run to the Outcome `ERROR`, THE Config_Error_Report format of criterion 3 SHALL be used for the message, and THE CE process SHALL exit with code `1`.
16. WHEN the API key for the selected `jev.provider` is set in the Environment, THE Credential_Check SHALL return a success result.
17. FOR ALL invalid configuration objects, THE Config_Loader SHALL return a failure result with at least one Validation_Error and SHALL NOT return an Effective_Config (error property).
18. IF the Config_Loader returns a failure result because the configuration is invalid, the Config_File cannot be read (criterion 9), or the Config_File is not valid YAML (criteria 19 and 20), THEN THE CE process SHALL resolve the Outcome to `ERROR` and SHALL exit with code `1`, regardless of `output.fail-on` in the Config_File, in Flags or in the Environment, because the failed configuration provides no trusted `output.fail-on` value.
19. IF the Config_File exists and can be read but contains invalid YAML syntax, THEN THE Config_Loader SHALL return a failure result reported in the same format as the unreadable-file report of criterion 9: the file name and the parse error code or message (line and column only when the parser provides them), with the Outcome and exit code of criterion 18.
20. THE parse error report of criterion 19 SHALL NOT contain a `path`, `value` or `expected` field.

### Requirement 7: Effective configuration for the Evidence bundle

**User Story:** As a reviewer, I want to see the exact configuration a run used, without credentials, so that I can reproduce and audit the run safely.

#### Acceptance Criteria

1. WHEN the Config_Loader succeeds, THE Config_Loader SHALL return the Effective_Config, the Config_Meta and the Redacted_Config together, as the Loaded_Config.
2. THE Redacted_Config SHALL contain every key of the Effective_Config with its resolved value, except values that are Secrets.
3. THE Redacted_Config SHALL NOT contain the value of `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` in any key, any value or any metadata field.
4. THE Redacted_Config SHALL contain no credential values at all, because the Config_Schema defines no key that holds a credential.
5. THE Redacted_Config SHALL record `jev.provider` and the name of the environment variable that supplies the credential (`OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`), and SHALL NOT record the credential value.
6. WHEN any string value in the Effective_Config contains a Secret as a substring, THE Config_Loader SHALL replace that substring with `[REDACTED]` in the Redacted_Config.
7. THE Redacted_Config SHALL be a plain JSON-serializable object.
8. FOR ALL Effective_Configs and Secret values, serializing the Redacted_Config to JSON SHALL give text that contains no Secret as a substring (redaction property).
9. FOR ALL Effective_Configs, THE redaction operation applied to a Redacted_Config SHALL give an equal Redacted_Config (idempotence property).
10. THE Config_Loader SHALL expose the Redacted_Config through a function that the Evidence bundle writer can call, and SHALL NOT write any file itself.
11. FOR ALL Redacted_Configs, serializing to JSON and parsing the result SHALL give an equal object (round-trip property).
12. THE Redacted_Config SHALL include the Config_Meta, under the key `meta`, with the content from Requirement 4 criteria 3 and 9 and Requirement 5 criteria 11, 14 and 16: the file read, the file ignored, the ignored environment variable names, and the source of every leaf key. The Redacted_Config SHALL therefore record the source of `jev.provider`.
13. THE Config_Meta SHALL contain only key paths, file paths, environment variable names and the four source names, and SHALL NOT contain any environment variable value, so that the Config_Meta holds no Secret.
14. THE Effective_Config object SHALL NOT contain the Config_Meta, and the Redacted_Config SHALL keep the resolved configuration values under the key `config` and the Config_Meta under the key `meta`.

### Requirement 8: Public API and boundaries

**User Story:** As a contributor, I want a small, pure configuration interface, so that later modules can depend on it and tests need no real environment.

#### Acceptance Criteria

1. THE Config_Loader SHALL export a function `loadConfig` that takes `{ cwd, flags, env }` and returns a result of the shape `{ ok: true, config, meta, redacted }` (the Loaded_Config) or a failure result, where `config` is the Effective_Config, `meta` is the Config_Meta and `redacted` is the Redacted_Config. The failure result has one of two shapes: `{ ok: false, errors }` for invalid configuration (Validation_Errors), or `{ ok: false, fileError }` when the Config_File cannot be read or contains invalid YAML syntax (Requirement 6 criteria 9, 19 and 20). A `fileError` result carries no `errors` field, and an `errors` result carries no `fileError` field. The `fileError` is a file error of the form `{ kind, file, code, message, line?, column? }`, not a Validation_Error.
2. THE Config_Loader SHALL export a function `requireJevCredentials` that takes `(loaded, env)`, where `loaded` is the Loaded_Config returned by `loadConfig`, and returns `{ ok: true }` or `{ ok: false, errors }`, with `errors` in the Validation_Error format of Requirement 6.
3. THE Config_Loader SHALL take the Environment, the Flags and the working directory as parameters and SHALL NOT read `process.env` or `process.cwd()` when those parameters are given.
4. THE Config_Loader SHALL export the Effective_Config type inferred from the Config_Schema, without any metadata field, so that later modules use one type. THE Config_Loader SHALL export the Config_Meta type and the Loaded_Config type separately.
5. THE Config_Loader and the Credential_Check SHALL NOT call the network, Git or any Jev gateway.
6. THE `packages/ce` package SHALL export `loadConfig`, `requireJevCredentials`, the Effective_Config type, the Config_Meta type and the Loaded_Config type from `src/index.ts`.
7. THE Config_Loader SHALL accept the Config_Flag as the optional string key `config` of the `flags` parameter.

### Requirement 9: Test coverage

**User Story:** As a maintainer, I want tests that prove precedence and invalid-config handling, so that the loader stays correct as keys are added.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests, run by vitest, that cover each of the three precedence pairs of Requirement 5 criteria 2 to 4.
2. THE test suite SHALL include a unit test for each Validation_Error category: wrong type, out-of-range number, invalid enumeration value, malformed duration, invalid URL, invalid regular expression, unknown key, credential-named key and non-mapping root. Malformed YAML is not a Validation_Error category and is covered by criterion 16.
3. THE test suite SHALL include unit tests for `context.redact`: a plain RegExp source such as `token\s*[:=]\s*\S+` is accepted, the form `/token\s*[:=]\s*\S+/i` is accepted and matches `TOKEN: abc`, and the item `(?i)token\s*[:=]\s*\S+` is rejected with a Validation_Error whose `expected` field names `/pattern/i`.
4. THE test suite SHALL include unit tests for `runtime.fixtures`: a value in the Config_File is accepted, an environment variable `CE_RUNTIME_FIXTURES_X` is ignored and listed in the Config_Meta, and a `runtime.fixtures` key in Flags is rejected.
5. THE test suite SHALL include unit tests for the Credential_Check, called with the Loaded_Config from `loadConfig`: a missing or empty key for `openrouter` and for `typesafe` returns a failure result that names the environment variable and does not contain the key value, and a present key returns success.
6. THE test suite SHALL include a unit test for each of the four sources of `jev.provider`, with the key missing: WHEN `jev.provider` comes from a flag, from `CE_JEV_PROVIDER`, from the Config_File, or from Config_Defaults, THE Credential_Check failure SHALL carry `source` equal to `flag`, `env`, `file` or `default` respectively, and the printed Config_Error_Report entry SHALL contain that source name.
7. THE test suite SHALL include a unit test that the Effective_Config returned by `loadConfig` has no `meta` key, and that the Redacted_Config contains `meta.sources['jev.provider']` and no Secret value.
8. THE test suite SHALL include unit tests for the Config_Flag: (a) with `ce.yml` and a different file given by `--config`, only the `--config` file supplies values, `ce.yml` is not read and is not listed as ignored; (b) with a `--config` path that does not exist, `loadConfig` returns a failure result with a Validation_Error whose `path` is `config` and whose message contains the path as given, the run resolves to `ERROR` with exit code `1`, and the values of an existing `ce.yml` are not used; (c) a relative `--config` path resolves against `cwd`, not against `process.cwd()`; (d) an empty or whitespace-only `--config` value is rejected.
9. THE test suite SHALL include a unit test that `loadConfig` succeeds with an empty `env` and no Config_File and returns the Config_Defaults.
10. THE test suite SHALL include a unit test that an invalid configuration resolves to Outcome `ERROR` with exit code `1` for each of `output.fail-on` values `[]`, `[error]` and `[unsupported]` supplied by the same invalid file, by Flags and by the Environment.
11. THE test suite SHALL include fast-check property tests for the precedence property, the error property, the redaction property, the idempotence property and the JSON round-trip property named in Requirements 5, 6 and 7.
12. THE test suite SHALL include a fast-check property test for the consistency property of Requirement 3 criterion 6, using a generator that respects Requirement 3 criterion 9.
13. THE test suite SHALL run without any API key set, using only values passed through the `env` parameter.
14. WHEN `npm test` runs from the repository root, THE test suite SHALL pass.
15. WHEN `npm run typecheck` runs from the repository root, THE typecheck SHALL pass.
16. THE test suite SHALL include a unit test that a Config_File with invalid YAML syntax returns a failure result in the unreadable-file format of Requirement 6 criterion 9, containing the file name and the parse error code or message, with no `path`, `value` or `expected` field (Requirement 6 criteria 19 and 20), and that the run resolves to `ERROR` with exit code `1`.

### Requirement 10: Issue acceptance and closing the issue

**User Story:** As the project owner, I want each acceptance criterion of issue #4 verified and the issue closed by the merged pull request, so that the issue board reflects real state.

#### Acceptance Criteria

1. WHEN all implementation tasks are complete, THE implementer SHALL verify each acceptance criterion of issue #4 against the delivered code and record the evidence for each one: a passing test name, a file path or a command output. The four criteria are the zod schema with generated `schemas/ce.schema.json`, file loading with the precedence flags > env > file > defaults, validation errors with path, value and expected shape resolving to `ERROR`, and the effective configuration with secrets removed.
2. WHEN all implementation tasks are complete, THE implementer SHALL verify the "Done when" condition of issue #4: unit tests cover precedence and invalid configs.
3. WHEN all implementation tasks are complete (`all_tasks_complete`) and the verification of criteria 1 and 2 passes (`verification_1_and_2_passed`), THE implementer SHALL open a pull request against `main` of rfxlamia/ce.
4. THE pull request body SHALL contain the line `Closes #4` so that GitHub closes issue #4 when the pull request is merged.
5. THE pull request body SHALL list the four acceptance criteria of issue #4, each with its recorded evidence.
6. THE implementer SHALL NOT merge the pull request and SHALL NOT close issue #4 by hand.
7. IF any verification in criteria 1 or 2 fails, THEN THE implementer SHALL fix the failure before opening the pull request.
8. THE pull request body SHALL NOT contain any API key or other secret value.
9. THE completion of all implementation tasks (`all_tasks_complete`) SHALL be a hard gate for opening the pull request, independent of `verification_1_and_2_passed`.
10. IF any implementation task is not complete, THEN THE implementer SHALL NOT open the pull request, even when the verification of criteria 1 and 2 and every other step has passed.