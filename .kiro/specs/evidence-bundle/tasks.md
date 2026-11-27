# Implementation Plan: Evidence Bundle

## Overview

This plan implements issue rfxlamia/ce#11 in one PR. The language is TypeScript (Node.js 22, ESM, vitest, fast-check, zod 4), as in `design.md`. Order of work:

1. Runtime trace plumbing (types, loop model ids, capability mapping).
2. Run_Schema, generated `schemas/run.schema.json`, and its staleness check.
3. Pure builders: redaction and Run_Record construction.
4. Bundle writer (atomic write, validation on write, Minimal_Bundle) and Terminal_Summary.
5. Pipeline wiring: no-throw `run()`, `finishRunWithBundle`, stage timings, config-failure bundles.
6. Command wiring, public exports, architecture test, integration test.

Rules that apply to every task:

- The outcome is decided only in `outcome/resolve.ts`. Nothing under `evidence/` assigns, returns or casts an Outcome literal (Requirements 9.1, 9.2).
- All tests use `FakeJevGateway` (`jev/fake.ts`). They need no API key, no network and no browser (Requirement 9.10).
- Property tests use fast-check with at least 100 runs and the tag `Feature: evidence-bundle, Property N: <text>`.
- Run commands from the repository root.

## Tasks

- [x] 1. Runtime trace plumbing
  - [x] 1.1 Add the `RuntimeTrace` type and the optional `trace` field
    - Create `packages/ce/src/evidence/trace.ts` with `RuntimeTraceStep`, `RuntimeTraceEvent`, `StopReason` and `RuntimeTrace` as in the design. The file holds types only and imports nothing from `runtime/`.
    - Add `trace?: RuntimeTrace` to `RuntimeResult` in `packages/ce/src/outcome/types.ts` through a type-only import. Leave `Outcome`, `OUTCOMES`, `Resolution` and `ResolveInput` unchanged.
    - In `packages/ce/src/run/types.ts`, make `RuntimeHookInput.runDir` required and correct its outdated comment (hand-off note N1). Remove the `RunDirMissingError` guard and class from `runtime/capability.ts` if nothing else uses them.
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.7_

  - [x] 1.2 Collect model ids in the loop and map the trace in the capability
    - Add `modelIds: string[]` to `LoopResult` in `packages/ce/src/runtime/loop.ts`. Push each successful `response.model` of the decide calls and of the final image call, de-duplicated in order of first appearance. Add no `JevGateway` method.
    - In `packages/ce/src/runtime/capability.ts`, factor out `describeAction` and populate `result.trace` in `mapLoopResultToRuntimeResult` from the `LoopResult`, applying the same redaction as the existing `actions` mapping.
    - Update existing loop and capability tests and test doubles that construct `LoopResult` so they compile.
    - _Requirements: 10.2, 10.3, 10.4_

  - [x] 1.3 Write property test for the capability trace mapping
    - **Property 21: The capability's trace mirrors its LoopResult field-for-field**
    - File: `packages/ce/src/runtime/capability.trace-mapping.property.test.ts`
    - **Validates: Requirements 10.2, 10.4**

  - [x] 1.4 Write property test for trace independence of `resolveOutcome`
    - **Property 20: resolveOutcome is unaffected by the presence of a trace**
    - File: `packages/ce/src/outcome/resolve.trace-independence.property.test.ts`. Build `RuntimeTrace`-shaped plain objects inline and import nothing from `evidence/`.
    - **Validates: Requirements 10.5**

- [x] 2. Run_Schema and generated JSON Schema
  - [x] 2.1 Implement the Run_Schema
    - Create `packages/ce/src/evidence/schema.ts` with `SCHEMA_VERSION = '1'`, `BundleRelativePath`, `Artifact`, `Timings`, `ClaimRecord`, the assessment, step, event log, final image, runtime and context records, `ErrorField`, and the four strict variants joined by `z.discriminatedUnion('outcome', ...)`. Export `RunRecordSchema` and `RunRecord`.
    - Take the `outcome` values from `OUTCOMES`, and nest `ConfigSchema` from `config/schema.ts` for `config`.
    - Encode the Requirement 2.16 presence table in the variants, including the ERROR nullable cells that cover the Validation_Failure shape.
    - _Requirements: 2.1, 2.16, 2.17, 3.1, 3.3, 3.4, 3.9, 3.10, 3.11, 3.12_

  - [x] 2.2 Add schema generation, the npm script and the committed schema file
    - Create `packages/ce/src/evidence/json-schema.ts` (`generateRunJsonSchema`, `serializeRunSchema`) mirroring `config/json-schema.ts` (draft-7, `io: 'input'`, `unrepresentable: 'any'`).
    - Create `packages/ce/src/scripts/generate-run-schema.ts` mirroring `generate-config-schema.ts`, and add `generate:run-schema` to `packages/ce/package.json` next to `generate:config-schema`.
    - Run the script and commit `schemas/run.schema.json`.
    - _Requirements: 3.2, 3.6, 3.13_

  - [x] 2.3 Write the staleness test for `schemas/run.schema.json`
    - File: `packages/ce/src/evidence/json-schema.staleness.test.ts`, mirroring the existing config schema staleness test. It fails when the committed file differs from `serializeRunSchema()`.
    - _Requirements: 3.5_

  - [x] 2.4 Write property test for the schema round trip
    - **Property 4: Round-trip through the Run_Schema is lossless**
    - File: `packages/ce/src/evidence/schema.roundtrip.property.test.ts`
    - **Validates: Requirements 3.8**

  - [x] 2.5 Write property test for zod and ajv agreement
    - **Property 5: The zod schema and the generated JSON Schema agree, including on mutated records**
    - File: `packages/ce/src/evidence/schema.ajv-agreement.property.test.ts`. Compile `schemas/run.schema.json` with the existing `ajv` dev dependency.
    - **Validates: Requirements 3.4, 3.7, 3.9, 3.10, 3.13**

  - [x] 2.6 Write unit tests for static schema facts
    - File: `packages/ce/src/evidence/schema.test.ts`. Check that there is no verdict field, no per-call Jev field, that `config` is nested from `ConfigSchema`, and that `error.stage` and `runtime.stopReason` have the required value sets.
    - _Requirements: 2.9, 3.11, 3.12, 7.7_

- [x] 3. Redaction and Run_Record construction
  - [x] 3.1 Add the `ceVersion` leaf module
    - Create `packages/ce/src/version.ts` holding the version constant. Make `VERSION` in `packages/ce/src/index.ts` re-export it.
    - Add `packages/ce/src/version.staleness.test.ts`, which reads `packages/ce/package.json` and asserts that the constant equals its `version` field.
    - _Requirements: 2.1_

  - [x] 3.2 Implement `redactRunRecord`
    - Create `packages/ce/src/evidence/redact.ts`. Walk every string in the record and apply `redactSecretValues` from `config/secrets.ts` with the supplied secret list. Numbers, booleans and null pass through.
    - _Requirements: 7.2, 7.4, 7.8_

  - [x] 3.3 Implement `buildRunRecord`, `buildMinimalRunRecord` and `buildValidationFailureRunRecord`
    - Create `packages/ce/src/evidence/build.ts` as pure functions. Copy `outcome`, `outcomeReason` and `finalState` from the `Resolution` by field access only.
    - Build `jevModels` with an ordered de-duplication of `assessment.record.modelIds`, `trace.modelIds` and `finalImageModel`. Build `finalImage` and `runtime` from the trace. Use the placeholder fallback from `evidence` when `trace` is absent.
    - Build the context record without `patch` text or commit messages. Reduce commits to a count.
    - Map the missing `errorStage` cases (`assessment-missing`, `no-observation`, `evidence-incomplete`) to `assessment`, `runtime`, `runtime`. Set `causeName` to the cause constructor name or `null`. Never read a cause message. Fill `error.fields` only for an evidence validation failure, with paths and no values.
    - Carry `LoopStageError.partial` into `steps` and `eventLog` with `finalImage: null`. Build the Validation_Failure shape with only top-level fields and `error`.
    - Record fixture keys only, never fixture values, in action descriptions.
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9, 5.10, 5.13, 5.14, 7.5, 7.9, 10.6_

  - [x] 3.4 Add `evidence/arbitraries.ts`
    - Create fast-check arbitraries for `RunRecord`, `Resolution`, `RuntimeTrace`, `ChangeContext`, `StageError` and `BuildRunRecordInput`, following the `outcome/arbitraries.ts` pattern.
    - _Requirements: 3.8, 6.6_

  - [x] 3.5 Write property test for outcome copy
    - **Property 2: Outcome and reason are copied, never computed**
    - File: `packages/ce/src/evidence/build.outcome-copy.property.test.ts`
    - **Validates: Requirements 2.2, 2.3, 2.4, 6.6, 9.1**

  - [x] 3.6 Write property test for field presence
    - **Property 3: Field presence matches the outcome's schema variant**
    - File: `packages/ce/src/evidence/build.presence.property.test.ts`
    - **Validates: Requirements 2.1, 2.8, 2.16, 5.10, 6.1, 6.2, 6.3, 6.4**

  - [x] 3.7 Write property test for the error stage mapping
    - **Property 8: Minimal_Bundle error.stage follows the documented mapping**
    - File: `packages/ce/src/evidence/build.minimal-error-stage.property.test.ts`
    - **Validates: Requirements 5.2, 5.3, 5.4**

  - [x] 3.8 Write property test for partial traces
    - **Property 9: A partial runtime trace is carried into the Minimal_Bundle unchanged**
    - File: `packages/ce/src/evidence/build.partial-trace.property.test.ts`
    - **Validates: Requirements 5.8, 5.9**

  - [x] 3.9 Write property test for the Validation_Failure shape
    - **Property 10: A Validation_Failure bundle carries only top-level fields and path-only errors**
    - File: `packages/ce/src/evidence/build.validation-failure-shape.property.test.ts`
    - **Validates: Requirements 5.13, 5.14**

  - [x] 3.10 Write property test for secret and payload absence
    - **Property 11: No secret value and no raw Jev payload ever reaches an output file or the terminal**
    - File: `packages/ce/src/evidence/redact.no-secrets.property.test.ts`. Cover the built and redacted record here. The Terminal_Summary part is checked in task 4.8.
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.9, 8.16, 10.3**

  - [x] 3.11 Write property test for redacted config
    - **Property 12: Config in the record is always the redacted view**
    - File: `packages/ce/src/evidence/build.config-redacted.property.test.ts`
    - **Validates: Requirements 7.1**

  - [x] 3.12 Write property test for context omissions
    - **Property 14: Context record omits patch text and commit messages but keeps every other member**
    - File: `packages/ce/src/evidence/build.context-omission.property.test.ts`
    - **Validates: Requirements 2.5, 2.17**

  - [x] 3.13 Write property test for `jevModels`
    - **Property 15: jevModels is the ordered de-duplication of every model source**
    - File: `packages/ce/src/evidence/build.jev-models.property.test.ts`
    - **Validates: Requirements 2.12**

  - [x] 3.14 Write property test for `finalImage`
    - **Property 16: finalImage is present only with a trace and mirrors it exactly**
    - File: `packages/ce/src/evidence/build.final-image.property.test.ts`
    - **Validates: Requirements 2.13**

  - [x] 3.15 Write property test for stage timings
    - **Property 17: Stage timings reflect exactly how far the run got**
    - File: `packages/ce/src/evidence/build.timings.property.test.ts`
    - **Validates: Requirements 2.14, 9.13**

  - [x] 3.16 Write property test for `error.fields`
    - **Property 18: error.fields is non-empty only for an evidence-stage validation failure**
    - File: `packages/ce/src/evidence/build.error-fields.property.test.ts`
    - **Validates: Requirements 2.19, 5.5**

  - [x] 3.17 Write property test for the trace-less fallback
    - **Property 22: A trace-less RuntimeResult falls back to EvidenceSummary with safe placeholders**
    - File: `packages/ce/src/evidence/build.trace-fallback.property.test.ts`
    - **Validates: Requirements 10.6**

  - [x] 3.18 Write example unit tests for the builders
    - File: `packages/ce/src/evidence/build.test.ts`. One worked example per outcome, including `SKIPPED` and `UNSUPPORTED` staying distinct.
    - _Requirements: 2.16, 6.1, 6.2, 6.3, 6.5_

- [x] 4. Bundle writer and Terminal_Summary
  - [x] 4.1 Implement `writeBundle` and `writeMinimalBundle`
    - Create `packages/ce/src/evidence/bundle.ts` with injected `fs` and clock. It must not read the environment, import the Jev gateway, the SDK or `fetch`, and must not write `report.html`.
    - Discover artifacts by scanning the Run_Dir (screenshots, `target.log`, `jev-calls.jsonl`) and list each as a Bundle_Relative_Path with its kind. List `jev-calls` at most once.
    - Build, redact, then validate with `RunRecordSchema.safeParse`. On failure write nothing and return `StageError('evidence')` with failing paths and no values.
    - Write `run.json.tmp` then rename it to `run.json`. On a rename failure remove the temp file best-effort without replacing the original error.
    - Serialize as `JSON.stringify(data, null, 2)` plus one trailing newline, UTF-8, keys in Requirement 2.1 order. Never touch `jev-calls.jsonl`.
    - `writeMinimalBundle` uses the minimal or Validation_Failure builder, validates the same way, and never throws.
    - Return `reportPath` as `report.html` only when that file exists, otherwise `run.json`.
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 5.1, 5.11, 5.13, 5.15, 5.16, 7.2, 7.6, 9.3, 9.4, 9.5, 9.7, 9.12_

  - [x] 4.2 Implement `buildSummary`
    - Create `packages/ce/src/evidence/summary.ts` as a pure function over `SummaryInput` (`bundle` or `no_bundle`). Output the `Outcome:` line first, then the Claim, rationale and Report_Path lines, within 10 lines.
    - Apply the claim-count rules, the per-outcome rationale, the 200 character truncation ending in `…` (Report_Path never truncated), and the no-bundle line. Never emit `verified`, `passed` or `correct`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16_

  - [x] 4.3 Write property test for artifact listing
    - **Property 1: Artifact listing reflects the run directory exactly**
    - File: `packages/ce/src/evidence/bundle.artifacts.property.test.ts`, using an in-memory `fs`.
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.8**

  - [x] 4.4 Write property test for invalid writes
    - **Property 6: Invalid records are never written, and their error names only paths**
    - File: `packages/ce/src/evidence/bundle.invalid-write.property.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 4.5 Write property test for the untouched Call_Log
    - **Property 13: The Call_Log file is never modified**
    - File: `packages/ce/src/evidence/bundle.call-log-untouched.property.test.ts`
    - **Validates: Requirements 7.6**

  - [x] 4.6 Write unit tests for atomic write and Minimal_Bundle failure
    - File: `packages/ce/src/evidence/bundle.test.ts`. Cover a rename failure with temp-file cleanup, a write failure, and a Minimal_Bundle that also fails (no `run.json`, no throw).
    - _Requirements: 4.4, 4.5, 4.8, 5.11, 5.15, 5.16_

  - [x] 4.7 Write property tests for summary structure and claim line
    - **Property 25: Terminal_Summary structure, ordering and claim-line truncation**
    - **Property 26: Claim line content matches claim count exactly**
    - Files: `packages/ce/src/evidence/summary.structure.property.test.ts` and `summary.claim-line.property.test.ts`
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.15**

  - [x] 4.8 Write property tests for rationale, report path and summary secrets
    - **Property 27: Rationale line matches the outcome's required content**
    - **Property 28: Report_Path line reflects bundle and report-file state**
    - Files: `packages/ce/src/evidence/summary.rationale.property.test.ts` and `summary.report-path.property.test.ts`. Also assert that the summary text contains no generated secret (the Terminal_Summary part of Property 11).
    - **Validates: Requirements 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.16**

- [x] 5. Checkpoint - Evidence module
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Pipeline integration
  - [x] 6.1 Wire the bundle into `run()`
    - In `packages/ce/src/run/pipeline.ts`, track `lastStage`, measure the `config`, `context`, `assessment` and `runtime` durations with the injected `now`, and wrap `loadConfig`, `reportConfigFailure`, `requireJevCredentials`, `createGateway`, `selectCapability` and the bundle write so a throw becomes a `StageError`.
    - Replace `finishRun` with `finishRunWithBundle`. Resolve once, call `writeBundle`, and on `StageError('evidence')` resolve a second and last time, then call `writeMinimalBundle`. Return `ResolvedRunWithBundle` with `runDir`, `reportPath` and `bundleWritten`. Report a failed Minimal_Bundle to stderr without throwing.
    - Replace `configFailure()` with `configFailureWithBundle`. A `loadConfig` failure writes to the Default_Run_Dir with `config` and `context` null. A credentials or gateway failure writes to the computed Run_Dir with the redacted config. Keep `exitCodeFor(resolution, undefined)`.
    - Add the outermost `catch`: wrap the last stage in a `StageError`, call `resolveOutcome` only when no final resolution exists, attempt a Minimal_Bundle, and return instead of throwing. Keep `resolveOutcome` reachable only through `run/resolve.ts`.
    - Pass `LoopStageError.partial` and the secret list from `collectSecretValues(env)` to the writer. Write the bundle also when `options.gateway` is injected.
    - _Requirements: 1.2, 4.6, 5.6, 5.7, 5.8, 5.9, 5.11, 5.12, 5.16, 6.8, 9.3, 9.8, 9.9, 9.13, 9.14, 11.1, 11.2, 11.3_

  - [x] 6.2 Write property test for the second resolution
    - **Property 7: A second resolution replaces the first and the stale one does not leak**
    - File: `packages/ce/src/run/pipeline.second-resolution.property.test.ts`
    - **Validates: Requirements 4.6, 9.8**

  - [x] 6.3 Write property test for a single `run.json`
    - **Property 19: Exactly one run.json exists after any run**
    - File: `packages/ce/src/run/pipeline.single-bundle.property.test.ts`
    - **Validates: Requirements 6.7**

  - [x] 6.4 Write property test for the no-throw guarantee
    - **Property 23: run() never throws, and the caught stage names where it failed**
    - File: `packages/ce/src/run/pipeline.no-throw.property.test.ts`
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [x] 6.5 Write property test for injected gateways
    - **Property 30: An injected gateway still produces a bundle in the computed run directory**
    - File: `packages/ce/src/run/pipeline.injected-gateway.property.test.ts`, using `FakeJevGateway`.
    - **Validates: Requirements 9.9**

  - [x] 6.6 Write property test for the resolve call count
    - **Property 31: resolveOutcome is called at most twice, and never redundantly after a final resolution exists**
    - File: `packages/ce/src/run/pipeline.resolve-call-count.property.test.ts`
    - **Validates: Requirements 9.8**

- [x] 7. Command, exports and architecture
  - [x] 7.1 Print the Terminal_Summary from `runRunCommand`
    - In `packages/ce/src/run/command.ts`, build a `bundle` or `no_bundle` `SummaryInput` from the `ResolvedRunWithBundle` and write `buildSummary(...)` to stdout in place of the ad hoc `Outcome:`, `Reason:` and `Surface:` lines. Keep the stderr diagnostics.
    - Keep the last-resort `catch` print-only: `Outcome: ERROR` first, constructor name to stderr, exit code 1, no bundle, no Outcome literal assignment, return or cast. Return `result.exitCode` unchanged.
    - _Requirements: 8.1, 8.14, 8.17, 11.4, 11.5, 11.6_

  - [x] 7.2 Export the evidence module and extend the architecture test
    - Export `RunRecord`, `RunRecordSchema`, `buildSummary`, `writeBundle` and the related types from `packages/ce/src/index.ts`.
    - Create `packages/ce/src/evidence/report/.gitkeep`.
    - Extend `packages/ce/src/outcome/architecture.test.ts`: apply the no-SDK, no-`fetch` boundary rule used for `run/` to `evidence/`, and confirm that no file under `evidence/` assigns, returns or casts an Outcome literal (rule d).
    - _Requirements: 9.2, 9.4, 9.6, 9.11_

  - [x] 7.3 Write property test for the last-resort catch
    - **Property 24: The command's last-resort catch is independent of the thrown value's shape**
    - File: `packages/ce/src/run/command.catch-any-value.property.test.ts`
    - **Validates: Requirements 11.4, 11.6**

  - [x] 7.4 Write property test for the exit code
    - **Property 29: Printing the summary never changes the exit code**
    - File: `packages/ce/src/run/command.exit-code.property.test.ts`
    - **Validates: Requirements 8.17**

  - [x] 7.5 Write unit tests for command output
    - File: `packages/ce/src/run/command.summary.test.ts`. Check that stdout starts with `Outcome:` and that the stderr diagnostics are unchanged.
    - _Requirements: 8.1, 8.2, 8.17, 11.5_

  - [x] 7.6 Write the optional end-to-end integration test
    - File: `packages/ce/src/run/pipeline.bundle.integration.test.ts`. Run the pipeline against `examples/demo-app` with `FakeJevGateway`, skip when Chromium is missing, and assert that the written `run.json` validates with zod and with `ajv` against `schemas/run.schema.json`.
    - _Requirements: 3.7, 6.3, 9.10_

- [x] 8. Final checkpoint - Typecheck, tests and build
  - Run `npm run typecheck`, `npm test` and `npm run build` from the repository root and fix any failure.
  - Confirm `schemas/run.schema.json` is up to date (run `npm run generate:run-schema --workspace packages/ce` and check for no diff).
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Core tasks still cover every issue #11 checklist item and the Done condition.
- Issue checklist coverage: bundle layout in `.ce/runs/<id>/` (4.1, 6.1), `schemas/run.schema.json` with validation on write (2.1, 2.2, 4.1), Minimal_Bundle on ERROR with the failed stage (3.3, 4.1, 6.1), outcome-first Terminal_Summary (4.2, 7.1), every outcome writes a schema-valid bundle (6.1, with 7.1 keeping the single documented exception, the print-only catch in `command.ts`).
- Each task references specific requirement clauses. Property tests carry the design property number.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "2.4", "2.6", "3.2", "3.3"] },
    { "id": 3, "tasks": ["2.3", "2.5", "3.4", "4.1", "4.2"] },
    { "id": 4, "tasks": ["3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14", "3.15", "3.16", "3.17", "3.18", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8"] },
    { "id": 5, "tasks": ["5"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "7.1", "7.2"] },
    { "id": 8, "tasks": ["7.3", "7.4", "7.5", "7.6"] },
    { "id": 9, "tasks": ["8"] }
  ]
}
```
