# Requirements Document

## Introduction

This feature builds the runtime target of Continuous Evidence (CE): GitHub issue #9 in rfxlamia/ce, "[M2] Runtime target: attach, start, readiness, logs" (label `runtime`, milestone M2). It implements `packages/ce/src/runtime/target.ts` (design section 2) and requirement R6 "Runtime access" of `docs/journal/v0.0/requirements.md`, which derives from `SPEC.md` section 5.4. `SPEC.md` is normative and wins on any conflict with this document or the journal.

`SPEC.md` section 5.4 says CE MUST be able to use a runtime that is already available, and that managing the runtime lifecycle (start and stop) is a SHOULD. The Target_Manager therefore has two modes: attach to a URL that is already running, and, WHERE `target.start` is configured, start the command, wait for readiness, capture its output and stop it. The Target_Manager returns a ready base URL and a handle. It does not drive a browser, observe pages or decide an Outcome. The browser loop (#10) consumes the handle. The outcome is decided only in `outcome/resolve.ts` (steering "Placement rules").

### Facts verified in the code and the issue

- F1. The issue checklist has four items and one "Done when" line: (1) attach to a running URL; (2) optional `target.start`: spawn, readiness (2xx/3xx on ready path), capture stdout/stderr, stop on exit; (3) unreachable after timeout resolves to `ERROR` with URL and last status; (4) never modify the target. Done when: it works against `examples/demo-app`, both attached and started.
- F2. The config schema (`config/schema.ts`) already defines `target.url` (an http or https URL), `target.start` (a string), `target.ready.path` (a string), `target.ready.timeout` (a duration string such as `30s`) and `target.routes`. `ConfigDefaults` has no value for any `target.*` key, so this feature defines the defaults for `target.ready.path` and `target.ready.timeout` itself. `parseDuration` in `config/duration.ts` converts a duration string to milliseconds.
- F3. `packages/ce/src/runtime/` does not exist. The capability runtime belongs to #9 (this feature) and #10 (browser loop).
- F4. `StageError` (`errors.ts`) has the stages `config`, `context`, `assessment`, `runtime` and `evidence`. Its message holds the stage and the cause's constructor name only, and the `run-vertical-slice` spec forbids copying a cause message into a Resolved_Run. The URL and the last status of an unreachable target are therefore carried as typed fields on the cause, not in the message of the Stage_Error.
- F5. `outcome/types.ts` defines `RuntimeResult`. `resolveOutcome` receives an `error` of type `StageError` and resolves it to `ERROR` with reason `stage-error` and the `errorStage`. The `run-vertical-slice` Runtime_Hook wraps a thrown non-Stage_Error as `StageError('runtime', cause)`.
- F6. `examples/demo-app` is a Vite application (`vite`, `vite build`, `vite preview` scripts in its `package.json`). It knows nothing about CE and has no `ce.yml`. The CI workflow (`.github/workflows/ci.yml`) runs `npm ci`, then `npm run typecheck`, then `npm test`, then `npm run build`, in that order. The `dist` directory of the Demo_App therefore does NOT exist when `npm test` runs on a clean CI runner, and a local `dist` is not a guarantee either. `node_modules` is present after `npm ci`. Because the build output of `examples/demo-app/dist` is shared and CI does not guarantee it, the integration tests build into a private temporary directory with `vite build --outDir <tmpdir>` and never write `examples/demo-app/dist` (Requirement 11 criterion 4).
- F7. The root `package.json` runs `npm test` across workspaces. CI tests use `FakeJevGateway` and need no API key (steering "Test policy"). The Target_Manager calls no Jev request.
- F8. Playwright is used only by the browser runtime (#10). The Target_Manager needs no browser.

### Design implications

- I1. The Target_Manager is a library module with injectable dependencies, in the manner of `runEvalCommand` and `run()`: `fetch`, `spawn`, the clock, a sleep function and the log sink are parameters with defaults, so the logic is unit-testable without a network or a process. The integration tests of Requirement 11 use the real defaults against `examples/demo-app`.
- I2. "Stop on exit" (checklist item 2) is read as: the started process is stopped when the run ends, whether the run succeeds, fails or is aborted. The Target_Manager exposes one idempotent `stop()` on the handle and the caller (the capability in #10, or a test) calls it in a `finally`. The Target_Manager also stops the process itself when readiness fails.
- I3. A started command is a shell command string (`target.start` is a string). It is spawned with a shell and as its own process group (`detached: true`), so that `stop()` ends the whole tree with `kill(-pid, signal)` (for example `npm run dev` spawns `vite` as a child). This is POSIX only in v0 (see "Out of scope for v0").
- I4. "Never modify the target" is enforced by what the Target_Manager does not do: it performs only `GET` and `HEAD` requests, writes no file under the target directory, and passes no flag or environment variable that changes the target's source, configuration or data. CE writes only its own output (steering "Product", non-goals).

### Out of scope for v0

- O1. Windows and any non-POSIX platform. Start_Mode relies on `detached` process groups and `kill(-pid, signal)`. CI runs on `ubuntu` only. Attach_Mode has no platform restriction.
- O2. Abort of a run through an `AbortSignal` at pipeline level. `pipeline.ts` does not pass a `signal` to `entry.run`, and `RunOptions` has no `signal` field. This feature does NOT add `signal` to `RunOptions` or to the pipeline. The `signal` option of `openTarget` (Requirement 6 criterion 2) is covered by unit tests of `openTarget` only.
- O3. Remote start. A `start` command with a non-loopback `target.url` is rejected (Requirement 8 criterion 4).
- O4. A second `SIGINT` or `SIGTERM` that arrives while `stop()` is already running (for example a second Ctrl-C). The Target_Manager ignores the second signal while `stop()` runs, and the stop completes through the grace period and the kill deadline of Requirement 2 criteria 4 and 12. A forced immediate exit would leave the started process group running, and v0 has no requirement for it.

## Glossary

- **Target_Manager**: The module `packages/ce/src/runtime/target.ts`. It exports `openTarget(options)` and the types and errors of this feature.
- **Target_Handle**: The value that `openTarget` resolves to. It holds `baseUrl`, `mode` (`attached` or `started`), `lastStatus`, `logs`, `warnings` (a list of warning strings, empty at first) and an idempotent `stop()` function.
- **Attach_Mode**: The mode in which the Target_Manager uses a runtime that is already running at `target.url` and starts no process.
- **Start_Mode**: The mode in which the Target_Manager spawns the command of `target.start`, waits for readiness and stops the process.
- **Ready_Path**: The URL path that the readiness probe requests. It comes from `target.ready.path` and defaults to `/`. It is appended to the path of the base URL (Requirement 3 criterion 2).
- **Loopback_Host**: A host that names the local machine: `localhost`, any IPv4 address in `127.0.0.0/8`, `::1` and `0.0.0.0`. The address `0.0.0.0` is included because it is a common value in local dev server URLs and connecting to it reaches the local machine on Linux and macOS. Every other host is a non-loopback host.
- **Ready_Timeout**: The maximum time to wait for readiness, in milliseconds. It comes from `target.ready.timeout` through `parseDuration` and defaults to 30 seconds (`30s`).
- **Readiness_Probe**: An HTTP `GET` request to the probe URL, which is the base URL with the Ready_Path appended.
- **Pre_Start_Probe**: One `GET` request that Start_Mode runs before the spawn, to the probe URL. It has its own request timeout of 2 seconds (2000 milliseconds), it does not consume or start the Ready_Timeout, and it does not change Last_Status. The Ready_Timeout starts after the spawn.
- **Ready_Status**: An HTTP status code from 200 to 399 inclusive.
- **Last_Status**: The HTTP status code of the most recent Readiness_Probe response, or the failure kind (`connection-refused`, `timeout`, `dns`, `network`) of the most recent Readiness_Probe that produced no response, or `none` WHEN no Readiness_Probe has completed. A failure without a response maps from the error of the HTTP client (undici, through `fetch`; the code is read from `error.cause.code` or `error.code`) as follows:

  | Error | Failure kind |
  | --- | --- |
  | `ECONNREFUSED` | `connection-refused` |
  | `ENOTFOUND`, `EAI_AGAIN` | `dns` |
  | abort of the probe request (request timeout of Requirement 3 criterion 6; `AbortError`, `TimeoutError`) | `timeout` |
  | any other error | `network` |
- **Target_Unreachable_Error**: The error that the Target_Manager throws when readiness is not reached. It carries `url` (the probed URL), `lastStatus` (the Last_Status), `timeoutMs` and `mode`.
- **Target_Start_Error**: The error that the Target_Manager throws when the start command cannot be spawned or exits before readiness. It carries `command`, `exitCode` and `signal`.
- **Target_Config_Error**: The error that the Target_Manager throws when the target options are unusable (for example neither `url` nor `start`, or a start command without a URL).
- **Log_Capture**: The capture of stdout and stderr of the started process, held by the Target_Handle as bounded in-memory text (the bound is 256 KiB, measured in UTF-8 bytes) and, WHERE a run directory is given, written to a file in it. The text is redacted before it is stored or written (Requirement 5 criterion 8).
- **Held_Tail**: For one stream, the last L-1 characters of the already redacted text of that stream (L is the length of the longest non-empty secret value), which the Target_Manager keeps back from the Log_Capture and the Target_Log_File until the next chunk or the end of the stream (Requirement 5 criterion 8).
- **Run_Dir**: The run directory that `run()` creates under `output.dir` (the `run-<iso>` directory of the `run-vertical-slice` spec). It is optional.
- **Target_Log_File**: The file `target.log` in the Run_Dir that holds the Log_Capture.
- **Demo_App**: The application in `examples/demo-app`.
- **Stage_Error**: A `StageError` instance (`errors.ts`).
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC section 7.1).
- **Fake_Gateway**: `FakeJevGateway`, the test implementation of the Jev gateway.

## Requirements

### Requirement 1: Attach to a running URL

**User Story:** As a CI author, I want CE to use the application that my workflow already started, so that CE stays non-invasive.

#### Acceptance Criteria

1. WHEN `openTarget` receives a `url` and no `start` command, THE Target_Manager SHALL use Attach_Mode and SHALL NOT spawn a process.
2. WHEN Attach_Mode is used, THE Target_Manager SHALL run the Readiness_Probe against the `url` and the Ready_Path, and SHALL resolve to a Target_Handle with `mode` `attached` and `baseUrl` equal to the `url` WHEN a Ready_Status is received.
3. WHEN Attach_Mode is used and the target is already running, THE Target_Manager SHALL resolve after the first Readiness_Probe that returns a Ready_Status, without waiting for the Ready_Timeout.
4. WHEN `stop()` is called on a Target_Handle with `mode` `attached`, THE Target_Handle SHALL do nothing to the running application and SHALL resolve.
5. THE Target_Manager SHALL NOT start, restart or terminate any process in Attach_Mode.
6. THE Target_Handle SHALL expose `baseUrl` as an absolute `http` or `https` URL that the browser runtime can open.

### Requirement 2: Start the target (optional)

**User Story:** As a developer, I want CE to start my application when I configure a start command, so that I can run CE without a separate workflow step.

#### Acceptance Criteria

1. WHERE `target.start` is configured together with `target.url`, THE Target_Manager SHALL use Start_Mode and SHALL spawn the command with the working directory given by the caller (the `cwd` of the run).
2. WHEN Start_Mode is used, THE Target_Manager SHALL spawn the command before the first Readiness_Probe, and SHALL resolve to a Target_Handle with `mode` `started` and `baseUrl` equal to `target.url` WHEN a Ready_Status is received.
3. WHEN Start_Mode is used, THE Target_Manager SHALL spawn the command with `detached: true`, so that the command is the leader of its own process group, and `stop()` can end the command and the processes that it spawned with `kill(-pid, signal)`. Start_Mode is POSIX only in v0 (O1).
4. WHEN `stop()` is called on a Target_Handle with `mode` `started`, THE Target_Handle SHALL send `SIGTERM` to the process group, WHEN the group is still alive after a grace period of 5 seconds, send `SIGKILL` to the process group, and resolve after the process has exited or after the kill deadline of criterion 12, whichever comes first.
5. WHEN `stop()` is called more than once, THE Target_Handle SHALL perform the stop once and resolve every call.
6. WHEN the started process has already exited at the time of `stop()`, THE Target_Handle SHALL resolve without sending a signal.
7. THE Target_Manager SHALL pass to the started process the environment of the caller (the `env` option) with the CE-owned secret variables removed, and SHALL NOT add or change any other variable. The CE-owned secret variables are the variables named in the `secrets` option. `openTarget` itself SHALL form the effective list of secret names as the union of the `secrets` option given by the caller and the two names `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY`, so that a call with `secrets` absent or equal to `[]` still removes both keys from the environment of the started process and still redacts their values in the Log_Capture (Requirement 5 criterion 8). This removal is always applied and has no option to disable it. Per decision of the user, the removal is the default and the only behavior. `targetOptionsFromConfig` MAY also pass the two names, which the union makes harmless; the `config/` module does not change (Requirement 8 criterion 9).
8. IF `target.start` is configured and `target.url` is absent, THEN THE Target_Manager SHALL throw a Target_Config_Error that names `target.url`, and SHALL NOT spawn a process.
9. IF the start command cannot be spawned, THEN THE Target_Manager SHALL throw a Target_Start_Error with the `command`, and SHALL NOT run a Readiness_Probe.
10. IF the started process exits before a Ready_Status is received, THEN THE Target_Manager SHALL stop probing at once, and SHALL throw a Target_Start_Error with the `command`, the `exitCode` and the `signal`, without waiting for the Ready_Timeout.
11. WHEN Start_Mode is used, THE Target_Manager SHALL run one Pre_Start_Probe before the spawn, with its own request timeout of 2 seconds, and THE Target_Manager SHALL NOT start or consume the Ready_Timeout during the Pre_Start_Probe, so that the Ready_Timeout is measured from the spawn. IF the Pre_Start_Probe receives a Ready_Status, THEN THE Target_Manager SHALL throw a Target_Config_Error with the message `target.url is already served before start` (the message may also name the redacted `url`) and SHALL NOT spawn a process, because a Ready_Status from another process would be mistaken for readiness of the started process. IF the Pre_Start_Probe receives another status or no response, THEN THE Target_Manager SHALL spawn the command.
12. WHEN `stop()` has sent `SIGKILL` and the process has not exited within 5 seconds after the signal, THE Target_Handle SHALL resolve anyway and SHALL append a warning to `warnings` that names the command and the pid, so that `stop()` never waits without bound.

### Requirement 3: Readiness

**User Story:** As a developer, I want CE to wait until the target answers, so that CE does not observe an application that is still booting.

#### Acceptance Criteria

1. THE Target_Manager SHALL read the Ready_Path from `target.ready.path` and use `/` WHERE the key is absent, and SHALL read the Ready_Timeout from `target.ready.timeout` through `parseDuration` and use 30 seconds WHERE the key is absent.
2. THE Target_Manager SHALL append the Ready_Path to the path of the base URL, so that the path of the base URL is kept, and a Ready_Path with or without a leading `/` and a base URL with or without a trailing `/` produce the same probe URL. THE Target_Manager SHALL NOT resolve the Ready_Path with `new URL(path, base)`, because that call discards the path of the base URL when the Ready_Path starts with `/`. Examples: base `http://h/app` and Ready_Path `/health` give `http://h/app/health`; base `http://h/app/` and Ready_Path `health` give `http://h/app/health`; base `http://h` and Ready_Path `/` give `http://h/`. The query and fragment of the base URL are dropped.
3. WHEN a Readiness_Probe receives a response with a status from 200 to 399, THE Target_Manager SHALL treat the target as ready.
4. WHEN a Readiness_Probe receives a response with any other status, or no response, THE Target_Manager SHALL record the Last_Status and run the next Readiness_Probe after a retry interval of 250 milliseconds, until the Ready_Timeout is spent.
5. THE Target_Manager SHALL NOT follow redirects in the Readiness_Probe, so that a `3xx` status is evaluated as received.
6. THE Target_Manager SHALL limit each Readiness_Probe to a request timeout of 2 seconds or the remaining Ready_Timeout, whichever is shorter, so that a hanging connection does not outlast the Ready_Timeout.
7. THE Target_Manager SHALL use only the HTTP method `GET` for the Readiness_Probe and the Pre_Start_Probe.
8. WHEN the Ready_Timeout is spent, THE Target_Manager SHALL stop probing and report the failure of Requirement 4.
9. THE Target_Manager SHALL measure the Ready_Timeout with an injectable clock, so that a test can run the timeout without waiting in real time.
10. WHERE `target.ready.timeout` holds a value that `parseDuration` rejects, THE Target_Manager SHALL throw a Target_Config_Error that names `target.ready.timeout`. The config schema already rejects such values, so this criterion guards direct calls of `openTarget`.

### Requirement 4: Unreachable target resolves to ERROR

**User Story:** As a developer, I want a clear error with the URL and the last status when the target never becomes ready, so that I can fix the setup quickly.

#### Acceptance Criteria

1. IF no Ready_Status is received within the Ready_Timeout, THEN THE Target_Manager SHALL throw a Target_Unreachable_Error with `url` (the probed URL), `lastStatus`, `timeoutMs` and `mode`.
2. WHEN the last Readiness_Probe received an HTTP response, THE Target_Unreachable_Error SHALL carry its status code in `lastStatus`.
3. WHEN the last Readiness_Probe received no response, THE Target_Unreachable_Error SHALL carry the failure kind (`connection-refused`, `timeout`, `dns` or `network`) in `lastStatus`, mapped from the error of the HTTP client by the table in the Glossary entry "Last_Status".
4. WHEN no Readiness_Probe completed, THE Target_Unreachable_Error SHALL carry `none` in `lastStatus`.
5. WHEN the Target_Unreachable_Error is thrown in Start_Mode, THE Target_Manager SHALL stop the started process before it throws.
6. THE message of the Target_Unreachable_Error SHALL contain the `url`, the `lastStatus` and the `timeoutMs`.
7. WHEN the `url` contains credentials (userinfo), THE Target_Manager SHALL replace the userinfo with `***` in the `url` field and in the message of every error it throws.
8. WHEN a Target_Unreachable_Error, a Target_Start_Error or a Target_Config_Error reaches the Run_Pipeline through the Runtime_Hook, THE Run_Pipeline SHALL resolve the run through `resolveOutcome` with `StageError('runtime', cause)`, so that the Outcome is `ERROR`, the reason is `stage-error` and the `errorStage` is `runtime`.
9. WHEN the Resolved_Run carries a Stage_Error whose cause is a Target_Unreachable_Error, THE Run_Command SHALL print the `url` and the `lastStatus` of the cause to stderr, in addition to the Stage_Error message. The Stage_Error message itself SHALL keep naming only the stage and the cause's constructor name. To make the Run_Command testable with a fake capability, `RunCommandDeps` (`run/command.ts`) SHALL gain a field `capabilities` (the Capability_Registry content passed to `run()`), which defaults to the production registry WHEN absent. `run/command.ts` MAY import `TargetUnreachableError` from `runtime/target.ts` for the `instanceof` check.
10. THE Target_Manager SHALL NOT decide an Outcome and SHALL NOT import from `outcome/`.

### Requirement 5: Log capture

**User Story:** As a developer, I want the stdout and stderr of the started application kept, so that I can see why a target failed to start or misbehaved.

#### Acceptance Criteria

1. WHILE a started process runs, THE Target_Manager SHALL capture its stdout and stderr, each chunk labeled with its stream (`stdout` or `stderr`).
2. THE Target_Handle SHALL expose the Log_Capture through `logs`, in the order of arrival.
3. THE Target_Manager SHALL bound the in-memory Log_Capture to the last 262144 bytes (256 KiB), measured as UTF-8 bytes of the redacted text that criterion 8 releases (the Held_Tail is not part of the Log_Capture until it is released), and SHALL discard the oldest text first WHEN the bound is exceeded. THE Target_Manager SHALL cut at a character boundary, so that the retained text holds no partial UTF-8 sequence.
4. WHERE a Run_Dir is given, THE Target_Manager SHALL create the Run_Dir WHEN it does not exist (`mkdir -p` semantics), and SHALL write the Log_Capture to the Target_Log_File as it arrives, so that the log survives a crash of CE.
5. WHERE no Run_Dir is given, THE Target_Manager SHALL write no file.
6. WHEN the Target_Manager throws a Target_Unreachable_Error or a Target_Start_Error in Start_Mode, THE error SHALL carry the last 4 KiB of the Log_Capture in a `logTail` field.
7. THE message of every error that the Target_Manager throws SHALL NOT contain the Log_Capture, so that the Stage_Error and the stderr summary stay short. The `logTail` field is the only carrier.
8. THE Target_Manager SHALL replace every non-empty value of the secret environment variables (the effective list of Requirement 2 criterion 7, read from the `env` option) with `***` in the Log_Capture, in the Target_Log_File and in `logTail`, before the text is stored or written. For each stream (`stdout` and `stderr`, separately), THE Target_Manager SHALL process each chunk in this order: (a) decode the chunk with a UTF-8 decoder that keeps partial sequences; (b) join the Held_Tail of that stream with the decoded text to form the buffer; (c) redact the ENTIRE buffer, replacing longer secret values before shorter ones; (d) take the last L-1 characters of the redacted buffer as the new Held_Tail, where L is the length in characters of the longest non-empty secret value (no Held_Tail WHEN L is 1 or no secret exists); (e) store and write only the redacted text before the new Held_Tail. THE Target_Manager SHALL NOT cut the text before it is redacted. This order guarantees that a secret that starts 1 character before the cut point, or anywhere in the last L-1 characters of the buffer, is held back whole and is redacted once the rest of it arrives.
9. THE Target_Manager SHALL NOT write the Log_Capture to the stdout or stderr of CE.
10. WHEN the started process produces output after `stop()` was called, THE Target_Manager SHALL discard it and SHALL close the Target_Log_File.
11. WHEN a stream of the started process ends, or WHEN `stop()` completes, THE Target_Manager SHALL flush the decoder of that stream, redact the entire remaining buffer (the Held_Tail joined with the flushed text) and release all of it to the Log_Capture and to the Target_Log_File before the Target_Log_File is closed.

### Requirement 6: Stop on exit and cleanup

**User Story:** As a CI author, I want CE never to leave the started application running, so that the runner stays clean.

#### Acceptance Criteria

1. THE Target_Manager SHALL return a Target_Handle whose `stop()` the caller can call in a `finally` block, so that the process is stopped WHEN the run succeeds, fails or is aborted.
2. WHEN the `signal` option (an `AbortSignal`) aborts during the wait for readiness, THE Target_Manager SHALL stop the started process, stop probing and throw an `AbortError`.
3. WHERE the caller passed `stopOnSignals` equal to `true`, WHEN the Node.js process of CE receives `SIGINT` or `SIGTERM` while a started process runs, THE Target_Manager SHALL stop the started process, and WHEN `stop()` has completed, SHALL remove its `SIGINT` and `SIGTERM` listeners and SHALL re-send the same signal to the Node.js process with `process.kill(process.pid, signal)`, so that the default behavior of the signal ends CE and Node.js does not hang. The Target_Manager SHALL NOT call `process.exit` for this purpose.
4. WHERE the caller passed `stopOnSignals` equal to `true`, WHEN the Node.js process of CE exits normally while a started process still runs, THE Target_Manager SHALL send `SIGTERM` to the process group in an `exit` listener, synchronously.
5. WHEN `stop()` completes, THE Target_Manager SHALL remove every listener that it registered on the Node.js process, so that criterion 3 re-sends the signal without a handler of the Target_Manager.
6. WHEN a started process exits on its own after readiness, THE Target_Handle SHALL record `exited` with the exit code and the signal, and `stop()` SHALL still resolve.
7. FOR ALL sequences of `stop()` calls on a Target_Handle, THE started process SHALL be stopped at most once and no call SHALL reject (idempotence property).

### Requirement 7: The Target_Manager does not modify the target

**User Story:** As a reviewer, I want proof that CE only reads the target, so that CE stays non-invasive.

#### Acceptance Criteria

1. THE Target_Manager SHALL send only `GET` requests to the target.
2. THE Target_Manager SHALL NOT write, rename, delete or change the permissions of any file under the working directory of the target, other than the Target_Log_File in the Run_Dir that the caller supplied.
3. THE Target_Manager SHALL NOT append arguments to the start command and SHALL NOT alter its environment, except for the removal of the CE-owned secret variables, which always include `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` through the union performed by `openTarget` itself (Requirement 2 criterion 7).
4. THE Target_Manager SHALL NOT read `.env` files, SHALL NOT read `process.env` and SHALL NOT read the clock, except in the defaults of the injectable options.
5. WHEN a test starts the Demo_App through the Target_Manager, THE test SHALL assert that the file tree of `examples/demo-app` (excluding `node_modules`, `dist` and Vite cache directories) is unchanged after the Target_Handle was stopped, by comparing a content hash taken before and after. Because the integration tests build into a temporary directory outside the Demo_App (Requirement 11 criterion 4), the hash covers the whole tree of `examples/demo-app` excluding only `node_modules` and Vite cache directories; `dist` is therefore not excluded and must stay unchanged too.
6. THE Target_Manager SHALL NOT import `playwright`, the Jev SDK or `jev/`.

### Requirement 8: Options and configuration mapping

**User Story:** As a developer, I want the `target.*` configuration keys to drive the Target_Manager directly, so that the same `ce.yml` works for attach and start.

#### Acceptance Criteria

1. THE Target_Manager SHALL accept a single options object with the fields `url`, `start`, `ready` (`path`, `timeout`), `cwd`, `env`, `secrets`, `runDir`, `signal`, `stopOnSignals`, and the injectable `fetch`, `spawn`, `now`, `sleep` and `process` (the object on which listeners are registered and `kill` is called, defaulting to the global `process`).
2. WHEN the options object is built from the `EffectiveConfig`, THE caller SHALL map `target.url` to `url`, `target.start` to `start`, `target.ready.path` to `ready.path` and `target.ready.timeout` to `ready.timeout`.
3. IF neither `url` nor `start` is given, THEN THE Target_Manager SHALL throw a Target_Config_Error that names `target.url`, before any probe or spawn.
4. WHERE `target.url` names a non-loopback host (anything outside the Loopback_Host list of the Glossary), THE Target_Manager SHALL treat it as Attach_Mode only, and IF a `start` command is also given, THEN THE Target_Manager SHALL throw a Target_Config_Error, because a started process cannot be expected to serve a remote host. This rule also rejects a setup such as `docker compose up` with `target.url` `http://app:3000`, because `app` is a non-loopback host; such a setup uses Attach_Mode, with the compose stack started by the workflow.
5. THE Target_Manager SHALL export a pure function `buildProbeUrl(baseUrl, readyPath)` that returns the probe URL, so that Requirement 3 criterion 2 is testable without a network.
6. THE Target_Manager SHALL export a pure function `classifyStatus(status)` that returns `ready` for a status from 200 to 399 and `not-ready` for every other integer, so that Requirement 3 criterion 3 is testable without a network.
7. THE Target_Manager SHALL export a pure function `redactUrl(url)` that replaces userinfo with `***`, so that Requirement 4 criterion 7 is testable without a network.
8. THE Target_Manager SHALL NOT contain Jev question text and SHALL NOT call a Jev request.
9. THE `config/` module SHALL NOT change in this feature, because the `target.*` keys already exist (F2). The defaults of Requirement 3 criterion 1 live in `runtime/target.ts`.

### Requirement 9: Integration with the Runtime_Hook

**User Story:** As the developer of #10, I want a small, stable entry point that returns a ready target, so that the browser loop starts from a known state.

#### Acceptance Criteria

1. THE Target_Manager SHALL export `openTarget(options): Promise<Target_Handle>` and the error classes `TargetUnreachableError`, `TargetStartError` and `TargetConfigError` from `packages/ce/src/runtime/target.ts`.
2. THE Target_Manager SHALL export a helper `targetOptionsFromConfig(config, extras)` that builds the options object of Requirement 8 criterion 1 from an `EffectiveConfig` and the caller's `cwd`, `env`, `runDir` and `signal`, and SHALL add no other behavior.
3. THE Target_Manager SHALL NOT register itself in the Capability_Registry. The capability of #10 calls `openTarget`, uses the handle and calls `stop()` in a `finally` block.
4. THE Target_Manager SHALL NOT change the signature of `run()`, `RuntimeHookInput` or `RuntimeResult`. This lock covers `run()` and the two hook types only. The new `capabilities` field of `RunCommandDeps` (Requirement 4 criterion 9) is outside this lock.
5. WHILE the Capability_Registry is empty, THE Run_Pipeline SHALL NOT call `openTarget`. This preserves the `run-vertical-slice` rule that an empty registry starts no process and opens no network connection.
6. WHEN the Assessment has `required` equal to `false`, THE Run_Pipeline SHALL NOT call `openTarget`, so that a `SKIPPED` run neither starts nor contacts the target (journal R5 criterion 3).

### Requirement 10: Architecture rules

**User Story:** As a maintainer, I want the placement rules checked by a test, so that the design rule and the Jev rules hold over time.

#### Acceptance Criteria

1. THE test suite SHALL extend the existing `outcome/architecture.test.ts` with an import rule for `runtime/target.ts`: it does not import `playwright`, `@typesafe-ai/sdk`, `jev/` or `outcome/`, and does not call `fetch` for Jev.
2. THE existing rule (d) of `outcome/architecture.test.ts` SHALL continue to pass, which means that `runtime/target.ts` assigns, returns and casts no Outcome literal.
3. THE Target_Manager SHALL NOT import `@typesafe-ai/sdk` and SHALL NOT contain Jev question text.

### Requirement 11: Tests and verification

**User Story:** As a maintainer, I want the "Done when" line of issue #9 verified by tests against the Demo_App, in both modes, with no API key, so that the pull request can close the issue with proof.

#### Acceptance Criteria

1. THE test suite SHALL include an integration test that serves the Demo_App from a process that the test starts itself (outside the Target_Manager), calls `openTarget` with that `url` and no `start`, and asserts `mode` `attached`, a `baseUrl` that answers a Ready_Status, that no process was spawned by the Target_Manager, and that the application is still running after `stop()`. This test verifies the "attached" half of "Done when".
2. THE test suite SHALL include an integration test that calls `openTarget` with a `start` command that serves the Demo_App from `examples/demo-app` (for example `npx --no-install vite preview --outDir <tmpdir> --port <free port> --strictPort`, with the temporary build directory of criterion 4; the command MUST contain `--outDir <tmpdir>` and `--strictPort` and MUST use `npx --no-install`, so that `npx` never downloads a package from the network and Vite fails instead of moving to another port), the matching `url`, and a Run_Dir, and asserts `mode` `started`, a Ready_Status at the `baseUrl`, a non-empty Log_Capture, a Target_Log_File in the Run_Dir that holds the captured output, and that the port no longer answers after `stop()`. This test verifies the "started" half of "Done when".
3. THE integration tests of criteria 1 and 2 SHALL use a free port that the test picks at run time, SHALL NOT depend on a fixed port, and SHALL clean up the processes they start in an `afterAll` or `finally`, including WHEN an assertion fails.
4. THE integration tests SHALL run as part of `npm test` on the CI runner without an API key (`OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` absent), without a Jev request, without a browser and without any network access beyond loopback. CI runs `npm ci`, `npm run typecheck`, `npm test`, `npm run build` in that order (F6), so `dist` of the Demo_App does not exist when the tests run. THE integration tests that serve the Demo_App SHALL NOT write to `examples/demo-app/dist` or to any other path under `examples/demo-app`. Each test file that serves the Demo_App SHALL create its own unique temporary directory (for example with `mkdtemp` under the OS temporary directory, unique per file and per process), SHALL run `npx --no-install vite build --outDir <tmpdir>` in the `beforeAll` with `examples/demo-app` as working directory, SHALL serve the build with `npx --no-install vite preview --outDir <tmpdir> --strictPort --port <free port>`, and SHALL remove the temporary directory in the `afterAll`, including WHEN an assertion fails. The build in the `beforeAll` is unconditional, so the test never skips silently, never depends on the build step of CI, and never collides with another test file that vitest runs in parallel. THE `beforeAll` SHALL NOT be conditional.
5. THE test suite SHALL include a test that the `env` of the test carries no Jev API key and that the Target_Manager calls no Fake_Gateway method. THE Fake_Gateway MAY be passed to a pipeline-level test, and no test SHALL need a real key.
6. THE test suite SHALL include an integration test for the unreachable case, through the Demo_App flow: `openTarget` with a `url` on a free port where nothing listens and a short `ready.timeout` (for example `1s`), asserting a Target_Unreachable_Error with the `url` and `lastStatus` `connection-refused`.
7. THE test suite SHALL include unit tests with a fake `fetch`, a fake clock and a fake `sleep` for: a status sequence `503, 503, 200` that resolves; a `3xx` status that resolves without following the redirect; a sequence that never reaches a Ready_Status and ends with the Target_Unreachable_Error carrying the last status; a probe that hangs and ends with `lastStatus` `timeout`; and a probe that throws and ends with the failure kind.
8. THE test suite SHALL include unit tests with a fake `spawn` for: a spawn failure (Target_Start_Error); a process that exits before readiness (Target_Start_Error with `exitCode`, no wait for the Ready_Timeout); a stop that sends `SIGTERM`, then `SIGKILL` after the grace period; a process that ignores `SIGKILL` (the fake never emits exit), where `stop()` resolves after the 5 second kill deadline and `warnings` holds one entry; a second `stop()` call that does nothing; and an abort through the `signal`.
9. THE test suite SHALL include unit tests for Log_Capture: stream labels, arrival order, the 256 KiB bound that drops the oldest text first, the `logTail` of 4 KiB on errors, the secret replacement, a secret split across two chunks (and across three), a secret whose first character is the last character before the cut point of a chunk, the order of criterion 8 of Requirement 5 (redaction of the entire buffer before the Held_Tail is taken), the flush of the Held_Tail when the stream ends, the file written under the Run_Dir, the creation of a Run_Dir that does not exist, and no file written without a Run_Dir.
10. THE test suite SHALL include unit tests for the Target_Config_Error cases: `start` without `url`, neither `url` nor `start`, `start` with a non-loopback `url`, and an invalid `ready.timeout`.
11. THE test suite SHALL include a test of the non-modification rule of Requirement 7 criterion 5 (content hash of `examples/demo-app` before and after the started run) and a test that a fake `fetch` records only the `GET` method for every probe, including the Pre_Start_Probe.
12. THE test suite SHALL include a test of Requirement 4 criteria 8 and 9 at pipeline level: a fake capability registered for `browser_ui` whose Runtime_Hook calls `openTarget` against an unreachable URL, driven through `runRunCommand` with the fake capability passed in the new `capabilities` field of `RunCommandDeps`, `FakeJevGateway` and fixed context providers. Because `run()` calls `requireJevCredentials`, and a missing key yields a config failure instead of a Stage_Error of the stage `runtime`, THE test SHALL set `OPENROUTER_API_KEY` in the `env` of `RunCommandDeps` to an explicit dummy value that is not a real key (the pattern of `command.test.ts`, which passes a constant `KEY`), and a real key SHALL NOT be used. Because `run()` writes under `.ce/runs`, THE test SHALL set `cwd` to a unique temporary directory (`mkdtemp`), and SHALL remove it after the test. THE test SHALL assert asserting `ERROR`, reason `stage-error`, `errorStage` `runtime`, and that the Run_Command prints the `url` and the `lastStatus` on stderr, and that no file is written under the workspace `.ce/runs`.
13. THE test suite SHALL include property-based tests with fast-check for: `classifyStatus` (ready exactly for 200 to 399, over all integers from 100 to 599); `buildProbeUrl` (the same result for every combination of leading and trailing slashes, and the path of the base URL is always a prefix of the probe URL path, for example `http://h/app` with `/health` gives `http://h/app/health`); `redactUrl` (the result never contains the original password, and a URL without userinfo is unchanged); the Log_Capture bound (the UTF-8 byte length never exceeds 262144 and the retained text is a suffix of the redacted input); the secret redaction across chunk boundaries (for every secret and every way of splitting a stream that contains the secret into chunks, including splits inside the secret and a secret that starts 1 character before a cut point, the stored text never contains the secret and equals the text produced by redacting the unsplit stream, after the end-of-stream flush of Requirement 5 criterion 11); and the stop idempotence of Requirement 6 criterion 7.
14. THE test suite SHALL NOT depend on the Demo_App port, on real time (apart from the integration tests, which use real processes with a limit of at most 60 seconds each), or on the order of tests. EVERY integration test and the `beforeAll` that runs `vite build` SHALL set an explicit vitest timeout of 90000 milliseconds, so that the default timeout of vitest does not end a test that the 60 second limit allows.
15. THE pull request description SHALL record the commands that verify "Done when" (the two integration tests of criteria 1 and 2) and their result.
16. THE test suite SHALL include unit tests of the Pre_Start_Probe (Requirement 2 criterion 11): a fake `fetch` that answers `200` before the spawn leads to a Target_Config_Error with the message `target.url is already served before start` and the fake `spawn` is never called; a fake `fetch` that answers `503` or throws before the spawn leads to a spawn; and a `3xx` answer before the spawn also leads to the error. THE suite SHALL include a unit test that the Pre_Start_Probe uses a request timeout of 2 seconds and does not consume the Ready_Timeout (with a fake clock, a Pre_Start_Probe that hangs until its 2 second timeout and then a spawn followed by a full Ready_Timeout of probing). THE suite SHALL include an integration test in which a server started by the test listens on the free port and `openTarget` with a `start` command is called, asserting the same error and that no process was spawned.
17. THE test suite SHALL include a test that the environment of the started process lacks the variables named in `secrets`, including `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` (a fake `spawn` that records the `env` option, and an integration test whose start command prints its environment keys and asserts that neither key appears in the captured log), and that other variables of the `env` option pass unchanged. THE suite SHALL include a unit test of `openTarget({ secrets: [] })` (and one with `secrets` absent, and one with a caller list that holds another name) with `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` set to dummy values in `env`, asserting that neither key is in the `env` passed to the fake `spawn`, that the other names of the caller list are also absent, and that a fake process that prints both dummy values leaves neither value in the Log_Capture, in the Target_Log_File or in `logTail`.
18. THE test suite SHALL include unit tests of the signal handling (Requirement 6 criteria 3 to 5) with a fake `process` and a fake `spawn`: with `stopOnSignals` `true`, a `SIGTERM` stops the started process, removes the listeners and calls `process.kill(process.pid, 'SIGTERM')` once, after `stop()` has completed; the same for `SIGINT`; with `stopOnSignals` absent no listener is registered; and after `stop()` no listener remains.

### Requirement 12: Issue checklist traceability

**User Story:** As a maintainer, I want every item of issue #9 mapped to requirements and to tests, so that one pull request can close the issue.

#### Acceptance Criteria

1. THE Target_Manager SHALL satisfy checklist item 1, "Attach to a running URL", through Requirement 1 and Requirement 3, and Requirement 11 criterion 1 verifies it.
2. THE Target_Manager SHALL satisfy checklist item 2, "Optional `target.start`: spawn, readiness (2xx/3xx on ready path), capture stdout/stderr, stop on exit", through Requirement 2 (spawn), Requirement 3 (readiness on the ready path, 2xx/3xx), Requirement 5 (capture of stdout and stderr) and Requirement 6 (stop on exit), and Requirement 11 criteria 2, 7, 8, 9, 16, 17 and 18 verify it. The scope of this item is POSIX (O1), and the abort of a run at pipeline level is out of scope (O2).
3. THE Target_Manager and the Run_Pipeline SHALL satisfy checklist item 3, "Unreachable after timeout resolves to `ERROR` with URL and last status", through Requirement 4, and Requirement 11 criteria 6, 7 and 12 verify it. The `capabilities` field of `RunCommandDeps` (Requirement 4 criterion 9) is the seam that criterion 12 uses.
4. THE Target_Manager SHALL satisfy checklist item 4, "Never modify the target", through Requirement 7 and through the pre-start refusal of Requirement 2 criterion 11, and Requirement 11 criteria 11 and 16 verify it.
5. THE test suite SHALL satisfy the "Done when" line, "works against `examples/demo-app` both attached and started", through Requirement 11 criteria 1, 2, 3, 4 and 14 (integration tests in both modes, in CI, without an API key, with `vite build` in `beforeAll`, `--strictPort`, `npx --no-install` and a 90 second vitest timeout).
6. THE Target_Manager SHALL satisfy journal requirement R6 criteria 1 to 4 through Requirements 1 to 7 of this document, WHERE R6 criterion 1 maps to Requirement 1, R6 criterion 2 maps to Requirements 2, 3, 5 and 6, R6 criterion 3 maps to Requirement 4, and R6 criterion 4 maps to Requirement 7.
7. THE Target_Manager SHALL satisfy `SPEC.md` section 5.4: Requirement 1 covers "MUST be able to use a runtime that is already available", and Requirements 2, 5 and 6 cover the lifecycle "SHOULD".
8. THE Target_Manager SHALL cover the `signal` option at the level of `openTarget` only (Requirement 6 criterion 2, Requirement 11 criterion 8), and the abort of a run through `run()` is out of scope for v0 (O2).