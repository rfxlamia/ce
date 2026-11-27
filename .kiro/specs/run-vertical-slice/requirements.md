# Requirements Document

## Introduction

This feature wires the `run()` entry point of Continuous Evidence (CE) into a non-browser vertical slice: GitHub issue #41 in rfxlamia/ce, "[M2] Wire run(): config → context → assessment → outcome vertical slice". It is the first M2 item, before #9 and #10, so that the capability runtime and the browser loop have a pipeline to plug into. `SPEC.md` is normative (sections 4.2 and 7.1) and wins on any conflict with this document or the journal.

Today `run()` in `packages/ce/src/index.ts` is a stub that throws, marked `TODO(Milestone 1)`. Every M1 module is built and tested (`config/`, `context/`, `assessment/`, `outcome/`, `jev/`), but nothing calls them end to end, so `ce run` always prints `Outcome: ERROR` and exits with code 1.

This slice stops before any runtime. After the Assessment, a run resolves to `SKIPPED` when no evidence is required, and to `UNSUPPORTED` when evidence is required and no capability exists to produce it. This slice never produces `EVIDENCED` on its own. A stage failure resolves to `ERROR`. The outcome is decided only in `outcome/resolve.ts` (steering "Placement rules"). Jev question text stays in `jev/catalog.ts`. Tests use `FakeJevGateway` and need no API key, no network and no browser.

### Facts verified in the code

- F1. `run()` takes no arguments and returns `Promise<RunResult>` where `RunResult` is `{ outcome: ExecutionOutcome }`. It throws `Error('CE v0 implementation spike: not implemented yet')`.
- F2. `cli.ts` runs `main()` at module load and ends with `process.exit(code)`. `main` is not exported, so a test cannot call it. The `run` case loads `.env`, calls `run()` with no argument, prints `Outcome: <outcome>` and returns `0`, or on any thrown error prints `Outcome: ERROR` and the error message and returns `1`. It does not use `exitCodeFor`. It has no gateway injection and parses no `--config`, `--base` or `--claim` option.
- F3. `loadConfig({ cwd, flags, env })` returns `LoadedConfig` (`ok: true`, `config`, `meta`, `redacted`) or a `LoadFailure`. `reportConfigFailure(failure, secrets, stderr)` prints the failure and returns `1`. `collectSecretValues(env)` supplies the secrets. `requireJevCredentials(loaded, env)` checks the API key for the selected provider and runs before any gateway is created, so a test that goes through `createGateway` needs a non-empty key value for the selected provider in `env`. `reportConfigFailure` writes the report to `stderr` and always returns the literal `1`. `createJevGateway(loaded, env, { callLog })` returns `{ ok: true, gateway }` or `{ ok: false, errors }`.
- F4. `resolveContext({ config, cliOptions, env, cwd, providers?, exec? })` is synchronous and returns `ChangeContext`. It wraps every failure as `StageError('context', cause)`. Its default git runner `defaultExec` calls `spawnSync('git', ...)` with `env: { ...process.env, ...options.env }`, so the Context_Resolver itself spawns a process and reads `process.env`. `providers` replaces the `cli`, `github`, `git` and `junit` providers, and each provider returns a provider result, not a `ChangeContext`. Replacing the providers does not stop git from running: `resolveContext` also builds a `commitExists` probe on `exec` (a `git rev-parse --verify` call), which `selectBaseRef` and `selectHeadRef` call, and `exec` defaults to `defaultExec`. The optional `exec` parameter (a test hook) replaces that runner for the probe and is passed to the git provider.
- F5. `assess(context, config, gateway)` returns `Promise<{ claims: Claim[]; assessment: Assessment }>`. It calls `identifyClaims` (in `assessment/claims.ts`) and `combine` (in `assessment/combine.ts`) internally, and wraps every failure as `StageError('assessment', cause)`. `Assessment` carries `required`, `surface`, `claimStatus`, `decidedBy`, `perClaim` and `record`.
- F6. `resolveOutcome({ error?, assessment?, runtime?, supportedSurfaces? })` returns a `Resolution` (`outcome`, `reason`, optional `finalState`, `errorStage`, `surface`). Its default `supportedSurfaces` is `V0_SUPPORTED_SURFACES = ['browser_ui']`. With no `error` and no `assessment` it returns `ERROR` with reason `assessment-missing`. For a required Assessment on a supported surface with no `runtime` result it returns `ERROR` with reason `no-observation`. For a required Assessment on a surface not in `supportedSurfaces` it returns `UNSUPPORTED` with reason `surface-unsupported`.
- F7. `exitCodeFor(resolution, failOn)` returns `0 | 1 | 2 | 3`. The `output.fail-on` config value defaults to `['error']`.
- F8. `StageError` (in `packages/ce/src/errors.ts`) has `stage: 'context' | 'assessment' | 'runtime' | 'evidence'`. Its message holds the stage and the cause's constructor name only. No stage value fits a failure of `loadConfig`, `requireJevCredentials` or `createJevGateway`.
- F9. The capability runtime (`runtime/`), the evidence bundle (`evidence/`) and the GitHub Action do not exist. They belong to #9, #10 and later issues.
- F10. `examples/demo-app` is a Vite web application with a menu toggle and a counter. It is the Subject for later runtime work. Its directory has no `ce.yml`.
- F11. `FakeJevGateway` replays recordings keyed by `(id@version, stateHash, question name)` and throws `FakeRecordingMissingError` when no recording matches. The `stateHash` derives from the request state, which derives from the `ChangeContext`. A real git diff of `examples/demo-app` changes with every commit, so a recorded answer set does not stay valid against a live repository.
- F12. `runEvalCommand(argv, deps)` in `eval/command.ts` is the existing pattern for a testable command. Its `deps` are `env`, `cwd`, `stdout`, `stderr`, `createGateway` and `now`. It calls no `process.exit`, reads no `process.env` and loads no `.env`. Its module-private `parseArgs` accepts `--name value` and `--name=value`, and returns `null` (which prints usage and returns `1`) for an unknown flag, a positional argument, a missing value, an empty value, a value that starts with `--`, and a repeated flag. It names its output directory `eval-<iso>`, with `:` and `.` of the ISO string replaced by `-`.
- F13. The existing `outcome/architecture.test.ts` scans all non-test files under `packages/ce/src/`. Its rules (a), (b) and (c) apply only to files under `outcome/`: (a) forbids imports of fs, child_process, http, playwright, the SDK, `jev/` and `runtime/`, (b) forbids `process.env`, `Date`, `Math.random` and `performance`, and (c) requires type-only imports from `assessment/`, `context/` and `errors.ts`. Rule (d) applies to all scanned files and fails when a file other than `outcome/resolve.ts` assigns, returns or casts to an Outcome literal. A comparison such as `=== 'ERROR'` is allowed. The scan offers helpers (`importSpecifiers`, `sources`) that a new test can reuse for files outside `outcome/`.

### Design implications

- I1. Because `resolveOutcome` returns `ERROR` for a required, supported surface with no runtime result (F6), the slice cannot pass the default `supportedSurfaces` while no capability exists. The slice passes the set of surfaces for which a capability is registered, which is empty until #9 and #10 land. A required Assessment then resolves to `UNSUPPORTED` for every surface, including `browser_ui`, and the outcome is never faked as `EVIDENCED`. This keeps the outcome decision inside `outcome/resolve.ts`.
- I2. The registry of available capabilities is the hook point that #9 and #10 will fill in. Registering a browser capability changes which surfaces `resolveOutcome` treats as supported and enables the runtime stage, without editing the callers of `loadConfig`, `resolveContext`, `assess` or `resolveOutcome`. The Runtime_Hook takes one input object (`RuntimeHookInput`), so that #10 can add fields without a breaking signature change.
- I6. The Runtime_Hook is asynchronous, so the pure Post_Assessment_Resolver cannot call it. The pipeline therefore selects the capability with the pure `selectCapability`, awaits the Runtime_Hook, and then calls the Post_Assessment_Resolver once with the `RuntimeResult` or with the runtime error. This keeps exactly one `resolveOutcome` call per run.
- I3. A config failure has no `Stage` (F8) and no Assessment, and `resolveOutcome({})` would report the misleading reason `assessment-missing` (F6). The slice therefore does not route a config failure through `resolveOutcome`. `run()` returns a second result variant for it. `errors.ts` and `outcome/resolve.ts` stay unchanged.
- I4. Because `main` cannot be called by a test (F2) and a live git diff defeats recorded answers (F11), the `run` command is extracted as `runRunCommand(argv, deps)` after the pattern of `runEvalCommand` (F12). Tests call it with a fixed context through `contextProviders` and with recorded answers for that context. The real `ce run` on `examples/demo-app` needs an API key and stays a manual verification step.
- I5. The "Run_Pipeline" is limited to `packages/ce/src/index.ts` and `packages/ce/src/run/`. The git process and the `process.env` merge of F4 belong to the Context_Resolver, not to the Run_Pipeline.

## Glossary

- **Run_Pipeline**: The `run()` function in `packages/ce/src/index.ts` and the files in `packages/ce/src/run/` that it uses, excluding the Run_Command. It sequences the stages and decides no Outcome itself. The Config_Loader, Context_Resolver, Assessor and Outcome_Resolver are not part of the Run_Pipeline.
- **Run_Command**: The `runRunCommand(argv, deps)` function in `packages/ce/src/run/command.ts`. It parses arguments, calls `run()`, prints the summary and returns the exit code.
- **Config_Loader**: The `loadConfig` function and `requireJevCredentials` in `packages/ce/src/config/`.
- **Context_Resolver**: The `resolveContext` function in `packages/ce/src/context/`.
- **Assessor**: The `assess` function in `packages/ce/src/assessment/`, which uses claim identification and `combine`.
- **Outcome_Resolver**: The `resolveOutcome` function in `packages/ce/src/outcome/resolve.ts`, the only place where an Outcome is decided.
- **Post_Assessment_Resolver**: The pure function `resolveAfterAssessment` of the Run_Pipeline. It receives an optional Assessment, a Capability_Registry, an optional `RuntimeResult` and an optional `error` of type `StageError`. It calls `resolveOutcome` once and returns the `Resolution`. It calls no Runtime_Hook.
- **Select_Capability**: The pure function `selectCapability(assessment, registry)` of the Run_Pipeline. It returns the first registered capability when the Assessment has `required` equal to `true` and the capability supports the Assessment `surface`, and `undefined` otherwise.
- **RuntimeHookInput**: The single object that a Runtime_Hook receives. Its fields are `context`, `claims`, `assessment`, `config`, `gateway`, and the optional `runDir` and `signal`.
- **Exit_Code_Mapper**: The `exitCodeFor` function in `packages/ce/src/outcome/exit-code.ts`.
- **Jev_Gateway**: The `JevGateway` interface of `packages/ce/src/jev/`. `FakeJevGateway` is its test implementation.
- **Capability_Registry**: The Run_Pipeline's validated list of runtime capabilities that are available, each declaring the Surfaces it can observe. It is a branded type that only `createCapabilityRegistry(entries)` returns, so that a raw array cannot bypass validation. It is empty in this feature.
- **Runtime_Hook**: The single, named place in the Run_Pipeline between the Assessment and the Outcome_Resolver where the capability runtime of #9 and #10 plugs in.
- **Resolved_Run**: The variant of Run_Result that carries a `Resolution`. Its `kind` is `resolved`.
- **Config_Failure_Run**: The variant of Run_Result for a failure of the Config_Loader or of Jev_Gateway creation. Its `kind` is `config-failure`.
- **Run_Result**: The value `run()` returns. It is the union of Resolved_Run and Config_Failure_Run.
- **CLI**: The `ce` command in `packages/ce/src/cli.ts`.
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC section 7.1).
- **Surface**: The `Surface` type of `assessment/types.ts`.
- **Resolution**: The `Resolution` type of `outcome/types.ts`.
- **Stage_Error**: A `StageError` instance (`errors.ts`).
- **Demo_App**: The application in `examples/demo-app`.

## Requirements

### Requirement 1: Pipeline sequence

**User Story:** As a developer, I want `run()` to call the existing stages in order, so that `ce run` produces a real result instead of a stub error.

#### Acceptance Criteria

1. WHEN `run()` is called, THE Run_Pipeline SHALL call the Config_Loader, then the Context_Resolver, then the Assessor, then Select_Capability, then the Runtime_Hook (only WHERE Select_Capability returned a capability), then the Post_Assessment_Resolver, in that order.
2. THE Run_Pipeline SHALL pass the `EffectiveConfig` of the Config_Loader to the Context_Resolver and to the Assessor.
3. THE Run_Pipeline SHALL pass the `ChangeContext` of the Context_Resolver to the Assessor.
4. THE Run_Pipeline SHALL pass the `Assessment` of the Assessor to the Outcome_Resolver in the `assessment` field of `ResolveInput`, through the Post_Assessment_Resolver, which is the only caller of `resolveOutcome` in the Run_Pipeline.
5. THE Run_Pipeline SHALL reach Jev only through the Jev_Gateway interface, and SHALL NOT import the Jev SDK or call `fetch` for Jev.
6. THE Run_Pipeline SHALL obtain claim identification and the combined `required` and `surface` values only through the Assessor, and SHALL NOT call `identifyClaims` or `combine` itself.
7. THE Run_Pipeline SHALL NOT contain Jev question text and SHALL NOT import `jev/catalog`.

### Requirement 2: Injectable dependencies

**User Story:** As a developer, I want `run()` to accept its environment, its clock, its output stream and its Jev gateway, so that tests run with the fake gateway and without an API key.

#### Acceptance Criteria

1. THE `run()` function SHALL accept an optional options object with the fields `cwd`, `env`, `flags`, `cliOptions`, `gateway`, `createGateway`, `capabilities`, `contextProviders`, `exec`, `now` and `stderr`, WHERE `capabilities` has the Capability_Registry type that `createCapabilityRegistry` returns.
2. WHEN a field is omitted, THE Run_Pipeline SHALL use `process.cwd()` for `cwd`, `process.env` for `env`, an empty object for `flags` and for `cliOptions`, `createJevGateway` for `createGateway`, an empty Capability_Registry for `capabilities`, the default providers of the Context_Resolver for `contextProviders`, the default git runner of the Context_Resolver for `exec`, `() => new Date()` for `now`, and `process.stderr` for `stderr`.
3. WHERE `gateway` is supplied, THE Run_Pipeline SHALL use it and SHALL NOT call `requireJevCredentials` or `createGateway`.
4. WHEN `gateway` is omitted, THE Run_Pipeline SHALL call `requireJevCredentials` and then `createGateway` with the loaded config, the supplied `env` and a `callLog` option.
5. WHEN `run()` is called with no argument, THE Run_Pipeline SHALL behave as it does with the defaults of criterion 2.
6. THE Run_Pipeline SHALL NOT read `process.env`, `process.cwd()`, `process.stderr` or the clock anywhere except in the defaults of criterion 2.
7. THE Run_Pipeline SHALL pass `contextProviders` to the `providers` field of the Context_Resolver, and `exec` to the `exec` field of the Context_Resolver.
8. THE Run_Command SHALL receive its own `stdout` stream through its deps (Requirement 10), because `run()` writes nothing to `stdout`.

### Requirement 3: SKIPPED outcome

**User Story:** As a reviewer, I want `ce run` to report `SKIPPED` when no claim needs runtime evidence, so that CE does not duplicate adequate verification.

#### Acceptance Criteria

1. WHEN the Assessment has `required` equal to `false`, THE Run_Pipeline SHALL resolve the run to `SKIPPED` with reason `not-required`.
2. WHEN the Assessment has `required` equal to `false`, THE Run_Pipeline SHALL NOT call the Runtime_Hook.
3. THE Resolved_Run SHALL carry the `Assessment` `surface`, `claimStatus` and `decidedBy` that led to `SKIPPED`.
4. WHEN the outcome is `SKIPPED`, THE Exit_Code_Mapper SHALL yield exit code `0` for the default `output.fail-on`.

### Requirement 4: UNSUPPORTED outcome

**User Story:** As a reviewer, I want `ce run` to report `UNSUPPORTED` with a reason when evidence is needed and no capability exists, so that "not needed" and "not possible" stay distinct and CE never fakes `EVIDENCED`.

#### Acceptance Criteria

1. WHEN the Assessment has `required` equal to `true` and the Capability_Registry holds no capability for the Assessment `surface`, THE Run_Pipeline SHALL resolve the run to `UNSUPPORTED` with reason `surface-unsupported`.
2. THE Run_Pipeline SHALL pass the union of the Surfaces of the registered capabilities as `supportedSurfaces` to the Outcome_Resolver, so that an empty Capability_Registry yields `UNSUPPORTED` for every Surface including `browser_ui`.
3. WHEN the outcome is `UNSUPPORTED`, THE Resolved_Run SHALL carry the Resolution `reason` and the Resolution `surface`.
4. WHILE the Capability_Registry is empty, THE Run_Pipeline SHALL NOT resolve any run to `EVIDENCED`.
5. WHEN the outcome is `UNSUPPORTED`, THE Exit_Code_Mapper SHALL yield exit code `0` for the default `output.fail-on`, and exit code `2` WHERE `output.fail-on` contains `unsupported`.

The CLI output for `UNSUPPORTED` is specified once, in Requirement 10 criterion 4.

### Requirement 5: Outcome decided only by the Outcome_Resolver

**User Story:** As a maintainer, I want one place that decides the outcome, so that the design rule holds and the outcome is testable in isolation.

#### Acceptance Criteria

1. THE Run_Pipeline SHALL obtain every Outcome from a call to `resolveOutcome`.
2. THE Run_Pipeline SHALL NOT assign the literals `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` or `ERROR` to an Outcome outside `outcome/resolve.ts`.
3. THE Run_Pipeline SHALL NOT use a model answer, a probability or a Jev response to choose the Outcome, other than through the `Assessment` fields that `resolveOutcome` reads.
4. WHEN the Run_Pipeline returns a Resolved_Run, THE Run_Pipeline SHALL have called `resolveOutcome` exactly once.
5. WHEN the Run_Pipeline returns a Config_Failure_Run, THE Run_Pipeline SHALL NOT have called `resolveOutcome`, because no Outcome exists for a run that never started a stage.

### Requirement 6: Stage failures resolve to ERROR

**User Story:** As a developer, I want a failing stage to end the run as `ERROR` with the stage named, so that failures are visible and the process exit code is correct.

#### Acceptance Criteria

1. IF the Context_Resolver throws a Stage_Error, THEN THE Run_Pipeline SHALL call the Post_Assessment_Resolver with that error and without an Assessment, so that `resolveOutcome` receives it in the `error` field, and SHALL NOT call the Assessor, Select_Capability or the Runtime_Hook.
2. IF the Assessor throws a Stage_Error, THEN THE Run_Pipeline SHALL call the Post_Assessment_Resolver with that error, so that `resolveOutcome` receives it in the `error` field, and SHALL NOT call Select_Capability or the Runtime_Hook.
3. IF a stage throws a value that is not a Stage_Error, THEN THE Run_Pipeline SHALL wrap it as `StageError` for the stage that was running, and SHALL then apply criteria 1 and 2.
4. WHEN a stage failure is resolved, THE Resolved_Run SHALL carry `outcome` `ERROR`, `reason` `stage-error`, the `errorStage` of the Stage_Error and the Stage_Error in its `error` field.
5. IF a stage fails, THEN THE Run_Pipeline SHALL return the Resolved_Run and SHALL NOT throw.
6. THE Run_Pipeline SHALL NOT copy the message of a stage cause into the Resolved_Run, and the `error` field SHALL hold the Stage_Error whose message names the stage and the cause's constructor name only.
7. WHEN the outcome is `ERROR` and `output.fail-on` contains `error`, THE Exit_Code_Mapper SHALL yield exit code `1`.

### Requirement 7: Config and credential failures

**User Story:** As a developer, I want invalid configuration or a missing API key to produce the same report that `ce eval` gives, so that `ce run` and `ce eval` behave alike.

#### Acceptance Criteria

1. IF `loadConfig` returns a failure, THEN THE Run_Pipeline SHALL report it through `reportConfigFailure` with the secrets of `collectSecretValues(env)` and the `stderr` option, and SHALL return a Config_Failure_Run.
2. IF `requireJevCredentials` returns a failure and no `gateway` was supplied, THEN THE Run_Pipeline SHALL report it through `reportConfigFailure` and return a Config_Failure_Run.
3. IF `createGateway` returns a failure, THEN THE Run_Pipeline SHALL report it through `reportConfigFailure` and return a Config_Failure_Run.
4. IF a configuration failure ends the run, THEN THE Run_Pipeline SHALL NOT call the Context_Resolver, the Assessor, the Outcome_Resolver or any Jev request.
5. THE Run_Pipeline SHALL NOT write an API key or any secret value to the Run_Result, to stdout or to stderr.
6. THE Config_Failure_Run SHALL contain `kind` equal to `config-failure` and `exitCode` equal to the value that `reportConfigFailure` returned (the literal `1`), and SHALL contain no `outcome` field.

### Requirement 8: Runtime hook point and Capability_Registry

**User Story:** As the developer of #9 and #10, I want one clearly named place where the capability runtime plugs in, so that I add the runtime without rewriting the pipeline.

#### Acceptance Criteria

1. THE Run_Pipeline SHALL define a Runtime_Hook, a function type that receives one `RuntimeHookInput` object and returns a `Promise` of a `RuntimeResult` of `outcome/types.ts`, WHERE `RuntimeHookInput` holds `context` (the `ChangeContext`), `claims`, `assessment`, `config` (the `EffectiveConfig`), `gateway` (the Jev_Gateway in use), `runDir` (optional, the run directory of Requirement 11, absent WHERE none was created) and `signal` (optional `AbortSignal`).
2. THE Run_Pipeline SHALL define the Capability_Registry as a list of entries, each with a unique name, the Surfaces it supports and a Runtime_Hook, created through `createCapabilityRegistry(entries)`.
3. IF `createCapabilityRegistry` receives two entries with the same name, THEN THE Run_Pipeline SHALL throw an error that names the duplicate, before any stage runs.
4. IF `createCapabilityRegistry` receives an entry with a Surface that is not in `V0_SUPPORTED_SURFACES`, THEN THE Run_Pipeline SHALL throw an error that names the Surface, so that every registry Surface is a member of `V0_SUPPORTED_SURFACES`.
5. WHEN Select_Capability returns a capability, THE Run_Pipeline SHALL call the Runtime_Hook of that capability once with a `RuntimeHookInput`, and pass its `RuntimeResult` to the Post_Assessment_Resolver, which passes it in the `runtime` field of `ResolveInput`.
6. IF a Runtime_Hook throws, THEN THE Run_Pipeline SHALL wrap the failure as `StageError('runtime', cause)` unless it already is a Stage_Error, and pass it as `error` to the Post_Assessment_Resolver, so that `resolveOutcome` is still called exactly once.
7. THE Run_Pipeline SHALL mark the Runtime_Hook call site with a comment that names issues #9 and #10.
8. WHILE the Capability_Registry is empty, THE Run_Pipeline SHALL NOT start a browser, start a process or open a network connection, other than the git process of the Context_Resolver and the Jev requests of the Assessor.
9. WHEN a test registers a fake capability for `browser_ui` that returns a valid `RuntimeResult`, THE Run_Pipeline SHALL resolve the run through `resolveOutcome` without any change to the stages before it.
10. THE Resolved_Run SHALL carry the name of the capability whose Runtime_Hook was called, WHERE one was called.
11. WHEN Select_Capability receives an Assessment with `required` equal to `false`, or a `surface` that no registered capability supports, THE Select_Capability SHALL return `undefined`, and WHEN several registered capabilities support the `surface`, THE Select_Capability SHALL return the first one in registration order.

### Requirement 9: Run result and exit code

**User Story:** As a developer, I want `run()` to return the resolution and the exit code, so that the CLI and tests read one value.

#### Acceptance Criteria

1. THE Resolved_Run SHALL contain `kind` equal to `resolved` and the fields of the Resolution (`outcome`, `reason`, and where present `surface`, `errorStage` and `finalState`) at its top level.
2. THE Resolved_Run SHALL contain an `exitCode` that the Exit_Code_Mapper computes from the Resolution and from `output.fail-on` of the `EffectiveConfig`.
3. WHERE `output.fail-on` is absent from the loaded config, THE Run_Pipeline SHALL compute the exit code of a Resolved_Run with the default `output.fail-on` of `['error']`.
4. THE Resolved_Run SHALL contain the `claims` and the `Assessment` when the Assessor completed, and the Stage_Error in `error` when a stage failed.
5. THE Resolved_Run SHALL be assignable to `{ outcome: ExecutionOutcome }`, so that code that reads `outcome` compiles after narrowing the Run_Result with `result.kind === 'resolved'`, and THE Run_Result SHALL be typed as the discriminated union `Resolved_Run | Config_Failure_Run` on `kind`.
6. THE Run_Pipeline SHALL NOT compute the exit code of a Resolved_Run anywhere except through `exitCodeFor`.
7. THE `RunResult` type exported from `packages/ce/src/index.ts` SHALL be the Run_Result union.

### Requirement 10: Run_Command and CLI behavior

**User Story:** As a developer, I want `ce run` to print the outcome and exit with the mapped code, and I want the command to be testable, so that CI sees the right status and the behavior is verified without a live repository.

#### Acceptance Criteria

1. THE Run_Command SHALL be the function `runRunCommand(argv, deps)` in `packages/ce/src/run/command.ts`, with `deps` holding `env`, `cwd`, `stdout`, `stderr`, `createGateway`, `now` and the optional `contextProviders` and `exec`, and SHALL return the exit code as a `Promise<number>`.
2. THE Run_Command SHALL NOT call `process.exit`, SHALL NOT read `process.env` or `process.cwd()`, and SHALL NOT load `.env`, in the manner of `runEvalCommand`.
3. THE CLI SHALL handle `run` by loading `.env` as it does today, then calling `runRunCommand` with `process.env`, `process.cwd()`, `process.stdout`, `process.stderr`, `createJevGateway` and `() => new Date()`, and SHALL return its exit code.
4. WHEN the Run_Result is a Resolved_Run, THE Run_Command SHALL print `Outcome: <outcome>` to stdout, and WHEN its reason is `surface-unsupported`, THE Run_Command SHALL print the reason and the Surface on a separate line.
5. WHEN the reason is `surface-unsupported` and the Surface is a member of `V0_SUPPORTED_SURFACES`, THE Run_Command SHALL print a further line that states that no capability is registered for the Surface yet.
6. WHEN the Resolved_Run has `outcome` `ERROR` and carries a Stage_Error, THE Run_Command SHALL print the Stage_Error message to stderr.
7. WHEN the Resolved_Run has `outcome` `ERROR` and carries no Stage_Error, THE Run_Command SHALL print the Resolution `reason` (for example `no-observation` or `evidence-incomplete`) and the Surface, where present, to stderr.
8. WHEN the Run_Result is a Config_Failure_Run, THE Run_Command SHALL print nothing further to stdout, because `reportConfigFailure` already wrote to stderr, and SHALL return `1`.
9. THE Run_Command SHALL return the `exitCode` of the Run_Result and SHALL NOT decide an Outcome or an exit code itself.
10. IF `run()` throws an unexpected error, THEN THE Run_Command SHALL print `Outcome: ERROR` to stdout, as in criterion 4, print the constructor name of the error to stderr, and return `1`.
11. THE Run_Command SHALL parse `--config <path>`, `--base <ref>` and `--claim <text>`, in the forms `--name value` and `--name=value`, with the rules of `parseArgs` in `eval/command.ts`, except that `--claim` MAY be repeated.
12. WHERE the Run_Command receives `--config <path>`, THE Run_Command SHALL pass it to `run()` as the `config` entry of `flags`.
13. WHERE the Run_Command receives `--base <ref>`, THE Run_Command SHALL pass it to `run()` as `base` in `cliOptions`.
14. WHERE the Run_Command receives one or more `--claim <text>` options, THE Run_Command SHALL pass them to `run()` as `claim` in `cliOptions`, in the order given.
15. IF the arguments contain an unknown flag, a positional argument, a missing value, an empty value, a value that starts with `--`, or a repeated `--config` or `--base`, THEN THE Run_Command SHALL print the usage text to stderr, return `1` and SHALL NOT call `run()`.
16. THE Run_Command SHALL pass `contextProviders` and `exec` from its deps to `run()`.

### Requirement 11: Jev call log

**User Story:** As a developer, I want the Jev calls of a run to be logged without state contents, so that I can inspect them the way I inspect `ce eval` runs.

#### Acceptance Criteria

1. WHEN the Run_Pipeline calls `createGateway`, THE Run_Pipeline SHALL pass `createJsonlCallLog` for a `jev-calls.jsonl` file in a run directory under `output.dir`, resolved against `cwd`, which defaults to `.ce/runs`.
2. THE Run_Pipeline SHALL name the run directory `run-<iso>`, where `<iso>` is `now().toISOString()` with `:` and `.` replaced by `-`, so that run directories are distinguishable from the `eval-<iso>` directories in `.ce/runs`.
3. WHERE `gateway` is supplied, THE Run_Pipeline SHALL NOT create a run directory or a call log.
4. THE Run_Pipeline SHALL NOT write `run.json`, `report.html` or any other evidence file, which belong to later issues.

### Requirement 12: Stub removal

**User Story:** As a maintainer, I want the stub gone, so that the code no longer claims the slice is unimplemented.

#### Acceptance Criteria

1. THE `packages/ce/src/index.ts` file SHALL NOT contain the text `TODO(Milestone 1)`.
2. THE `run()` function SHALL NOT throw `CE v0 implementation spike: not implemented yet` or any equivalent placeholder error.
3. THE module comment of `packages/ce/src/index.ts` SHALL describe the implemented slice and name the Runtime_Hook as the open part of the pipeline.
4. THE existing exports of `packages/ce/src/index.ts` SHALL remain available under the same names.

### Requirement 13: Tests and verification

**User Story:** As a maintainer, I want tests that cover both non-browser outcomes with the fake gateway, and a documented manual check against the demo app, so that the issue can close with proof.

#### Acceptance Criteria

1. THE test suite SHALL include a test that runs the Run_Pipeline with `FakeJevGateway` on a Change whose Assessment has `required` equal to `false`, and asserts `SKIPPED` and exit code `0`.
2. THE test suite SHALL include a test that runs the Run_Pipeline with `FakeJevGateway` on a Change whose Assessment has `required` equal to `true` and `surface` equal to `browser_ui`, with an empty Capability_Registry, and asserts `UNSUPPORTED`, reason `surface-unsupported` and surface `browser_ui`.
3. THE test suite SHALL include a test for each of the following failures: a Context_Resolver failure and an Assessor failure, and assert `ERROR` and the matching `errorStage`.
4. THE test suite SHALL include a test with a fake capability registered for `browser_ui`, and assert that the Runtime_Hook is called and that its `RuntimeResult` reaches `resolveOutcome`, including one case whose `RuntimeResult` resolves to `ERROR` with reason `no-observation` and one whose `RuntimeResult` resolves to `EVIDENCED`.
5. THE test suite SHALL include a test that asserts the Runtime_Hook is not called for `SKIPPED` and for `UNSUPPORTED`.
6. THE test suite SHALL include Run_Command tests that call `runRunCommand` with a temporary `cwd`, an `env` that holds a dummy non-empty API key for the selected provider (because `requireJevCredentials` runs before `createGateway`), a `contextProviders` value whose `cli`, `github`, `git` and `junit` providers return fixed provider results, an `exec` stub that answers the `commitExists` probe without running git, a `createGateway` that returns a `FakeJevGateway` holding recorded answers for the context that results, and a fixed `now`, and assert that the printed outcome is `SKIPPED` in one test and `UNSUPPORTED` in another, with the returned exit code and the hint line of Requirement 10 criterion 5 for `UNSUPPORTED`.
7. THE test suite SHALL include Run_Command tests for each argument rule of Requirement 10 criteria 11 to 15, including the `--claim=x` form, a repeated `--claim`, an unknown flag and an empty value.
8. THE test suite SHALL include a Run_Command test for a Config_Failure_Run that asserts exit code `1`, a report on stderr and no call to the Context_Resolver.
9. THE test suite SHALL run without a real `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` in `process.env`, without a network connection, without a browser, without a live git repository and without starting the git binary.
10. THE test suite SHALL include a test that asserts the `TODO(Milestone 1)` text is absent from `packages/ce/src/index.ts`.
11. THE test suite SHALL extend the existing `outcome/architecture.test.ts` with an import rule only: assertions that the scanned set contains `index.ts` and the files of `run/`, that these files do not import `@typesafe-ai/sdk`, do not call `fetch`, and do not import `jev/catalog`. Rules (a), (b) and (c) of that file SHALL stay scoped to `outcome/`, and in particular rule (b) SHALL NOT be applied to `index.ts` or `run/`, because the defaults of Requirement 2 criterion 2 legitimately use `process.env` and `Date`. The test suite SHALL rely on the existing rule (d) for the Outcome literals, without a duplicate rule.
12. THE test suite SHALL include a test that asserts every Surface of a registry accepted by `createCapabilityRegistry` is a member of `V0_SUPPORTED_SURFACES`, and a test for the duplicate-name and unsupported-Surface errors of Requirement 8 criteria 3 and 4.
13. THE test suite SHALL include a test of Requirement 8 criteria 5 and 11 with two capabilities registered for the same Surface, asserting that Select_Capability returns, and the Run_Pipeline calls, the first registered one only, and a test that the Runtime_Hook receives a `RuntimeHookInput` with the `gateway` in use.
14. FOR ALL Assessments with `required` equal to `false`, THE Post_Assessment_Resolver SHALL resolve to `SKIPPED`, and FOR ALL Assessments with `required` equal to `true` and an empty Capability_Registry, THE Post_Assessment_Resolver SHALL resolve to `UNSUPPORTED` (property test with fast-check over `Surface` and `claimStatus`, calling the pure function without `assess` or a gateway), and FOR ALL such Assessments, Select_Capability SHALL return `undefined` for an empty Capability_Registry.
15. THE manual verification step SHALL be: with a real API key, run `ce run` in `examples/demo-app` and confirm that the printed outcome is `SKIPPED` or `UNSUPPORTED` and not `ERROR`. THE pull request description SHALL record the result, and the step SHALL NOT be part of the automated test suite.

### Requirement 14: Issue checklist traceability

**User Story:** As a maintainer, I want every item of issue #41 mapped to requirements, so that one pull request can close the issue.

#### Acceptance Criteria

1. THE Run_Pipeline SHALL satisfy checklist item 1, "run() calls loadConfig → context resolver → assessment (claims/assess/combine) → resolveOutcome", through Requirements 1, 2 and 5.
2. THE Run_Pipeline SHALL satisfy checklist item 2, "Non-browser path only: SKIPPED when no claim needs runtime evidence, UNSUPPORTED with reason when a needed capability does not exist, never fake EVIDENCED", through Requirements 3 and 4.
3. THE Run_Pipeline SHALL satisfy checklist item 3, "Stage failures surface as ERROR via StageError, exit code via exitCodeFor", through Requirements 6, 7, 9 and 10.
4. THE Run_Pipeline SHALL satisfy checklist item 4, "Leave a clear hook point where the capability runtime will plug in", through Requirement 8.
5. THE Run_Pipeline SHALL satisfy checklist item 5, "Remove the TODO(Milestone 1) stub", through Requirement 12.
6. THE test suite and the manual verification step SHALL satisfy the "Done when" line, "`ce run` on examples/demo-app outputs SKIPPED or UNSUPPORTED (not ERROR), with a test covering both", through Requirement 13 criteria 1, 2 and 6 (automated tests covering both outcomes through `runRunCommand` with a fixed context), Requirement 13 criterion 15 (the manual `ce run` on `examples/demo-app` with a real API key), and Requirement 10.
