# Implementation Plan: run-vertical-slice

## Overview

This plan wires `run()` into the non-browser vertical slice of issue #41 (rfxlamia/ce). The implementation language is TypeScript (Node.js 22.12 or later), as in `design.md`. New code lives in `packages/ce/src/run/`. Work proceeds from the pure pieces (types, registry, post-assessment resolver) to the pipeline, then `index.ts`, the testable `runRunCommand`, the CLI wiring and the architecture test extension.

Every test uses `FakeJevGateway` or a scripted gateway, injected `contextProviders` and `exec`, a fixed `now` and a temporary `cwd`. No test needs an API key, a network, a browser or a git process. The outcome is decided only by `resolveOutcome` (through `resolveAfterAssessment`). No file in `run/` or `index.ts` may assign an Outcome literal, import `@typesafe-ai/sdk`, import `jev/catalog` or call `fetch`.

Issue #41 coverage:

- Checklist item 1 (sequence): tasks 4.1, 4.4.
- Checklist item 2 (SKIPPED, UNSUPPORTED, never fake EVIDENCED): tasks 2.1, 2.2, 2.3, 4.4, 6.3.
- Checklist item 3 (stage failures as ERROR, exit via `exitCodeFor`): tasks 2.1, 2.4, 2.5, 4.1, 4.3, 4.4.
- Checklist item 4 (hook point for #9 and #10): tasks 1.1, 1.2, 4.1, 4.4.
- Checklist item 5 (remove the `TODO(Milestone 1)` stub): tasks 5.1, 5.2.
- "Done when" line: tasks 6.3 (automated, both outcomes) and the manual step in the Notes section.

## Tasks

- [x] 1. Define run types and the Capability_Registry
  - [x] 1.1 Create `packages/ce/src/run/types.ts`
    - Define `RuntimeHookInput`, `RuntimeHook`, `CapabilityEntry`, the branded `CapabilityRegistry`, `CreateGateway`, `RunOptions`, `ResolvedRun` and `RunResult` exactly as in `design.md`
    - `ResolvedRun` extends `Resolution` and adds `kind: 'resolved'`, `exitCode`, and optional `claims`, `assessment`, `error`, `capability`
    - Use type-only imports from the stage modules, and do not import `jev/catalog` or the Jev SDK
    - _Requirements: 2.1, 8.1, 8.2, 8.10, 9.1, 9.4, 9.5, 9.7_

  - [x] 1.2 Create `packages/ce/src/run/capabilities.ts`
    - Implement `createCapabilityRegistry(entries)`: throw `Duplicate capability name: <name>` for a repeated name and `Unsupported capability surface: <surface>` for a Surface outside `V0_SUPPORTED_SURFACES`; copy, freeze and keep registration order
    - Implement `EMPTY_REGISTRY`, `selectCapability(assessment, registry)` (first entry in registration order that supports the Surface, `undefined` when `required` is false) and `supportedSurfaces(registry)` (de-duplicated union)
    - _Requirements: 4.2, 8.2, 8.3, 8.4, 8.11_

  - [x] 1.3 Write property test for capability selection
    - File: `packages/ce/src/run/capabilities.property.test.ts`, with the tag comment `// Feature: run-vertical-slice, Property 2: Capability selection`
    - **Property 2: Capability selection**
    - **Validates: Requirements 3.2, 8.11, 13.13, 13.14**

  - [x] 1.4 Write property test for registry validation
    - Same file as 1.3, with the tag comment `// Feature: run-vertical-slice, Property 3: Registry validation`
    - Generate lists with a forced duplicate name and lists with a forced non-v0 Surface
    - **Property 3: Registry validation**
    - **Validates: Requirements 8.3, 8.4, 13.12**

  - [x] 1.5 Write unit tests for the registry
    - File: `packages/ce/src/run/capabilities.test.ts`
    - Cover the duplicate-name error, the unsupported-Surface error, the empty registry, first-registered selection with two capabilities on one Surface, and that every Surface of an accepted registry is in `V0_SUPPORTED_SURFACES`
    - _Requirements: 8.3, 8.4, 8.11, 13.12, 13.13_

- [x] 2. Implement the Post_Assessment_Resolver
  - [x] 2.1 Create `packages/ce/src/run/resolve.ts`
    - Implement `resolveAfterAssessment({ assessment?, registry, runtime?, error? })`: build `ResolveInput`, add `assessment`, `runtime` and `error` only when defined, always pass `supportedSurfaces(registry)`, and call `resolveOutcome` exactly once
    - Implement `wrapStage(stage, thrown)`: return a `StageError` unchanged, otherwise `new StageError(stage, thrown)`, never copying the cause's message
    - Write no Outcome literal as a value (architecture rule (d))
    - _Requirements: 1.4, 3.1, 4.1, 4.2, 4.4, 5.1, 5.2, 5.3, 5.4, 6.3, 6.4, 6.6, 8.5, 8.6_

  - [x] 2.2 Write property test for resolution without a runtime result
    - File: `packages/ce/src/run/resolve.property.test.ts`, with the tag comment `// Feature: run-vertical-slice, Property 1: Resolution without a runtime result`
    - Generate every `Surface`, `claimStatus` and `decidedBy`; call the pure function without `assess` or a gateway
    - **Property 1: Resolution without a runtime result**
    - **Validates: Requirements 3.1, 4.1, 4.2, 4.4, 13.14**

  - [x] 2.3 Write property test for supported surfaces
    - Same file as 2.2, with the tag comment `// Feature: run-vertical-slice, Property 4: Supported surfaces are the union of registered surfaces`
    - **Property 4: Supported surfaces are the union of registered surfaces**
    - **Validates: Requirements 4.2, 8.9**

  - [x] 2.4 Write property test for stage error precedence
    - Same file as 2.2, with the tag comment `// Feature: run-vertical-slice, Property 5: Stage error precedence`
    - **Property 5: Stage error precedence**
    - **Validates: Requirements 6.1, 6.2, 6.4, 8.6**

  - [x] 2.5 Write property test for stage wrapping
    - File: `packages/ce/src/run/wrap-stage.property.test.ts`, with the tag comment `// Feature: run-vertical-slice, Property 6: Stage wrapping preserves stage and hides the cause message`
    - Generate `Error` values with a marker message, strings, numbers, `null`, `undefined` and objects
    - **Property 6: Stage wrapping preserves stage and hides the cause message**
    - **Validates: Requirements 6.3, 6.6, 8.6**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the Run_Pipeline
  - [x] 4.1 Create `packages/ce/src/run/pipeline.ts` and `packages/ce/src/run/index.ts`
    - Implement `runDirName(date)` (`run-<iso>` with `:` and `.` replaced by `-`) and `withDefaults(options)`, the only place that reads `process.env`, `process.cwd()`, `process.stderr` and `new Date()`
    - Implement `run(options = {})` following the algorithm in `design.md`: `loadConfig`, report config failure through `reportConfigFailure` with `collectSecretValues(env)`, gateway selection (`requireJevCredentials` and `createGateway` with `createJsonlCallLog` for `<output.dir>/run-<iso>/jev-calls.jsonl` only when no `gateway` is supplied), `resolveContext` with `providers` and `exec`, `assess`, `selectCapability`, the awaited Runtime_Hook, then one call to `resolveAfterAssessment` and `exitCodeFor`
    - Wrap thrown values with `wrapStage` for `context`, `assessment` and `runtime`, and never throw for a stage failure
    - Mark the Runtime_Hook call site with a comment naming issues #9 and #10; pass `runDir` only when one was computed
    - Resolve a config failure through `resolveOutcome` with `StageError('config', cause)` (ERROR, exit 1); write no `run.json`, `report.html` or other evidence file
    - Export the public surface from `run/index.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 5.4, 5.5, 6.1, 6.2, 6.3, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.5, 8.6, 8.7, 8.8, 8.10, 9.2, 9.3, 9.4, 9.6, 11.1, 11.2, 11.3, 11.4_

  - [x] 4.2 Write property test for run directory names
    - File: `packages/ce/src/run/pipeline.rundir.property.test.ts`, with the tag comment `// Feature: run-vertical-slice, Property 9: Run directory names`
    - Use `fc.date()` filtered to valid dates
    - **Property 9: Run directory names**
    - **Validates: Requirements 11.2**

  - [x] 4.3 Write property test for exit code attachment
    - Append to `packages/ce/src/run/resolve.property.test.ts`, with the tag comment `// Feature: run-vertical-slice, Property 7: Exit code comes from exitCodeFor`
    - Compare the `exitCode` of the pipeline's finishing step with `exitCodeFor(resolution, failOn)` for any Resolution and any `fail-on` list or `undefined`
    - **Property 7: Exit code comes from exitCodeFor**
    - **Validates: Requirements 3.4, 4.5, 6.7, 9.2, 9.3, 9.6**

  - [x] 4.4 Write pipeline tests
    - File: `packages/ce/src/run/pipeline.test.ts`, using a scripted gateway or `FakeJevGateway`, fixed `contextProviders`, an `exec` stub, a fixed `now` and a temporary `cwd`
    - `SKIPPED` with exit code 0 and Runtime_Hook not called; `UNSUPPORTED` with reason `surface-unsupported` and Surface `browser_ui` on an empty registry, Runtime_Hook not called, exit code 2 with `fail-on: ['unsupported']`
    - Context failure and Assessor failure resolve to `ERROR` with the matching `errorStage`, do not throw, and skip `selectCapability` and the hook
    - Fake `browser_ui` capability: hook called once with a `RuntimeHookInput` holding the gateway in use; one case resolves to `EVIDENCED`, one to `ERROR` with reason `no-observation`; a throwing hook resolves to `ERROR` with `errorStage: 'runtime'`; the result carries the capability name
    - Two capabilities on one Surface: only the first is called
    - Call order of stages; `resolveOutcome` called once per resolved run and not for a config failure
    - Config failures (invalid config, missing key, `createGateway` failure) resolve to `ERROR` with `errorStage` `config` and exit code 1, call neither the Context_Resolver nor the Assessor, and leak no key
    - No run directory or call log when `gateway` is supplied; only `jev-calls.jsonl` is written otherwise
    - _Requirements: 1.1, 3.1, 3.2, 3.3, 4.1, 4.3, 4.4, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.5, 8.6, 8.9, 8.10, 11.3, 11.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.9, 13.13_

- [x] 5. Replace the stub in `index.ts`
  - [x] 5.1 Update `packages/ce/src/index.ts`
    - Remove the stub, the `TODO(Milestone 1)` text, the placeholder error and the old `RunResult` interface
    - Re-export `run` from `./run/index.js`, and export `RunResult`, `ResolvedRun`, `RunOptions`, `createCapabilityRegistry`, `EMPTY_REGISTRY`, `selectCapability` and the hook types
    - Rewrite the module comment to describe the implemented slice and name the Runtime_Hook as the open part of the pipeline
    - Keep every existing export under the same name
    - _Requirements: 9.7, 12.1, 12.2, 12.3, 12.4_

  - [x] 5.2 Write tests for the stub removal
    - File: `packages/ce/src/index.test.ts`
    - Assert `TODO(Milestone 1)` is absent from `index.ts`, the placeholder error text is absent, and every export that existed before the change is still present
    - _Requirements: 12.1, 12.2, 12.4, 13.10_

- [x] 6. Implement the Run_Command
  - [x] 6.1 Create `packages/ce/src/run/command.ts`
    - Implement `parseRunArgs(argv)` after `parseArgs` of `eval/command.ts`: `--config`, `--base` and `--claim` in the forms `--name value` and `--name=value`; `--claim` repeatable and ordered; `null` for an unknown flag, a positional argument, a missing value, an empty value, a value starting with `--`, and a repeated `--config` or `--base`
    - Implement `runRunCommand(argv, deps)`: usage on stderr and exit 1 for `null` without calling `run()`; map `--config` to `flags.config`, `--base` to `cliOptions.base`, `--claim` to `cliOptions.claim`; pass `contextProviders` and `exec` through
    - Print `Outcome: <outcome>`, the `surface-unsupported` reason and Surface line, and the "no capability is registered for <surface> yet" hint for a v0 Surface; print the Stage_Error message, or the reason and Surface for an `ERROR` without a Stage_Error, to stderr
    - A config failure prints `Outcome: ERROR` like any ERROR; for an unexpected throw print `Outcome: ERROR` and the constructor name only, and return 1
    - Return the `exitCode` of the Run_Result without deciding an Outcome or exit code; do not call `process.exit`, read `process.env` or `process.cwd()`, or load `.env`
    - _Requirements: 2.8, 9.2, 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14, 10.15, 10.16_

  - [x] 6.2 Write property test for argument parsing
    - File: `packages/ce/src/run/command.args.property.test.ts`, with the tag comment `// Feature: run-vertical-slice, Property 8: Argument parsing round trip and rejection`
    - Round trip over mixed `--name value` and `--name=value` forms with ordered `claim`, and rejection for each invalid shape
    - **Property 8: Argument parsing round trip and rejection**
    - **Validates: Requirements 10.11, 10.12, 10.13, 10.14, 10.15, 13.7**

  - [x] 6.3 Write Run_Command tests
    - File: `packages/ce/src/run/command.test.ts`
    - Use a temporary `cwd`, an `env` with a dummy non-empty key for the selected provider, `contextProviders` returning fixed provider results, an `exec` stub for the `commitExists` probe, a `createGateway` returning a `FakeJevGateway`, and a fixed `now`
    - Build the recordings inside the test file: run `assess` once with a capturing wrapper around a scripted answerer, record `(idVersion, stateHash(request.state), question name, answer)` for each question, then build the `FakeJevGateway`
    - Assert `Outcome: SKIPPED` with exit code 0 in one test, and `Outcome: UNSUPPORTED` with the reason line, the hint line and the exit code in another
    - Cover `--claim=x`, repeated `--claim`, an unknown flag, an empty value, `--config` mapping to `flags.config`, `--base` mapping to `cliOptions.base`, and that `run()` is not called on a usage error
    - Cover a config failure (exit 1, report on stderr, no Context_Resolver call), an unexpected throw (`Outcome: ERROR` and the constructor name), and an `ERROR` without a Stage_Error (reason and Surface on stderr)
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 10.8, 10.10, 10.11, 10.12, 10.13, 10.14, 10.15, 10.16, 13.6, 13.7, 13.8, 13.9_

- [x] 7. Wire the CLI
  - [x] 7.1 Update the `run` case in `packages/ce/src/cli.ts`
    - Keep `loadEnvFileIfPresent`, then return `runRunCommand(rest, { env: process.env, cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr, createGateway: createJevGateway, now: () => new Date() })`
    - Replace the unused `run` import, and list `--config`, `--base` and `--claim` in the help text
    - Confirm the existing `cli.env.test.ts` still passes
    - _Requirements: 10.3, 14.3_

- [x] 8. Extend the architecture test (import rule only)
  - [x] 8.1 Update `packages/ce/src/outcome/architecture.test.ts`
    - Add assertions that the scanned set contains `index.ts` and the files of `run/`, and that these files do not import `@typesafe-ai/sdk`, do not call `fetch`, and do not import `jev/catalog`, reusing `importSpecifiers` and `sources`
    - Keep rules (a), (b) and (c) scoped to `outcome/`; do not apply rule (b) to `index.ts` or `run/`; add no duplicate of rule (d)
    - _Requirements: 1.5, 1.7, 2.6, 5.2, 13.11_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Run `npm run typecheck` and `npm test` from the repository root.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Each task references specific requirements for traceability.
- Property tests use fast-check (`^4.0.0`, already a devDependency) with at least 100 runs, and each carries a `// Feature: run-vertical-slice, Property <n>: <title>` tag comment.
- Do not edit `.kiro/specs/run-vertical-slice/.config.kiro`.
- Manual verification, not a task and not part of the automated suite (Requirement 13.15, issue #41 "Done when"): with a real API key set in the shell, run `ce run` in `examples/demo-app` and confirm the printed outcome is `SKIPPED` or `UNSUPPORTED`, not `ERROR`. Record the result in the pull request description. The automated counterpart is task 6.3.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.5", "2.1"] },
    { "id": 3, "tasks": ["1.4", "2.2", "2.5"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["2.4"] },
    { "id": 6, "tasks": ["3"] },
    { "id": 7, "tasks": ["4.1"] },
    { "id": 8, "tasks": ["4.2", "4.3", "4.4", "5.1", "6.1"] },
    { "id": 9, "tasks": ["5.2", "6.2", "6.3", "7.1", "8.1"] },
    { "id": 10, "tasks": ["9"] }
  ]
}
```
