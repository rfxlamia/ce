# Implementation Plan: runtime-target

## Overview

This plan builds the Target_Manager of issue #9 (rfxlamia/ce), `packages/ce/src/runtime/target.ts`. The implementation language is TypeScript (Node.js 22.12 or later), as in `design.md`. Work proceeds from the pure helpers, errors and types, to the log capture pipeline, to Attach_Mode and the readiness loop, to Start_Mode and the stop state machine, then to the integration tests against `examples/demo-app`, the `RunCommandDeps.capabilities` seam, the architecture test and the issue #9 verification.

All of the Target_Manager lives in one file, `runtime/target.ts`, so the implementation tasks that edit it are placed in separate waves. Unit and property tests inject `fetch`, `spawn`, `now`, `sleep` and `process`, and need no network, process, browser or API key. Only the integration tests of tasks 7.2 and 7.3 use real processes, and they use loopback only. `runtime/target.ts` never decides an Outcome, never imports `playwright`, `@typesafe-ai/sdk`, `jev/` or `outcome/`, and contains no Jev question text.

Issue #9 coverage:

- Checklist item 1 (attach to a running URL): tasks 4.1, 4.3, 7.2.
- Checklist item 2 (start, readiness, capture, stop on exit): tasks 2.1, 4.1, 5.1, 5.3, 5.4, 7.2.
- Checklist item 3 (unreachable resolves to `ERROR` with URL and last status): tasks 4.1, 4.2, 7.2, 8.1, 8.2.
- Checklist item 4 (never modify the target): tasks 5.1, 5.3, 7.3.
- "Done when" line (works against `examples/demo-app`, attached and started): tasks 7.1, 7.2, 10.1.

## Tasks

- [x] 1. Define types, errors and pure helpers
  - [x] 1.1 Create `packages/ce/src/runtime/target.ts` with the public surface and pure helpers
    - Define `TargetOptions`, `TargetHandle` and the `lastStatus` union exactly as in `design.md`
    - Export the error classes `TargetUnreachableError` (`url`, `lastStatus`, `timeoutMs`, `mode`, optional `logTail`), `TargetStartError` (`command`, `exitCode`, `signal`, optional `logTail`) and `TargetConfigError` (optional `key`); no message carries the log capture
    - Export the pure functions `buildProbeUrl(baseUrl, readyPath)` (append to the base path, drop query and fragment, never `new URL(path, base)`), `classifyStatus(status)` and `redactUrl(url)` (userinfo replaced by `***`, unchanged without userinfo)
    - Add the internal helpers `isLoopbackHost`, the per-probe timeout `min(2000, remainingMs)`, the probe-failure to `lastStatus` mapping (`ECONNREFUSED`, `ENOTFOUND`/`EAI_AGAIN`, abort, other) reading `error.cause.code` or `error.code`, and the defaults (`ready.path` `/`, `ready.timeout` `30s` through `parseDuration`)
    - Implement `targetOptionsFromConfig(config, extras)` that maps only `target.url`, `target.start`, `target.ready.path`, `target.ready.timeout` and the caller's `cwd`, `env`, `runDir`, `signal`
    - Leave `openTarget` as an exported stub that throws until task 4.1; import nothing from `playwright`, `@typesafe-ai/sdk`, `jev/` or `outcome/`
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.10, 4.3, 4.4, 4.7, 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.1, 9.2_

  - [x] 1.2 Write property tests for the pure helpers
    - File: `packages/ce/src/runtime/target.pure.property.test.ts`, each property with a tag comment `// Feature: runtime-target, Property N: <title>` and a `**Validates**` line, at least 100 runs
    - [x] 1.2.1 **Property 4: `buildProbeUrl` is slash-insensitive and keeps the base path as a prefix**
      - **Validates: Requirements 3.2, 8.5**
    - [x] 1.2.2 **Property 5: `classifyStatus` is ready exactly for 200-399**
      - Cover all integers from 100 to 599
      - **Validates: Requirements 3.3, 3.5, 8.6**
    - [x] 1.2.3 **Property 6: Per-probe timeout is the minimum of 2000 ms and the remaining Ready_Timeout**
      - **Validates: Requirements 3.6**
    - [x] 1.2.4 **Property 7: `redactUrl` removes userinfo and is a no-op without it**
      - Include the error-message half of the property in task 4.2, where `openTarget` throws for such a URL
      - **Validates: Requirements 4.7, 8.7**

  - [x] 1.3 Write unit tests for the helpers and the config mapping
    - File: `packages/ce/src/runtime/target.helpers.test.ts`
    - Cover the three `buildProbeUrl` examples of Requirement 3.2, the failure-kind table (each error code, abort and unknown), the loopback list (`localhost`, `127.x.y.z`, `::1`, `0.0.0.0` and a remote host), the defaults, and that `targetOptionsFromConfig` sets only the mapped fields
    - _Requirements: 3.1, 3.2, 3.6, 4.3, 8.2, 8.4, 9.2_

- [x] 2. Implement the log capture pipeline
  - [x] 2.1 Add the log capture to `packages/ce/src/runtime/target.ts`
    - Per stream, implement the five steps of Requirement 5.8: decode with a UTF-8 decoder that keeps partial sequences, join with the Held_Tail, redact the whole buffer (longer secret values first), keep the last L-1 characters as the new Held_Tail, release the rest
    - Build the effective secret list as the union of `secrets` and `OPENROUTER_API_KEY`, `TYPESAFE_API_KEY`, and read the non-empty values from `options.env`
    - Bound the in-memory capture to 262144 UTF-8 bytes, drop the oldest text first and cut at a character boundary; keep arrival order and stream labels
    - Write released text to `<runDir>/target.log` as it arrives, creating `runDir` with `mkdir -p` semantics, and write no file without a `runDir`
    - Flush decoder and Held_Tail at end of stream and on `stop()` before closing the file; discard output after `stop()`; never write the capture to CE's stdout or stderr
    - Provide the `logTail` helper (last 4 KiB of the redacted capture)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 2.7_

  - [x] 2.2 Write property tests for the log capture
    - File: `packages/ce/src/runtime/target.log.property.test.ts`, with tag comments and at least 100 runs
    - [x] 2.2.1 **Property 12: Log_Capture never exceeds its byte bound and is always a suffix of the redacted stream**
      - Generate multi-byte text so that the character-boundary cut is exercised
      - **Validates: Requirements 5.3**
    - [x] 2.2.2 **Property 13: Secret redaction is invariant to how a stream is chunked, including across the end-of-stream flush**
      - Generate splits inside the secret, one character before the secret and anywhere else; compare with one-pass redaction of the unsplit stream
      - **Validates: Requirements 5.8, 5.11**

  - [x] 2.3 Write unit tests for the log capture
    - File: `packages/ce/src/runtime/target.log.test.ts`
    - Cover stream labels and arrival order, the 256 KiB bound dropping the oldest text first, the 4 KiB `logTail`, secret replacement, a secret split across two and three chunks, a secret starting one character before the cut point, redaction of the whole buffer before the Held_Tail is taken, the Held_Tail flush at end of stream, the file under `runDir`, creation of a missing `runDir`, no file without `runDir`, discard after `stop()`, and no write to CE's stdout or stderr
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 11.9_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Attach_Mode and the readiness loop
  - [x] 4.1 Implement `openTarget` validation, Attach_Mode and the readiness loop in `packages/ce/src/runtime/target.ts`
    - Validate before any probe or spawn and throw `TargetConfigError`: neither `url` nor `start` (names `target.url`), `start` without `url` (names `target.url`), `start` with a non-loopback host, and a `ready.timeout` that `parseDuration` rejects (names `target.ready.timeout`)
    - Implement the readiness loop as a pure transition over elapsed time and probe outcome (`ready`, `retry-after-250ms`, `timed-out`) driven by injected `now` and `sleep`; use `GET` only, `redirect: 'manual'`, a request timeout of `min(2000, remaining)`, and record `lastStatus`
    - On timeout throw `TargetUnreachableError` with the redacted `url`, `lastStatus` (`none` when no probe completed), `timeoutMs` and `mode`; its message contains the url, the last status and the timeout; redact userinfo in every thrown error
    - In Attach_Mode never call `spawn` or signal a process; resolve a handle with `mode: 'attached'`, `baseUrl` equal to `url`, and a `stop()` that does nothing
    - Support the `signal` option during the wait (throw `AbortError`)
    - Provide the idempotent `stop()` promise holder that Start_Mode reuses in task 5.1
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.10, 6.2, 7.1, 8.3, 8.4_

  - [x] 4.2 Write property tests for Attach_Mode and readiness
    - File: `packages/ce/src/runtime/target.readiness.property.test.ts`, with tag comments and at least 100 runs; build fake `fetch` sequences as scripted outcomes consumed call by call, with a fake clock and `sleep`
    - [x] 4.2.1 **Property 1: Attach_Mode never spawns or signals a process**
      - **Validates: Requirements 1.1, 1.4, 1.5**
    - [x] 4.2.2 **Property 2: Readiness resolution matches the first Ready_Status, in both modes**
      - Run the generator in Attach_Mode here; the Start_Mode half is added in task 5.2
      - **Validates: Requirements 1.2, 1.3, 2.2, 3.3, 3.4**
    - [x] 4.2.3 **Property 3: Exhausting the Ready_Timeout resolves to Target_Unreachable_Error with the exact last outcome**
      - Assert the table-derived `lastStatus`, `timeoutMs` and `mode`; the Start_Mode stop-before-throw half is added in task 5.2
      - **Validates: Requirements 3.4, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5**
    - [x] 4.2.4 **Property 11: Loopback classification decides the start-with-remote-url rejection**
      - **Validates: Requirements 8.4**
    - [x] 4.2.5 Extend Property 7 for errors: the `url` field and message of every error `openTarget` throws never contain the original userinfo
      - **Validates: Requirements 4.7, 8.7**

  - [x] 4.3 Write unit tests for readiness and configuration errors
    - File: `packages/ce/src/runtime/target.readiness.test.ts`
    - Cover `503, 503, 200` resolving, a `3xx` resolving without following the redirect, a sequence ending in `TargetUnreachableError` with the last status, a hanging probe ending with `lastStatus` `timeout`, a throwing probe ending with its failure kind, the default `ready.path` and `ready.timeout`, and `GET` as the only method recorded by the fake `fetch`
    - Cover the `TargetConfigError` cases: `start` without `url`, neither `url` nor `start`, `start` with a non-loopback `url`, and an invalid `ready.timeout`; each is thrown before any probe or spawn
    - Cover that no error message contains the log capture or userinfo, and that an `AbortSignal` abort during the wait throws `AbortError`
    - _Requirements: 1.2, 1.3, 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 5.7, 6.2, 7.1, 8.3, 8.4, 11.7, 11.10, 11.11_

- [x] 5. Implement Start_Mode and the stop state machine
  - [x] 5.1 Add Start_Mode to `packages/ce/src/runtime/target.ts`
    - Run one Pre_Start_Probe (`GET`, 2000 ms request timeout, no use of the Ready_Timeout, no change to `lastStatus`); on a Ready_Status throw `TargetConfigError` with `target.url is already served before start` and do not spawn; otherwise spawn exactly once
    - Spawn the command with a shell, `detached: true`, the caller's `cwd`, no added arguments, and `env` equal to the input `env` minus the effective secret names (`secrets` plus `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY`); start the Ready_Timeout after the spawn
    - Throw `TargetStartError` (with `command`, `logTail`) on a spawn failure without probing, and on a process exit before readiness with `exitCode` and `signal`, without waiting for the Ready_Timeout; stop the process before throwing `TargetUnreachableError`; attach the log capture of task 2.1 to stdout and stderr
    - Implement the stop state machine (`not-started`, `running`, `term-sent`, `kill-sent`, `exited`) behind one promise: `SIGTERM` to the group with `kill(-pid, signal)`, `SIGKILL` after a 5 second grace period, resolve at exit or 5 seconds after `SIGKILL`, and append a warning that names the command and the pid when the process never exits; a natural exit records `exited` with code and signal, and a later `stop()` resolves without a signal
    - Implement `stopOnSignals`: register `SIGINT` and `SIGTERM` listeners and an `exit` listener on the injected `process`; on a signal stop the process, remove every listener, then call `process.kill(process.pid, signal)` once and never `process.exit`; ignore a second signal while stopping; the `exit` listener sends `SIGTERM` synchronously; remove every registered listener when `stop()` completes
    - Honor the `signal` option by stopping the started process and throwing `AbortError`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 4.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4_

  - [x] 5.2 Write property tests for Start_Mode and stop
    - File: `packages/ce/src/runtime/target.start.property.test.ts`, with tag comments and at least 100 runs; use an `EventEmitter`-based fake `spawn` with `stdout`, `stderr`, `pid` and a controllable `exit`, and a fake clock
    - [x] 5.2.1 **Property 8: The Pre_Start_Probe decides spawn-or-reject from its outcome alone**
      - **Validates: Requirements 2.11**
    - [x] 5.2.2 **Property 9: Spawn happens before the first Readiness_Probe in Start_Mode**
      - **Validates: Requirements 2.2**
    - [x] 5.2.3 **Property 10: Only the configured secret names are removed from the started process's environment**
      - **Validates: Requirements 2.7**
    - [x] 5.2.4 **Property 14: `stop()` is idempotent under any sequence of calls, including a natural exit**
      - **Validates: Requirements 2.5, 2.6, 6.6, 6.7**
    - [x] 5.2.5 Extend Properties 2 and 3 in `packages/ce/src/runtime/target.readiness.property.test.ts` with the Start_Mode half
      - Property 2 in `mode: 'started'`; Property 3 asserts the started process is already stopped before the error is thrown
      - **Validates: Requirements 2.2, 4.5**

  - [x] 5.3 Write unit tests for Start_Mode
    - File: `packages/ce/src/runtime/target.start.test.ts`, with a fake `spawn`
    - Cover a spawn failure (`TargetStartError`, no probe), a process that exits before readiness (`exitCode`, no wait for the Ready_Timeout), `detached: true`, `SIGTERM` then `SIGKILL` after the grace period, a process that ignores `SIGKILL` so `stop()` resolves after the 5 second deadline with one warning, a second `stop()` that does nothing, a `stop()` after a natural exit that sends no signal, and `logTail` on both start errors
    - Cover the Pre_Start_Probe: `200` and `3xx` before spawn throw the "already served" error and never call `spawn`; `503` or a throw spawns; the probe uses a 2 second request timeout and does not consume the Ready_Timeout (a hanging pre-probe, then a full Ready_Timeout of probing, with a fake clock); the fake `fetch` records only `GET` including the pre-probe
    - Cover the environment: with `secrets` equal to `[]`, absent, and holding another name, the `env` passed to `spawn` lacks `OPENROUTER_API_KEY`, `TYPESAFE_API_KEY` and the extra names, other keys pass unchanged, and a fake process that prints both dummy keys leaves neither in the capture, the `target.log` file or `logTail`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.10, 2.11, 2.12, 3.7, 4.5, 5.6, 11.8, 11.11, 11.16, 11.17_

  - [x] 5.4 Write unit tests for signal handling and abort
    - File: `packages/ce/src/runtime/target.signals.test.ts`, with a fake `process` and a fake `spawn`
    - With `stopOnSignals: true`, a `SIGTERM` stops the started process, removes the listeners and calls `process.kill(process.pid, 'SIGTERM')` once after `stop()` completed; the same for `SIGINT`; the `exit` listener sends `SIGTERM` to the group synchronously; a second signal while stopping is ignored; with `stopOnSignals` absent no listener is registered; after `stop()` no listener remains; an `AbortSignal` abort during readiness stops the process and throws `AbortError`
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 11.8, 11.18_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Integration tests against `examples/demo-app`
  - [x] 7.1 Create the shared test support `packages/ce/src/runtime/demo-app.testsupport.ts`
    - Export helpers: pick a free port at run time, create a unique `mkdtemp` directory under the OS temporary directory, run `npx --no-install vite build --outDir <tmpdir>` with `examples/demo-app` as working directory, start `npx --no-install vite preview --outDir <tmpdir> --strictPort --port <port>` as a process owned by the test, and a cleanup that stops processes and removes the temporary directory
    - Write nothing under `examples/demo-app`, including `dist`
    - Keep the helpers free of any Jev call and any API key
    - _Requirements: 11.3, 11.4_

  - [x] 7.2 Write the integration tests for both modes
    - File: `packages/ce/src/runtime/target.integration.test.ts`; the file builds into its own unique temporary directory in an unconditional `beforeAll`, removes it in `afterAll`, and every test and the `beforeAll` set an explicit 90000 ms timeout; processes are cleaned up in `afterAll` or `finally` even when an assertion fails
    - Attached: the test serves the Demo_App itself, calls `openTarget` with that `url` and no `start`, asserts `mode: 'attached'`, a Ready_Status, no spawn by the Target_Manager, and that the server still answers after `stop()`
    - Started: `openTarget` with `start` `npx --no-install vite preview --outDir <tmpdir> --port <port> --strictPort`, the matching `url` and a `runDir`; assert `mode: 'started'`, a Ready_Status, a non-empty `logs`, a `target.log` file in `runDir`, and that the port is unreachable after `stop()`
    - Unreachable: a free port with nothing listening and `ready.timeout: '1s'`; assert `TargetUnreachableError` with the `url` and `lastStatus: 'connection-refused'`
    - Pre_Start_Probe refusal: a server started by the test already listens on the port; assert the "already served" `TargetConfigError` and that an injected `spawn` was never called
    - Environment: a start command that prints its environment keys, run with dummy `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` in `env`; assert neither key name nor value appears in the captured log
    - Assert that `env` carries no Jev key for the run itself and that the Target_Manager calls no gateway method
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3, 2.4, 2.7, 2.11, 4.1, 5.1, 5.4, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.14, 11.16, 11.17_

  - [x] 7.3 Write the non-modification integration test
    - File: `packages/ce/src/runtime/target.nonmod.integration.test.ts`, with its own unique temporary build directory, an unconditional `beforeAll` build and a 90000 ms timeout
    - Take a content hash of `examples/demo-app` (excluding only `node_modules` and Vite cache directories, so `dist` is included) before a started run and after `stop()`, and assert the hashes are equal
    - _Requirements: 7.2, 7.3, 7.5, 11.4, 11.11, 11.14_

- [x] 8. Add `RunCommandDeps.capabilities` and the pipeline-level error report
  - [x] 8.1 Update `packages/ce/src/run/command.ts`
    - Add the optional `capabilities` field to `RunCommandDeps` (the Capability_Registry content passed to `run()`), defaulting to the production registry when absent, and pass it through to `run()`
    - When the Resolved_Run carries a Stage_Error whose `cause` is a `TargetUnreachableError` (an `instanceof` check, importing from `runtime/target.ts`), print its `url` and `lastStatus` to stderr in addition to the Stage_Error message; the Stage_Error message itself keeps naming only the stage and the cause's constructor name
    - Do not change the signature of `run()`, `RuntimeHookInput` or `RuntimeResult`, do not add `signal` to `RunOptions`, and do not register the Target_Manager in the Capability_Registry
    - _Requirements: 4.8, 4.9, 9.3, 9.4, 9.5, 9.6_

  - [x] 8.2 Write the pipeline-level tests
    - File: `packages/ce/src/run/command.target.test.ts`
    - Register a fake `browser_ui` capability through the new `capabilities` field whose Runtime_Hook calls `openTarget` against an unreachable URL; drive it through `runRunCommand` with `FakeJevGateway`, fixed context providers, a dummy non-real `OPENROUTER_API_KEY` in `env`, and a unique `mkdtemp` `cwd` that is removed after the test
    - Assert `ERROR`, reason `stage-error`, `errorStage` `runtime`, that stderr carries the `url` and the `lastStatus`, that the Stage_Error message does not, and that nothing is written under the workspace `.ce/runs`
    - Assert with an empty registry, and with an Assessment whose `required` is `false`, that `openTarget` is never called
    - _Requirements: 4.8, 4.9, 9.5, 9.6, 11.12_

- [x] 9. Extend the architecture test
  - [x] 9.1 Update `packages/ce/src/outcome/architecture.test.ts`
    - Add a scoped check that `runtime/target.ts` imports none of `playwright`, `@typesafe-ai/sdk`, `jev/` or `outcome/`, and does not call `fetch` with a Jev-shaped request body, reusing the `FORBIDDEN_SPECIFIER` and `valueImportSpecifiers` pattern of the existing `run/` check
    - Assert that `runtime/target.ts` is part of the scanned set, so that the existing Outcome-literal rule (d) covers it, and add no duplicate of rule (d)
    - Check that `runtime/target.ts` contains no Jev question text
    - _Requirements: 4.10, 7.6, 8.8, 10.1, 10.2, 10.3_

- [x] 10. Verify the issue #9 checklist
  - [x] 10.1 Create `.ce/pr-checklist-issue-9.md`
    - Follow the format of `.ce/pr-checklist-issue-8.md`
    - Map each issue #9 checklist item and the "Done when" line to the requirement, the task and the test file that verifies it, as in Requirement 12: item 1 to Requirements 1 and 3 and `target.integration.test.ts` (attached); item 2 to Requirements 2, 3, 5 and 6 and the start, log, signal and integration tests; item 3 to Requirement 4 and the readiness, integration and `command.target.test.ts` tests; item 4 to Requirement 7 and Requirement 2.11 with `target.nonmod.integration.test.ts` and the Pre_Start_Probe tests; "Done when" to the two integration tests of task 7.2
    - Record the verification commands (`npm run typecheck`, `npm test`, `npm run build`, and the two integration tests by name) and a placeholder line for their results, to be copied into the pull request description (Requirement 11.15)
    - Record the out-of-scope items O1 to O4 (POSIX only, no pipeline-level abort, no remote start, second signal ignored) and the journal R6 criteria 1 to 4 and `SPEC.md` section 5.4 mapping
    - _Requirements: 11.15, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Run `npm run typecheck`, `npm test` and `npm run build` from the repository root, in the order of CI, and confirm the two integration tests of task 7.2 pass without an API key.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. This plan marks none, as in `run-vertical-slice`: the test sub-tasks are required by Requirement 11.
- Each task references specific requirements for traceability.
- Property tests use fast-check (already a devDependency) with at least 100 runs, and each carries a `// Feature: runtime-target, Property <n>: <title>` tag comment.
- Start_Mode is POSIX only in v0 (Requirement O1). The abort of a run at pipeline level is out of scope (O2); the `signal` option is covered at `openTarget` level only.
- Do not edit `.kiro/specs/runtime-target/.config.kiro`.
- Do not change `config/`, `run/pipeline.ts`, `run/types.ts`, `RuntimeHookInput` or `RuntimeResult`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2.1", "2.2.2", "2.3"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2.1", "4.2.2", "4.2.3", "4.2.4", "4.2.5", "4.3", "5.1"] },
    { "id": 6, "tasks": ["5.2.1", "5.2.2", "5.2.3", "5.2.4", "5.2.5", "5.3", "5.4"] },
    { "id": 7, "tasks": ["6"] },
    { "id": 8, "tasks": ["7.1", "8.1", "9.1"] },
    { "id": 9, "tasks": ["7.2", "7.3", "8.2"] },
    { "id": 10, "tasks": ["10.1"] },
    { "id": 11, "tasks": ["11"] }
  ]
}
```
