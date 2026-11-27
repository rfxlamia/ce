# Requirements Document

## Introduction

This feature implements GitHub issue #11 in rfxlamia/ce, "[M3] Evidence bundle, run.json schema, terminal summary" (milestone M3, labels `core` and `dx`). It covers R9 criteria 1 to 3 and 5 of `docs/journal/v0.0/requirements.md` and the data model of section 3 of `docs/journal/v0.0/design.md`. `SPEC.md` is normative (sections 3.5, 4.2, 7.1 and 7.2) and wins on any conflict with this document or the journal.

Today a run leaves only `jev-calls.jsonl`, `target.log` and screenshots in its run directory, and `ce run` prints `Outcome: <outcome>` with a few diagnostic lines. No `run.json` exists, no schema describes it, and an `ERROR` run leaves no record of the failed stage. This feature adds the Evidence_Bundle writer, the Run_Schema, and the Terminal_Summary. The Done condition of the issue is that every outcome (`SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR`) that `run()` returns writes a schema-valid bundle, with one explicit exception. The last-resort `catch` in `runRunCommand` (Requirement 11 criterion 4) fires only if `run()` throws despite its no-throw guarantee. It prints `Outcome: ERROR`, returns exit code 1 and writes no bundle, because a bundle written from `command.ts` would have to assign an Outcome literal outside `outcome/resolve.ts` (F11).

`report.html` is out of scope. The issue does not list it, and the journal assigns it to `evidence/report/`. The Terminal_Summary prints a path to the report location and this feature writes no `report.html`.

### Issue checklist traceability

| Issue checklist item | Requirements |
| --- | --- |
| `.ce/runs/<id>/` contains `run.json`, screenshots, logs, `jev-calls.jsonl` | 1, 2, 9, 10 |
| `schemas/run.schema.json`; bundle validated on write | 3, 4 |
| Minimal bundle on `ERROR` with the failed stage | 5, 11 |
| Terminal summary: outcome first, then claim, rationale, path to report | 8 |
| Done when: every outcome writes a schema-valid bundle | 6, 11 |
| Steering rules (secrets, no state contents, outcome placement) | 7, 9 |

### Facts verified in the code

- F1. `run()` in `packages/ce/src/run/pipeline.ts` computes the run directory as `path.resolve(cwd, config.output.dir ?? '.ce/runs', runDirName(now()))`, where `runDirName` returns `run-<iso>` with `:` and `.` replaced by `-`. It computes the directory after `loadConfig` succeeds and before the credentials check and before `createGateway`. A `loadConfig` failure therefore has no run directory today. A credentials failure (`requireJevCredentials`) and a gateway creation failure (`createGateway` returning `ok: false`) happen after the run directory is known, and `output.dir` is loaded at that point.
- F2. `run()` returns a `ResolvedRun`: `kind`, `outcome`, `reason`, optional `finalState`, `errorStage`, `surface`, `exitCode`, optional `claims`, `assessment`, `error` (a `StageError`) and `capability`. `finishRun` calls `resolveOutcome` through `resolveAfterAssessment` once and attaches `exitCodeFor`. `configFailure()` does the same for all three config-stage failures of F1, always with a `StageError('config')`, the empty capability registry, and `exitCodeFor(resolution, undefined)`, even when the config was loaded. The `Resolution` does not carry the `RuntimeResult`, the `ChangeContext` or the run directory.
- F3. `StageError` has `stage` in `config | context | assessment | runtime | evidence`. Its message holds the stage and the constructor name of the cause only, and never the cause's message. `LoopStageError` additionally carries `partial` (`observations`, `steps`, `eventLog`) gathered before a page crash.
- F4. `createJsonlCallLog` writes `<runDir>/jev-calls.jsonl` lazily, one validated line per Jev call. `CallLogEntrySchema` is a strict zod object with no field for state text, image bytes, question instructions or credentials. It stores a SHA-256 `stateHash` of the state. The file is created by `run()` only when `createGateway` is used. With an injected `options.gateway` no Call_Log is created.
- F5. The browser capability writes screenshots into the run directory and the target writes `<runDir>/target.log` (`TARGET_LOG_FILE`) when it starts the application. `LoopResult` (`runtime/loop.ts`) holds `observations`, `steps` (`StepLogEntry`: observation, action, probabilities, `executed`), `eventLog` (`EventLogEntry`: `step`, `kind` in dialog, download, popup, settle, refusal, and Redactor-output `detail`), `finalScreenshot`, `finalSignals`, `subjectBox`, `finalImageModel`, `finalImageError` and `stopReason`. An `Observation` holds `step`, `url`, `title`, `domDigest`, `elements`, `navigation` and `screenshot`.
- F6. `mapLoopResultToRuntimeResult` returns a `RuntimeResult` whose `evidence` (`EvidenceSummary`) holds the change, the claim (`identified` or `not_identified`), the subject URL, the performed actions (`kind`, `description`), the observations and `artifacts: { runDir, reportPath }`, where `reportPath` is `<runDir>/report.html`. `EvidenceSummary.observations` hold only `{ step, screenshot }`. `RuntimeResult` itself is only `{ finalState, evidence }` (`outcome/types.ts`). `satisfiesMinimumEvidence` checks the SPEC 7.2 items.
- F7. `Assessment.record` holds the question ids, probabilities, `modelIds` (the distinct Returned_Model_Ids of the assessment calls, in order of first appearance), `settings`, `cuts` and the optional `policyDecision`. `Assessment.decidedBy` is `classifier` or `policy`. The model ids of the runtime decide calls and of the final image request are not part of `Assessment.record`. A run that uses only declared claims or only docs can make zero Jev calls.
- F8. `loadConfig` returns `redacted` (a `RedactedConfig`) next to the effective config. `collectSecretValues(env)` and `redactSecretValues(text, secrets)` in `config/secrets.ts` replace secret values with `[REDACTED]`.
- F9. `config/json-schema.ts` generates `schemas/ce.schema.json` from the zod `ConfigSchema` and a staleness test compares the generated text to the committed file. `schemas/` contains only `ce.schema.json`. `ajv` is a dev dependency of `packages/ce`.
- F10. `run/command.ts` prints `Outcome: <outcome>` to stdout, and on the unsupported path prints `Reason` and `Surface` lines. The `ERROR` path writes the stage name and diagnostics to stderr. `runRunCommand` wraps `run()` in `try/catch`; the `catch (thrown)` branch prints `Outcome: ERROR`, writes the constructor name of the thrown value to stderr, returns exit code 1, and writes no bundle.
- F11. `outcome/architecture.test.ts` (rule (d), `OUTCOME_LITERAL_USE`) scans all non-test files under `packages/ce/src/` and fails when a file other than `outcome/resolve.ts` assigns (`outcome: 'X'`), returns (`return 'X'`, `=> 'X'`) or casts (`as 'X'`) to an Outcome literal. A comparison such as `=== 'ERROR'` is allowed. The string `'Outcome: ERROR\n'` written by the `catch` branch of `command.ts` is not matched, because it is not a bare quoted Outcome literal. A Run_Record built in `command.ts` with `outcome: 'ERROR'` would be matched.
- F12. The `evidence/` directory does not exist yet.
- F13. `run()` has no outer `try/catch`. `loadConfig`, `reportConfigFailure`, `requireJevCredentials`, `createGateway`, `selectCapability` and the write of the Call_Log are called outside any `try`, so a throw there escapes `run()` today (F10 catch branch).
- F14. `resolveOutcome` returns `reason` without `errorStage` in three cases, and the pipeline produces them as follows. `assessment-missing`: `finishRun` receives neither an assessment nor an error. `run()` always attaches a `StageError('assessment')` when `assess` throws, so this reason is reachable only through a defect or a direct `finishRun` call. `no-observation` and `evidence-incomplete`: the capability hook returned a `RuntimeResult` with no observations, or with evidence that fails `satisfiesMinimumEvidence`. Both are produced by the runtime stage.
- F15. The comment on `RuntimeHookInput.runDir` in `run/types.ts` ("Absent when no run directory was computed (a gateway was supplied)") is outdated, because `run()` computes the run directory in every case (F1).

- F16. `StopReason` in `runtime/loop.ts` is `'done' | 'reached' | 'give_up' | 'max-steps' | 'time-budget' | 'aborted'`. `LoopResult.stopReason` is always set. `LoopStageError.partial` carries no `stopReason`.
- F17. `config/json-schema.ts` generates JSON Schema with `z.toJSONSchema(schema, { target: 'draft-7', io: 'input', unrepresentable: 'any' })` from zod 4 (installed 4.6.7). A check with this zod version shows that `z.discriminatedUnion` with strict object variants renders as `oneOf` of closed objects with `const` discriminators and `additionalProperties: false`, which `ajv` validates.
- F18. `exitCodeFor` (`outcome/exit-code.ts`) returns 1 for `ERROR` only when the `fail-on` list contains `error`. The `catch` branch of `command.ts` returns 1 unconditionally.

### Design implications

- I1. The `Resolution`, the `RuntimeResult` and the `ChangeContext` are not part of `ResolvedRun` (F2), so the Bundle_Writer needs them from the Run_Pipeline. The `RuntimeResult` lacks the per-step page title and URL, the per-step probabilities, the event log, the final image fields and the decide-call model ids (F6). Requirement 10 closes this gap.
- I2. A `loadConfig` failure happens before the run directory is computed (F1). The bundle for that case needs a directory derived without a loaded config, which is the default `.ce/runs` under the working directory. A credentials or gateway failure has a known `output.dir` and uses the computed run directory (Requirement 5).
- I3. Writing the bundle is the Evidence stage, and `Stage` already contains `evidence`. A bundle write failure is therefore a `StageError('evidence')` that the Run_Pipeline resolves to `ERROR` through a second call of `resolveOutcome` (Requirement 4 criterion 6, Requirement 9 criterion 8).
- I4. `EvidenceSummary.artifacts.reportPath` names a file that this feature does not write (F6). The Terminal_Summary must not claim that the file exists.
- I5. Because `run()` can throw today (F13) and the command catch branch writes no bundle (F10), "every outcome writes a bundle" needs a no-throw guarantee in `run()` (Requirement 11). The command catch stays a print-only safety net and writes no bundle (D9), because only `resolveOutcome` may produce an Outcome (F11).
- I6. A Minimal_Bundle that re-includes the fields that failed validation would fail validation again. After a validation failure the Minimal_Bundle therefore carries only top-level fields and `error` (Requirement 5 criteria 13 to 16).

### Decisions taken in this document

- D1. `RuntimeResult` gains an optional `trace` field. The alternative, changing the `RuntimeHook` return type, is rejected because it breaks every registered capability and every test double.
- D2. At most two `resolveOutcome` calls per run. The second happens only for a `StageError('evidence')` and decides the final outcome and exit code.
- D3. Run_Record fields that do not apply to an outcome are present with `null` (or an empty array for lists). No field is omitted.
- D10. The Run_Schema is a `z.discriminatedUnion('outcome', ...)` with one strict variant per Outcome. The presence table of Requirement 2 criterion 16 is enforced by the schema and not only by tests. F17 confirms the JSON Schema generator supports this.
- D4. The model field is `jevModels`, a `string[]` of distinct dated model ids, with the final image model also in its own field.
- D5. `schemaVersion` is the string `"1"`.
- D6. `Claim.probability` is `number | null`.
- D7. Per-call Jev data lives only in `jev-calls.jsonl`.
- D8. The Terminal_Summary for an unwritten bundle is built from a `no_bundle` summary input (Requirement 8).
- D9. The `catch` in `runRunCommand` is a last-resort safety net that prints `Outcome: ERROR`, writes the constructor name of the thrown value to stderr, returns exit code 1 and writes no bundle (decided by the user). This is the single exception to "every outcome writes a bundle".
- D11. After a validation failure the Minimal_Bundle holds only top-level fields and `error`, and `error.fields` lists the failing field paths without values. The Minimal_Bundle is validated too. If that fails, no bundle is written, the run still resolves `ERROR`, and the Summary_Printer uses the `no_bundle` input.
- D12. The outermost `catch` of `run()` calls `resolveOutcome` only when no final resolution exists yet.

## Glossary

- **Evidence_Bundle**: The directory `<output.dir>/<run-id>/` that holds every artifact of one CE run. Its files are the Run_Record, the screenshots, the logs and the Call_Log.
- **Run_Dir**: The absolute path of the Evidence_Bundle directory. For a loaded config it is the directory computed by the Run_Pipeline (F1).
- **Run_Record**: The file `run.json` in the Run_Dir. It is the machine-readable description of one run.
- **Run_Schema**: The zod schema in `packages/ce/src/evidence/` that defines the Run_Record. It is the single source of the Run_Schema_File.
- **Run_Schema_File**: The generated JSON Schema file `schemas/run.schema.json`.
- **Schema_Version**: The `schemaVersion` field of the Run_Record. It identifies the version of the Run_Schema that the Run_Record conforms to.
- **Bundle_Writer**: The module `packages/ce/src/evidence/bundle.ts`. It builds the Run_Record, validates it, and writes the Run_Record.
- **Summary_Printer**: The module `packages/ce/src/evidence/summary.ts`. It builds the Terminal_Summary text.
- **Summary_Input**: The argument of the Summary_Printer. It is either a `bundle` input (Run_Record and Report_Path) or a `no_bundle` input (Requirement 8 criterion 14).
- **Terminal_Summary**: The text that `ce run` prints to stdout at the end of a run.
- **Run_Pipeline**: The `run()` function and the files in `packages/ce/src/run/` that it uses.
- **Run_Command**: The `runRunCommand` function in `packages/ce/src/run/command.ts`.
- **Outcome_Resolver**: The `resolveOutcome` function in `packages/ce/src/outcome/resolve.ts`, the only place where an Outcome is decided.
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC section 7.1).
- **Resolution**: The `Resolution` type of `outcome/types.ts`: `outcome`, `reason`, and the optional `finalState`, `errorStage` and `surface`.
- **Stage**: One of `config`, `context`, `assessment`, `runtime`, `evidence`, as in `errors.ts`.
- **Failed_Stage**: The `stage` of the `StageError` that caused an `ERROR` Outcome, or the stage mapped from the Resolution `reason` in Requirement 5 criterion 3.
- **Minimal_Bundle**: A Run_Record written for an `ERROR` Outcome. It carries the Failed_Stage and every field the completed stages produced. Fields of stages that did not run are `null` or an empty list (Requirement 2 criterion 16). After a validation failure it carries only top-level fields and `error` (Requirement 5 criterion 13).
- **Validation_Failure**: A Run_Record that the Run_Schema rejected (Requirement 4 criterion 2).
- **Stop_Reason**: The `stopReason` of the runtime loop, one of the six values of F16.
- **Runtime_Trace**: The optional `trace` field of `RuntimeResult` (Requirement 10). It carries the per-step and final-image data that `EvidenceSummary` lacks.
- **Returned_Model_Id**: The dated model id that a Jev response returns.
- **Claim**: A statement about the behavior expected from the Change (SPEC section 3.2).
- **Change**: The software change that is the reason verification is performed (SPEC section 3.2).
- **Subject**: The software, component or runtime behavior that is observed (SPEC section 3.2).
- **Assessment**: The determination of whether the Change requires additional runtime Evidence (SPEC section 3.2). It is not a verdict on correctness (SPEC section 3.5).
- **Evidence**: Proof obtained from runtime observation that can be inspected to evaluate a Claim (SPEC section 3.2).
- **Call_Log**: The file `jev-calls.jsonl` written by `jev/log.ts`.
- **Secret_Value**: A value that `collectSecretValues` returns for the run environment, for example the value of `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`, and any match of a configured `context.redact` pattern found in the config.
- **Report_Path**: The path that the Terminal_Summary prints as the place to inspect the run. It is the path of `report.html` in the Run_Dir when that file exists, and the path of the Run_Record otherwise.
- **Bundle_Relative_Path**: A path that is relative to the Run_Dir, uses `/` as separator, and contains no `..` segment.
- **Default_Run_Dir**: `<cwd>/.ce/runs/<run-id>`, where `<run-id>` is `runDirName(now())`.

## Requirements

### Requirement 1: Bundle layout

**User Story:** As a reviewer, I want every artifact of one run in one predictable directory, so that I can inspect or upload the run without searching.

#### Acceptance Criteria

1. WHEN a run resolves to an Outcome, THE Bundle_Writer SHALL write the Run_Record to `<Run_Dir>/run.json`.
2. THE Evidence_Bundle SHALL be located at `<output.dir>/<run-id>/`, where `<output.dir>` is the configured `output.dir` (default `.ce/runs`) resolved against the working directory and `<run-id>` is the name produced by `runDirName`.
3. WHEN the browser capability captured screenshots, THE Evidence_Bundle SHALL contain those screenshots as files inside the Run_Dir.
4. WHEN the target application was started by CE, THE Evidence_Bundle SHALL contain the target log `target.log` inside the Run_Dir.
5. WHEN the Call_Log file `jev-calls.jsonl` exists in the Run_Dir, THE Run_Record SHALL list it in `artifacts` with kind `jev-calls`. A run with an injected gateway creates no Call_Log (F4), and the Run_Record then lists no `jev-calls` artifact.
6. THE Run_Record SHALL list every screenshot, log and Call_Log file of the Evidence_Bundle in an `artifacts` field, each as a Bundle_Relative_Path with its kind (`screenshot`, `log` or `jev-calls`).
7. THE Bundle_Writer SHALL write every artifact path that appears in the Run_Record as a Bundle_Relative_Path.
8. FOR ALL artifact paths listed in the Run_Record, THE file at `<Run_Dir>/<path>` SHALL exist when the Bundle_Writer returns.
9. THE Bundle_Writer SHALL write only inside the Run_Dir.

### Requirement 2: Run_Record content

**User Story:** As a reviewer, I want `run.json` to say what was claimed, what CE did, and what it saw, so that I can evaluate the run without re-running anything.

#### Acceptance Criteria

1. THE Run_Record SHALL contain the fields `schemaVersion`, `ceVersion`, `jevModels`, `outcome`, `outcomeReason`, `config`, `context`, `claims`, `assessment`, `subject`, `steps`, `eventLog`, `finalImage`, `runtime`, `finalState`, `error`, `artifacts` and `timings`.
2. THE Run_Record SHALL set `outcome` and `outcomeReason` to the `outcome` and `reason` of the Resolution returned by the Outcome_Resolver for the run.
3. WHEN the Outcome is `EVIDENCED`, THE Run_Record SHALL set `finalState` to the `finalState` of the Resolution.
4. WHILE the Outcome is not `EVIDENCED`, THE Run_Record SHALL set `finalState` to `null`.
5. THE Run_Record SHALL describe the Change by its title, description, base, head, changed file paths and provenance, without file contents or diff text.
6. WHEN the Assessment identified at least one Claim, THE Run_Record SHALL list each Claim with its id, text, probability and provenance, and SHALL set `assessment.claimStatus` to `identified`. THE Run_Schema SHALL define the Claim `probability` as a number or `null`, because a declared Claim carries no classifier probability (D6).
7. IF no Claim was identified, THEN THE Run_Record SHALL set `assessment.claimStatus` to `not_identified`, SHALL list no Claim text, and SHALL NOT contain a fabricated Claim (SPEC section 7.2). A candidate is not a Claim. Candidate text in `context.candidates` therefore does not violate this criterion when `claimStatus` is `not_identified`.
8. WHEN the Assessment stage completed, THE Run_Record SHALL contain the Assessment fields `required`, `decidedBy`, `surface`, the per-Claim probabilities, the question ids with their returned probabilities, and the effective assessment settings.
9. THE Run_Record SHALL label the Assessment probabilities as classifier signals and SHALL NOT contain a field that states a verdict on the correctness of the software (SPEC section 3.5).
10. WHEN the Runtime_Trace is present, THE Run_Record SHALL set `subject` to the observed target URL and SHALL list each step in `steps` with its number, page URL, page title, the action kind and description, whether the action was executed, the screenshot as a Bundle_Relative_Path, and the probabilities of the options considered. The page URL and title come from the Runtime_Trace (F6, Requirement 10).
11. WHEN the Runtime_Trace carries event log entries (dialog, download, popup, settle, refusal), THE Run_Record SHALL include each entry in `eventLog` with its step number, kind and detail.
12. THE Run_Record SHALL set `jevModels` to the list of distinct Returned_Model_Ids actually returned by Jev calls of the run, in order of first appearance. The list is built from `Assessment.record.modelIds`, then the Runtime_Trace `modelIds`, then `finalImageModel`. THE Run_Record SHALL set `jevModels` to an empty list WHEN no Jev call returned a model id, and SHALL NOT put the requested model alias into the list.
13. THE Run_Record SHALL set `finalImage` to an object with the fields `model` (the `finalImageModel`, or `null`), `error` (the `finalImageError`, or `null`) and `screenshot` (the Bundle_Relative_Path of the `finalScreenshot`, or `null`) WHEN the Runtime_Trace is present, and to `null` otherwise. IF the final image request failed, THEN THE Run_Record SHALL record the failure reason in `finalImage.error` and SHALL leave the Outcome unchanged (decision `jev-gateway-decision`, "Image failures raise JevImageError and are recoverable"). `finalImageModel` stays in `finalImage.model` as its own field and is also a member of `jevModels` when it is set.
14. THE Run_Record SHALL record `timings` as `startedAt` (ISO 8601 UTC), `durationMs` of the run measured up to the start of the bundle build, and `stages`, an object with the keys `config`, `context`, `assessment` and `runtime`. `durationMs` is the wall time from the start of the run to the resolution. A stage that completed records its duration in milliseconds. A stage that threw records its duration up to the throw (for a `loadConfig` failure, `stages.config` holds that duration and the other three keys are `null`). A stage that never started records `null`. The duration of the Evidence stage is not recorded, because the write cannot measure itself.
15. THE Run_Record SHALL satisfy the SPEC section 7.2 minimum for a run that produced Evidence: the Change and Claim, the Subject, the performed actions, the obtained observations, and where the Evidence can be inspected.
16. THE Run_Record SHALL present each field according to the table below. A field that does not apply to the Outcome is present with the stated `null` or empty list, and no field is omitted (D3). The Run_Schema SHALL enforce the table through one variant per Outcome (Requirement 3 criterion 10). `ERROR` cells state the case that applies when the Failed_Stage ran or did not run. The Validation_Failure case is stated in the last row.

| Field | SKIPPED | UNSUPPORTED | EVIDENCED | ERROR |
| --- | --- | --- | --- | --- |
| `schemaVersion`, `ceVersion`, `outcome`, `outcomeReason`, `timings` | present | present | present | present |
| `jevModels`, `artifacts` | list | list | list | list; `[]` after a Validation_Failure |
| `config` | object | object | object | object; `null` WHEN `loadConfig` failed |
| `context` | object | object | object | object WHEN the context stage completed; otherwise `null` |
| `claims` | list | list | list | list WHEN the assessment stage completed; otherwise `[]` |
| `assessment` | object | object | object | object WHEN the assessment stage completed; otherwise `null` |
| `subject` | `null` | `null` | URL | URL WHEN a Runtime_Trace or partial trace with an observation exists; otherwise `null` |
| `steps` | `[]` | `[]` | at least one step | steps of the trace or `partial`; otherwise `[]` |
| `eventLog` | `[]` | `[]` | list | list of the trace or `partial`; otherwise `[]` |
| `finalImage` | `null` | `null` | object WHEN a Runtime_Trace is present; otherwise `null` | object WHEN a complete Runtime_Trace exists; otherwise `null` |
| `runtime` | `null` | `null` | object WHEN a Runtime_Trace is present; otherwise `null` | object WHEN a complete Runtime_Trace exists; otherwise `null` |
| `finalState` | `null` | `null` | `reached` or `not_reached` | `null` |
| `error` | `null` | `null` | `null` | object with `stage`, `reason`, `causeName` and `fields` |
| ERROR after a Validation_Failure | n/a | n/a | n/a | only the top-level fields and `error`; `config`, `context`, `assessment`, `subject`, `finalImage`, `runtime` are `null`; `claims`, `steps`, `eventLog`, `jevModels`, `artifacts` are `[]` |

17. THE Run_Record SHALL describe the context in `context` with these members and no others: `change` (title, description, base, head, `files` as path, oldPath, status and provenance per file, the number of commits, the Change-level claims with provenance, and the Change provenance list), `candidates` (id, text and provenance), `checks` (name, status, covers and provenance), `providers` (name, status and reason), `truncated` (file and reason) and `redactions` (file and count). THE Run_Record SHALL NOT contain `patch` text of a changed file, a commit message, or file contents.
18. WHEN the Runtime_Trace is present, THE Run_Record SHALL set `runtime.stopReason` to the Stop_Reason of the trace, so that a `not_reached` result is explainable.
19. THE Run_Record SHALL set `error.fields` to the list of failing field paths WHEN the Failed_Stage is `evidence` because of a Validation_Failure, and to `[]` in every other case. THE Run_Record SHALL NOT put a field value into `error.fields`.

### Requirement 3: Run_Schema and Run_Schema_File

**User Story:** As a developer of tools that consume CE output, I want a versioned JSON Schema for `run.json`, so that I can validate and parse it without reading CE's source.

#### Acceptance Criteria

1. THE Run_Schema SHALL be a zod schema located in `packages/ce/src/evidence/`.
2. THE Run_Schema_File SHALL be generated from the Run_Schema and committed at `schemas/run.schema.json`.
3. THE Run_Schema SHALL define `schemaVersion` as the literal string `"1"`, and a change of the Run_Record shape that is incompatible SHALL change that literal (D5).
4. THE Run_Schema SHALL reject any property that the Run_Schema does not define.
5. WHEN the committed `schemas/run.schema.json` differs from the file the generator produces from the Run_Schema, THE test suite SHALL fail.
6. THE repository SHALL provide an npm script that regenerates the Run_Schema_File, following the pattern of `generate:config-schema`.
7. FOR ALL Run_Records the Bundle_Writer produces, a standard JSON Schema validator given `schemas/run.schema.json` SHALL report no error.
8. FOR ALL valid Run_Record objects `r`, zod-parsing `r`, serializing the parsed result to text, and zod-parsing that text again SHALL produce a value deep-equal to `r` (round-trip property).
9. THE Run_Schema SHALL define the `outcome` field as exactly the four values `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` and `ERROR`, taken from `OUTCOMES` in `outcome/types.ts`.
10. THE Run_Schema SHALL be a `z.discriminatedUnion('outcome', ...)` with one strict variant for each of the four Outcomes, and each variant SHALL define every field of the table in Requirement 2 criterion 16 as nullable, non-null or a list exactly as the table states, so that the schema and not only the tests enforce the table (D10). THE `ERROR` variant SHALL allow the nullable cells of the `ERROR` column.
11. THE Run_Schema SHALL define `error.stage` as one of the five Stage values, and `error.reason` as a `ResolveReason` value.
12. THE Run_Schema SHALL define `error.fields` as a list of strings, and `runtime.stopReason` as one of the six values of F16.
13. THE generator of the Run_Schema_File SHALL render the discriminated union with the zod JSON Schema generator that `config/json-schema.ts` uses (F17), and a test SHALL check that `ajv` rejects a Run_Record whose `outcome` and presence cells do not match one variant.

### Requirement 4: Validation on write

**User Story:** As a maintainer, I want CE to refuse to write a Run_Record that breaks its own schema, so that consumers can rely on every `run.json` they find.

#### Acceptance Criteria

1. WHEN the Bundle_Writer has built a Run_Record, THE Bundle_Writer SHALL validate it against the Run_Schema before writing `run.json`.
2. IF validation fails, THEN THE Bundle_Writer SHALL NOT write the invalid Run_Record to `run.json`.
3. IF validation fails, THEN THE Bundle_Writer SHALL raise a `StageError` for the `evidence` stage whose message lists the path of each failing field and no field value.
4. IF the Bundle_Writer cannot write a file into the Run_Dir, THEN THE Bundle_Writer SHALL raise a `StageError` for the `evidence` stage.
5. WHEN the Bundle_Writer writes `run.json`, THE Bundle_Writer SHALL write the complete file to a temporary name in the Run_Dir and rename it to `run.json`, so that a reader never finds a partial `run.json`.
6. IF the first bundle write raises a `StageError` for the `evidence` stage, THEN THE Run_Pipeline SHALL call the Outcome_Resolver a second time with that `StageError`, SHALL use the result of that second call as the outcome of the run (`ERROR` with `errorStage` `evidence`), SHALL compute the exit code from `exitCodeFor` of the second result, and SHALL attempt to write a Minimal_Bundle (Requirement 5, including criteria 13 to 16 for a Validation_Failure). The first Resolution is discarded.
7. THE Bundle_Writer SHALL validate each Run_Record exactly once per write (the Minimal_Bundle is a separate write), using the same Run_Schema that generates `schemas/run.schema.json`.
8. IF the rename of the temporary file to `run.json` fails, THEN THE Bundle_Writer SHALL remove the temporary file `run.json.tmp` on a best-effort basis, and a failure of that removal SHALL NOT replace the original `StageError`.

### Requirement 5: Minimal bundle on ERROR

**User Story:** As a developer debugging a failed run, I want a bundle that names the failed stage even when the run died early, so that I know where to look.

#### Acceptance Criteria

1. WHEN the Outcome is `ERROR`, THE Bundle_Writer SHALL write a Run_Record that conforms to the Run_Schema.
2. WHEN the Outcome is `ERROR` and the Resolution carries an `errorStage`, THE Run_Record SHALL set `error.stage` to the Failed_Stage.
3. WHEN the Outcome is `ERROR` and the Resolution carries no `errorStage`, THE Run_Record SHALL set `error.stage` to the stage given by the table below and SHALL set `error.reason` to the Resolution `reason`. The mapping derives from the pipeline code (F14).

| Resolution `reason` without `errorStage` | `error.stage` | Why |
| --- | --- | --- |
| `assessment-missing` | `assessment` | The pipeline stopped without an Assessment. The stage that produces it is `assessment`. |
| `no-observation` | `runtime` | The capability hook returned no observation. |
| `evidence-incomplete` | `runtime` | The capability hook returned evidence that fails the SPEC 7.2 minimum. |

4. THE Run_Record SHALL record `error.stage`, `error.reason`, `error.causeName` and `error.fields`, and SHALL record `error.causeName` as the constructor name of the `StageError` cause. WHEN the error has no cause (the three reasons of criterion 3), THE Run_Record SHALL set `error.causeName` to `null`.
5. THE Run_Record SHALL NOT record the message of the cause, because a cause message can carry a credential, state text or image bytes.
6. WHEN `loadConfig` fails, THE Bundle_Writer SHALL write the Minimal_Bundle to the Default_Run_Dir, because no `output.dir` is available, and SHALL set `config` and `context` to `null`.
7. WHEN the credentials check fails or `createGateway` returns an error, THE Bundle_Writer SHALL write the Minimal_Bundle to the Run_Dir that the Run_Pipeline computed from the loaded `output.dir` (F1), SHALL set `config` from the redacted config, and SHALL set `context` to `null`. THE Run_Pipeline SHALL pass that Run_Dir to the Bundle_Writer for these failures.
8. WHEN a stage failed after earlier stages completed, THE Minimal_Bundle SHALL include the fields of the completed stages (for example `context`, `claims` and `assessment` for a `runtime` failure).
9. WHEN the runtime stage failed with a `LoopStageError`, THE Minimal_Bundle SHALL include the observations, steps and event log entries from its `partial` field in `steps` and `eventLog`, and the screenshots already written. THE Minimal_Bundle SHALL set `finalImage` to `null` for this case, because `partial` carries no final image data.
10. THE Minimal_Bundle SHALL set `finalState` to `null` and SHALL follow the presence rules of Requirement 2 criterion 16, with `null` or `[]` for fields of stages that did not run.
11. IF writing the Minimal_Bundle fails, THEN THE Bundle_Writer SHALL report the failure to stderr with the Failed_Stage and SHALL NOT raise an exception out of `run()`.
12. IF writing the Minimal_Bundle fails, THEN THE Run_Pipeline SHALL keep the Outcome `ERROR` and the exit code of the final resolution (the original failure, or the second resolution of Requirement 4 criterion 6).
13. IF the Failed_Stage is `evidence` because of a Validation_Failure, THEN THE Minimal_Bundle SHALL contain only the top-level fields (`schemaVersion`, `ceVersion`, `outcome`, `outcomeReason`, `timings`), the empty `jevModels` and `artifacts` lists, and `error`, with every stage-derived field set to `null` or `[]` as the last row of the table in Requirement 2 criterion 16 states. The Minimal_Bundle SHALL NOT re-include `context`, `claims`, `steps` or any other field that may hold the invalid values.
14. IF the Failed_Stage is `evidence` because of a Validation_Failure, THEN THE Minimal_Bundle SHALL set `error.fields` to the paths of the failing fields of the rejected Run_Record and SHALL NOT include any of their values.
15. THE Bundle_Writer SHALL validate the Minimal_Bundle against the Run_Schema before writing it, with the same rules as Requirement 4.
16. IF the Minimal_Bundle fails validation or cannot be written, THEN THE Bundle_Writer SHALL write no `run.json`, THE Run_Pipeline SHALL keep the Outcome `ERROR` of the final resolution, and THE Summary_Printer SHALL receive the `no_bundle` input (Requirement 8 criterion 14).

### Requirement 6: Every outcome writes a schema-valid bundle

**User Story:** As a CI author, I want a bundle after every run, so that the artifact upload step always has something to publish.

#### Acceptance Criteria

1. WHEN a run resolves to `SKIPPED`, THE Bundle_Writer SHALL write a Run_Record that conforms to the Run_Schema and contains no step and no screenshot.
2. WHEN a run resolves to `UNSUPPORTED`, THE Bundle_Writer SHALL write a Run_Record that conforms to the Run_Schema and records the Assessment `surface` and the `outcomeReason` `surface-unsupported`.
3. WHEN a run resolves to `EVIDENCED`, THE Bundle_Writer SHALL write a Run_Record that conforms to the Run_Schema and lists at least one step with a screenshot that exists in the Run_Dir.
4. WHEN a run resolves to `ERROR`, THE Bundle_Writer SHALL write a Run_Record that conforms to Requirement 5.
5. THE Bundle_Writer SHALL distinguish `SKIPPED` from `UNSUPPORTED` in the Run_Record through `outcome` and `outcomeReason`, so that no Run_Record states both "not required" and "capability missing".
6. FOR ALL Resolutions of `resolveOutcome`, THE Bundle_Writer SHALL produce a Run_Record whose `outcome` equals the Resolution `outcome` (invariant, property-based test).
7. FOR ALL runs the Run_Pipeline completes, THE Run_Dir SHALL contain exactly one `run.json`.
8. THE Run_Pipeline SHALL write the bundle for the `ResolvedRun` it returns, and SHALL NOT return before the write finished or failed.

### Requirement 7: No secrets and no state contents in the bundle

**User Story:** As a maintainer who uploads bundles as CI artifacts, I want the bundle to carry no credentials and no raw state, so that sharing it is safe.

#### Acceptance Criteria

1. THE Bundle_Writer SHALL write the `config` field of the Run_Record from the redacted config (`LoadedConfig.redacted`) and never from the effective config.
2. THE Bundle_Writer SHALL replace every Secret_Value in every string of the Run_Record with `[REDACTED]` before validation.
3. FOR ALL generated Secret_Values placed in the environment, the config, the Change title or description, an action description, an event log detail and a stage error cause, THE text of every file the Bundle_Writer writes SHALL NOT contain the Secret_Value (property-based test).
4. THE Bundle_Writer SHALL NOT write the API key, an Authorization header or any environment variable value to the Run_Record.
5. THE Bundle_Writer SHALL NOT write the content of a Jev request payload (state text, image bytes, question instructions or option label text) to the Run_Record. This prohibition applies to the Jev request payload only. Page URLs, page titles, action descriptions and element role names that the runtime already passed through the Redactor MAY appear in the Run_Record.
6. THE Bundle_Writer SHALL NOT modify, rewrite or re-serialize the Call_Log, which keeps the closed schema `CallLogEntrySchema` (F4).
7. THE Run_Record SHALL contain no per-call Jev data. THE Run_Record SHALL NOT contain a `calls` field, question ids with versions per call, `stateHash`, latency or token usage. Per-call data lives only in `jev-calls.jsonl` (D7). The Run_Record carries only the aggregate Assessment fields of Requirement 2 criterion 8 and `jevModels`.
8. THE Bundle_Writer SHALL use the redactor output that the runtime already applied to action descriptions and event log details, and SHALL apply the Secret_Value replacement again on top of it.
9. THE Bundle_Writer SHALL NOT write fixture values of `runtime.fixtures` to the Run_Record; an action that filled a field SHALL be recorded with the fixture key only.

### Requirement 8: Terminal summary

**User Story:** As a developer running `ce run`, I want the terminal to show the outcome first, then what was claimed and why, then where to look, so that I can act without opening the files.

#### Acceptance Criteria

1. WHEN a run finishes, THE Run_Command SHALL print the Terminal_Summary to stdout.
2. THE Terminal_Summary SHALL start with the line `Outcome: <outcome>` as its first line.
3. THE Terminal_Summary SHALL print, after the outcome line and in this order, the Claim line, the rationale line and the Report_Path line.
4. WHEN at least one Claim was identified, THE Claim line SHALL contain the text of the first Claim in Claim order. WHEN more than one Claim was identified, THE Claim line SHALL end with ` (+N more)`, where N is the number of remaining Claims.
5. IF no Claim was identified, THEN THE Claim line SHALL state that no claim was identified.
6. WHEN the Outcome is `SKIPPED`, THE rationale line SHALL state that evidence was not required, and SHALL name the Assessment `decidedBy` value.
7. WHEN the Outcome is `UNSUPPORTED`, THE rationale line SHALL state that evidence was required and that the surface `<surface>` has no capability.
8. WHEN the Outcome is `EVIDENCED`, THE rationale line SHALL state `finalState` (`reached` or `not_reached`) and the number of steps.
9. WHEN the Outcome is `ERROR`, THE rationale line SHALL state the Failed_Stage and the `reason`.
10. THE Summary_Printer SHALL describe classifier output as signals and SHALL NOT use the words `verified`, `passed` or `correct` for the Outcome.
11. WHEN `report.html` exists in the Run_Dir, THE Report_Path line SHALL be the path of `report.html`.
12. WHILE `report.html` does not exist in the Run_Dir, THE Report_Path line SHALL be the path of `run.json`.
13. IF the bundle could not be written, THEN THE Report_Path line SHALL state that no bundle was written.
14. THE Summary_Printer SHALL be a pure function of its Summary_Input and SHALL perform no I/O. THE Summary_Input SHALL be a `bundle` input (the Run_Record and the Report_Path) WHEN a Run_Record was written. IF no Run_Record could be written (validation failure, write failure, or a failed Minimal_Bundle), THEN THE Run_Pipeline SHALL build a `no_bundle` input from the final Resolution (`outcome`, `reason`, `errorStage`, `surface`), the Claim texts when known, `finalState` when known, the step count when known, and the field paths of the validation error or the write failure kind, and the Summary_Printer SHALL still print the outcome line first (D8).
15. THE Terminal_Summary SHALL fit within 10 lines. THE Outcome line, the Claim line and the rationale line SHALL each have at most 200 characters. WHEN a Claim text would make the Claim line longer than 200 characters, THE Summary_Printer SHALL truncate the Claim text and end it with the character `…` so that the Claim line, including the ` (+N more)` suffix and the `…`, has exactly 200 characters or fewer. THE Report_Path line SHALL be printed in full and is not truncated, because a truncated path cannot be used.
16. THE Terminal_Summary SHALL NOT contain a Secret_Value.
17. THE Run_Command SHALL return the `exitCode` of the final `ResolvedRun`, which is the result of the last `resolveOutcome` call and the matching `exitCodeFor` (Requirement 4 criterion 6). THE Terminal_Summary and the exit code SHALL reflect the same final Outcome, so that an Evidence-stage failure prints `Outcome: ERROR` and exits with the `ERROR` exit code. Printing the Terminal_Summary SHALL change no exit code.

### Requirement 9: Integration with the pipeline and steering rules

**User Story:** As a maintainer of CE, I want the bundle code to respect the placement rules, so that the outcome stays decided in one place.

#### Acceptance Criteria

1. THE Bundle_Writer SHALL read the Outcome from the Resolution and SHALL NOT compute, adjust or override an Outcome.
2. THE `evidence/` directory SHALL contain no Outcome literal assignment, return or cast, so that the scan in `outcome/architecture.test.ts` (rule d) continues to pass.
3. THE Bundle_Writer SHALL receive from the Run_Pipeline: the Resolution, the Assessment, the Claims, the `RuntimeResult` including its Runtime_Trace, the partial trace of a `LoopStageError` when one occurred, the `StageError` when one occurred, the context summary, the redacted config, the Run_Dir, the stage timings, and the list of Secret_Values. THE Bundle_Writer SHALL read no environment variable.
4. THE Bundle_Writer SHALL NOT import the Jev gateway, the TypeSafe SDK or `fetch`, and SHALL NOT define Jev question text.
5. THE Bundle_Writer SHALL receive the clock and the file system operations as parameters, so that a test can run it without real time and without a real directory.
6. THE `evidence/` directory SHALL be laid out as `bundle.ts` (Run_Record writer and validation), `summary.ts` (Terminal_Summary) and, reserved for a later issue, `report/`.
7. THE Bundle_Writer SHALL write no file outside the Run_Dir and SHALL NOT write to the target application or to Git.
8. THE Run_Pipeline SHALL call `resolveOutcome` at most twice per run. The first call produces the Resolution before the bundle write. A second call SHALL happen only after a `StageError('evidence')` from the bundle write, and its result replaces the first (Requirement 4 criterion 6). THE Run_Pipeline SHALL write the bundle after the first call. THE outermost `catch` of `run()` (Requirement 11 criterion 2) SHALL NOT call `resolveOutcome` when a final resolution already exists, and SHALL reuse that resolution (D12).
9. WHEN the Run_Pipeline is invoked with an injected gateway, THE Run_Pipeline SHALL still write the bundle into the Run_Dir computed for the run.
10. THE tests of this feature SHALL use `FakeJevGateway` and SHALL need no API key, no network and no browser, except one optional integration test against `examples/demo-app` that is skipped when Chromium is not installed.
11. THE `evidence/` module SHALL be exported from `packages/ce/src/index.ts` with the Run_Record type, so that integrating tools can read a bundle with types.
12. THE Bundle_Writer SHALL NOT write `report.html`; that file belongs to a later issue.
13. THE Run_Pipeline SHALL measure the duration of each of the `config`, `context`, `assessment` and `runtime` stages with the injected clock (`now`), and SHALL pass the start time and the stage durations to the Bundle_Writer (Requirement 2 criterion 14).
14. THE `ResolvedRun` returned by `run()` SHALL carry the path of the Run_Dir and the Report_Path (or a flag that no bundle was written), so that the Run_Command can build the Summary_Input without reading the file system.

### Requirement 10: Runtime trace

**User Story:** As a maintainer of CE, I want the runtime data that `run.json` needs to reach the Bundle_Writer, so that steps, event log and final image data are recorded without changing the capability hook contract.

#### Acceptance Criteria

1. THE `RuntimeResult` type in `outcome/types.ts` SHALL gain an optional field `trace` of the type `RuntimeTrace` (D1). THE `RuntimeHook` signature SHALL stay `(input: RuntimeHookInput) => Promise<RuntimeResult>`.
2. THE `RuntimeTrace` type SHALL be declared type-only in `outcome/` and SHALL hold: `steps` (per step: `step`, `url`, `title`, `screenshot` as Bundle_Relative_Path, action `kind` and `description`, `executed`, and `probabilities`), `eventLog` (step, kind, detail), `finalScreenshot`, `finalImageModel`, `finalImageError`, `stopReason` (one of the six values of F16) and `modelIds`, the distinct Returned_Model_Ids of the decide-step calls and the final image request in order of first appearance.
3. THE `RuntimeTrace` type SHALL NOT hold `elements`, `domDigest`, `navigation`, state text or any Jev request payload.
4. WHEN the capability maps a `LoopResult` to a `RuntimeResult`, THE capability SHALL populate `trace` from the `LoopResult`.
5. THE `outcome/resolve.ts` logic and `satisfiesMinimumEvidence` SHALL stay unchanged, and `resolveOutcome` SHALL ignore `trace`. FOR ALL `ResolveInput` values, THE Resolution SHALL be identical with and without a `trace` on the `RuntimeResult` (property-based test).
6. WHEN a capability returns a `RuntimeResult` without `trace`, THE Bundle_Writer SHALL set `subject` from `evidence.subject.url`, SHALL list `steps` from `evidence.observations` with the fields that exist, and SHALL set `finalImage` to `null`, so that existing test doubles remain valid.
7. THE change of `outcome/types.ts` SHALL be limited to the added optional type and field, and SHALL leave `Outcome`, `OUTCOMES`, `Resolution` and `ResolveInput` unchanged.

### Requirement 11: Every returned run leaves a bundle

**User Story:** As a CI author, I want a bundle even when a CE stage fails unexpectedly, so that the failure is inspectable.

#### Acceptance Criteria

1. THE `run()` function SHALL NOT throw. THE Run_Pipeline SHALL wrap every stage call, including `loadConfig`, `reportConfigFailure`, `requireJevCredentials`, `createGateway`, `selectCapability` and the bundle write (F13), so that a thrown value becomes a `StageError` for the stage being run.
2. IF a thrown value escapes the stage wrappers, THEN THE `run()` function SHALL catch it at its outermost level, wrap it in a `StageError` for the last stage entered, resolve it through the Outcome_Resolver only when no final resolution exists (Requirement 9 criterion 8), and attempt a Minimal_Bundle.
3. THE `run()` function SHALL track the last stage entered, so that criterion 2 can name it.
4. IF `runRunCommand` catches a thrown value from `run()` despite criterion 1, THEN THE Run_Command SHALL print `Outcome: ERROR` as the first line of stdout, SHALL write the constructor name of the thrown value to stderr, and SHALL return exit code 1. THE Run_Command SHALL write no bundle in this case, and the Run_Command SHALL contain no Outcome literal assignment, return or cast (F11). This is the explicit exception to the Done condition (D9).
5. THE Run_Command SHALL keep the Terminal_Summary of criterion 4 limited to the `Outcome: ERROR` line, because no Run_Record and no Resolution exist in that case.
6. IF `run()` throws, THEN THE exit code of criterion 4 SHALL be 1 regardless of `fail-on`. This pre-existing behavior differs from `exitCodeFor` (F18) and this issue does not change it.

## Open design questions

- Q1. The `modelIds` of the decide-step calls are held by the gateway (`modelIds()` of the Hybrid gateway) and by each response. The design must choose whether the loop collects them from the responses (preferred, no new gateway method) or reads them from the gateway. Requirement 10 criterion 2 requires only that `trace.modelIds` carries them.
- Q2. `configFailure()` uses the default `fail-on` list (F2). For a credentials or gateway failure, the loaded config is available. The design decides whether to pass the loaded `fail-on` to `exitCodeFor`. This feature does not change the exit code of any existing path unless the design decides so explicitly. A related inconsistency exists and is not fixed in this issue: `exitCodeFor` returns 0 for `ERROR` when `fail-on` lacks `error`, while the `catch` in `command.ts` always returns 1 (F18).
- Q3. The design must define the byte-level form of `run.json` (indentation, key order, trailing newline) for a stable, diffable file. Requirement 3 criterion 8 is deep-equal based and does not depend on the byte form.
- Q4. The design must specify how the Run_Pipeline obtains `ceVersion` without reading an environment variable (for example from the package metadata at build time).
- Q5. The design must define how the first Resolution is discarded cleanly when the second call happens, so that no half-built `ResolvedRun` reaches the Run_Command.

## Design hand-off notes

- N1. The comment on `RuntimeHookInput.runDir` in `packages/ce/src/run/types.ts` is outdated (F15). `run()` computes the run directory in every case, also with an injected gateway. The design should update the comment, and may make `runDir` required. This is a note and not a requirement.
- N2. `finishRun` currently resolves once and returns. The design adds the write step and the optional second resolution around it, keeping `finishRun` the only caller of `resolveAfterAssessment` and the Post_Assessment_Resolver the only caller of `resolveOutcome`.
- N3. `configFailure()` serves the three failure cases of F1. The design should give it the Run_Dir (or `undefined` for `loadConfig` failures) and the redacted config, so that Requirement 5 criteria 6 and 7 hold.
