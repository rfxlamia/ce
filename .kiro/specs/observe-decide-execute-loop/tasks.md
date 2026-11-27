# Implementation Plan: Observe → Decide → Execute loop

## Overview

Implementation language: TypeScript (Node.js ≥ 22.12, npm workspaces, vitest, fast-check), as in the design. Each task builds on the previous ones and ends wired into `run()` through the default capability registry. The order is: foundation and test support, demo-app scenario, Observer, Decider, Executor, Capture, Runtime_Loop, Browser_Capability and pipeline wiring, end-to-end scenarios, architecture tests, and the PR checklist for issue #10.

All Jev calls in tests use `jev/fake.ts` or a question-id test double and need no API key. Property tests use fast-check with at least 100 iterations and carry the tag `// Feature: observe-decide-execute-loop, Property N: <text>`.

New files live under `packages/ce/src/runtime/` unless stated otherwise: `observe.ts`, `decide.ts`, `execute.ts`, `capture.ts`, `loop.ts`, `capability.ts`, `constants.ts`, and their tests.

## Tasks

- [x] 1. Foundation and test support
  - [x] 1.1 Add Playwright and runtime constants
    - Add `playwright` as a dependency of `packages/ce/package.json` and update the lockfile. Do not import it statically anywhere reachable from `index.ts`.
    - Create `runtime/constants.ts` with `REACHED_THRESHOLD` (0.7), `SETTLE_TIMEOUT_MS` (3000), `CHANGE_STOPWORDS` (the exact set from the design), `finalReserveMs(timeBudgetMs)` (`min(10000, 0.2 * budget)`) and `loopDeadlineMs(timeBudgetMs)`.
    - Re-export `MAX_NEXT_ACTION_OPTIONS` from `jev/catalog.ts` rather than redefining it.
    - Define a minimal structural `PlaywrightPage` / `PlaywrightLocator` type surface in `runtime/playwright-types.ts` so modules and fakes do not need a runtime import of `playwright`.
    - _Requirements: 2.5, 8.9, 9.2, 9.12, 12.11, 13.16_

  - [x] 1.2 Update the CI workflow and add the missing-Chromium helper
    - In `.github/workflows/ci.yml`, run `npx playwright install --with-deps chromium` after `npm ci` and before `npm test`.
    - Create `runtime/chromium.testsupport.ts` that launches Chromium for tests and, when the browser is missing, throws an error whose message names `npx playwright install chromium`.
    - _Requirements: 12.13_

  - [x] 1.3 Create the test-support gateway wrapper
    - Create `runtime/gateway.testsupport.ts`: a wrapper around `FakeJevGateway` for text requests that answers the Final_Image_Request by question id (`state_reached`, `locate_subject`), never by image bytes, with configurable probability and Box, and an option to raise `JevImageError` (multipart 400).
    - The wrapper records each request so tests can assert request count, question names and absence of images in step requests.
    - _Requirements: 11.10, 12.6, 12.7, 12.8_

- [x] 2. Expand demo-app with the modal and dropdown scenario
  - [x] 2.1 Add the settings modal, theme dropdown and language dropdown
    - Edit `examples/demo-app/src/main.ts` (and `index.html` styles if needed): "Open settings" button opens a `role="dialog"` modal named "Settings"; "Close" button closes it.
    - "Choose theme" trigger opens a list of at least three `role="option"` items including "Dark", fully inside the modal and the viewport. Choosing "Dark" shows "Theme: Dark" in an element named "Current theme".
    - "Choose language" trigger sits inside a container that clips overflow, so its opened list of at least three options extends beyond the modal bounding box (the real clipping defect).
    - Keep the existing "Menu" toggle, navigation and "Increment" counter unchanged. Add no CE reference and no CE-only test hook.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [x] 2.2 Write demo-app markup and behavior tests
    - Using Chromium via `chromium.testsupport.ts` and `demo-app.testsupport.ts` (temporary build dir): assert roles, names, option set, "Theme: Dark" update, "Close", unchanged Menu/Increment, theme list geometry inside modal and viewport, language list geometry beyond the modal, and no CE-only hooks in the source.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.11, 11.12_

- [x] 3. Implement the Observer
  - [x] 3.1 Implement observation types, `sanitizeText` and the Redactor in `observe.ts`
    - Define `ObservedElement`, `Observation`, `ObserveOptions`.
    - Implement `sanitizeText` in the order of the Glossary: collapse whitespace and control characters, trim, redact fixture values with `[redacted]` (longest first), truncate to 80 (path form 200) with `…` counted, then escape `\` and `"`.
    - Implement `createRedactor(fixtureValues)` (non-empty values only, longest first) for reuse by Capture, the loop and the capability mapping.
    - _Requirements: 1.9, 6.6_

  - [x] 3.2 Implement `observe()`, `buildStableLocator`, `computeDomDigest`
    - Snapshot every Actionable_Element; assign `e<N>` Refs in document order; compute `visible` as Playwright-visible AND NOT clipped to zero size by an ancestor; record empty name when no accessible name exists.
    - Build Stable_Locators in the order `data-testid`, role plus accessible name, `id`, CSS path (full unsanitized name, never written to question text).
    - Compute `fixtureKeys` for fill-capable fields with the case-insensitive trimmed match against `name`, `id`, an `autocomplete` token or the accessible name. Receive keys only, never values. Never read any input value.
    - Compute `navigation` as absolute on-origin URLs; resolve link `href` against the Target_Origin; compute `domDigest` with stable serialization.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 1.11, 6.1_

  - [x] 3.3 Write property test for `sanitizeText`
    - **Property 3: Sanitized_Text is bounded, single-line and fixture-free**
    - **Validates: Requirements 1.9, 6.6**

  - [x] 3.4 Write property tests for observation structure and stability
    - **Property 1: Observation structure is total and complete**
    - **Property 2: Refs and locators are stable and unique across repeated observation**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 1.7**

  - [x] 3.5 Write unit test for visibility computation
    - Concrete visible, `display: none` and zero-clipped-by-ancestor triple.
    - _Requirements: 1.4_

- [x] 4. Implement the Decider
  - [x] 4.1 Implement Change_Terms, Proximity_Score and shared decision types
    - In `decide.ts`: export `Option`, `DecidedAction`, `StepHistoryEntry`, `changeTermsFrom(files)` (split camelCase, ASCII alphanumerics, drop tokens shorter than 3, all-digit tokens and `CHANGE_STOPWORDS`; paths and added `+` lines only) and `proximityScore(matchText, changeTerms)` with whole-token equality over distinct Change_Terms.
    - _Requirements: 2.8, 12.14_

  - [x] 4.2 Implement `buildOptions`, `buildStateText`, `buildDecisionRequest`, `mapAnswerToAction`
    - `buildOptions`: Element_Options only for visible and enabled elements; none for cross-origin links; one fill Option per (field, matching fixture key) described by key only; Navigation_Options from `target.routes` skipping any URL equal to an observed link `href`; rank by descending Proximity_Score with document-then-routes tie-break; cap at 240; deterministic; empty Change_Terms keeps document order; no fill Option when fixtures are empty.
    - `buildStateText`: pure, path-only (no scheme, host or port), history lines `step <N>: <kind> <description> -> <result>`, nothing run-varying.
    - `buildDecisionRequest`: exactly `next_action` and `state_reached_dom` built with `CATALOG.runtimeNextAction.built(...)` and `CATALOG.runtimeStateReachedDom.built()`; no image asset; empty Option list still produces a request. Write no question text.
    - `mapAnswerToAction`: highest probability, ties to lowest Option index then `give_up` then `done`; fill Option maps to `fill` with its `fixtureKey`, other element Options to `click`, navigation to `goto`; invalid key maps to `give_up` with reason `invalid-answer`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 6.2, 6.5_

  - [x] 4.3 Write property test for option ranking, cap and determinism
    - **Property 4: Option ranking, cap and determinism**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 12.2**

  - [x] 4.4 Write property test for Change_Terms and Proximity_Score
    - **Property 5: Change_Terms and Proximity_Score are pure token functions**
    - **Validates: Requirements 2.8, 12.14**

  - [x] 4.5 Write property test for the decision request
    - **Property 6: Decision request is text-only and carries the two fixed questions**
    - **Validates: Requirements 3.1, 3.2, 3.10**

  - [x] 4.6 Write property test for answer-to-Action mapping
    - **Property 7: Answer-to-Action mapping is total, correctly typed and safe on invalid keys**
    - **Validates: Requirements 3.4, 3.5, 3.6, 12.3**

  - [x] 4.7 Write property test for the tie-break
    - **Property 8: Tie-break on equal top probability is deterministic**
    - **Validates: Requirements 3.7, 12.3**

  - [x] 4.8 Write property test for the state text
    - **Property 9: State text is a deterministic, origin-free round trip**
    - **Validates: Requirements 3.9, 12.16**

- [x] 5. Implement the Executor
  - [x] 5.1 Implement `execute()` guards and `isSameOrigin`
    - In `execute.ts`: accept a `ref` only when it names an element of the most recent Observation with `visible && enabled`; resolve it only through the stored Stable_Locator; refuse with no browser call and a `refusal` entry for `unobserved-ref`, `ineligible-ref`, and `locator-mismatch` (zero or more than one match at call time).
    - `fill` only with the value of the carried `fixtureKey`; refuse with `unknown-fixture` when the key is absent from fixtures or from the element's `fixtureKeys`.
    - `goto` accepted only when the URL is in `observation.navigation` and on the Target_Origin; otherwise `cross-origin`.
    - `isSameOrigin` compares scheme, host and port after default-port normalization. Use `callTimeoutMs` on every Playwright call. Refusal details pass through the Redactor.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.6, 6.3, 9.12_

  - [x] 5.2 Implement in-flight origin interception
    - Register a route/request interceptor before each state-changing action that aborts any top-level or frame navigation and any form submission whose origin differs from the Target_Origin, including every hop of a redirect chain; allow sub-resource requests.
    - On an aborted navigation record a `refusal` entry and return `give_up` with reason `cross-origin`. Remove the interceptor after the action.
    - _Requirements: 5.3, 5.4, 5.5, 5.7_

  - [x] 5.3 Write property test for cross-origin refusal
    - **Property 11: Cross-origin navigation is always refused, never completed**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 12.4**

  - [x] 5.4 Write property test for fixture matching and fill
    - **Property 12: Fixture matching and fill are total and fixture-value-free in text**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5**

  - [x] 5.5 Write integration test with two local servers for redirect hops
    - A same-origin navigation redirected by the server to the second local server is aborted, a `refusal` entry is recorded and the result is `give_up` with `cross-origin`.
    - _Requirements: 5.7, 12.4_

- [x] 6. Implement Capture
  - [x] 6.1 Implement `registerPageHandlers` and `waitForSettle`
    - In `capture.ts`: dismiss every dialog, cancel every download without writing a file, close every popup page; log `dialog` (message truncated to 500, redacted), `download` (suggested name), `popup` (Sanitized_Text URL) plus a `refusal` for popups, each with the current step number. Return a dispose function. Never observe, screenshot or send a popup page.
    - `waitForSettle`: no request in flight for 500 ms and an unchanged digest across two reads 100 ms apart, bounded by `SETTLE_TIMEOUT_MS`; on timeout append a `settle` entry and continue; clock and sleep are injectable.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.9, 8.10_

  - [x] 6.2 Implement `takeScreenshot` and `maskTargetsFor`
    - Always pass `animations: 'disabled'` and the computed masks. Build masks from Filled_Field locators (falling back to every `input`, `textarea` and `select` when one cannot be located) plus every element whose DOM text contains a fixture value as a case-sensitive substring. Fixture values flow only into `maskTargetsFor`.
    - _Requirements: 6.7, 6.8, 6.9, 8.8_

  - [x] 6.3 Write property test for dialog truncation
    - **Property 14: Dialog message truncation is bounded**
    - **Validates: Requirements 7.5**

  - [x] 6.4 Write property test for Event_Log step numbers
    - **Property 15: Event_Log entries carry the step number of their occurrence**
    - **Validates: Requirements 7.4**

  - [x] 6.5 Write property test for the settle wait
    - **Property 17: Settle wait is bounded and correctly reports timeout**
    - **Validates: Requirements 8.9, 8.10**

  - [x] 6.6 Write unit tests for handlers and masking
    - Dialog, download and popup dispatch and entries; handlers registered before the first Observation; screenshot call carries `animations: 'disabled'` and the mask for a Filled_Field; unlocatable Filled_Field falls back to masking all form fields; an element whose DOM text contains a fixture value is masked.
    - _Requirements: 6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.6, 7.7, 8.8, 12.10, 12.15, 12.17_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the Runtime_Loop
  - [x] 8.1 Implement `runLoop` core cycle in `loop.ts`
    - Export `StopReason`, `StepLogEntry`, `LoopResult`, `RunLoopInput` and `runLoop` with injectable page, gateway, clock, run directory and `AbortSignal`. Never import `outcome/resolve.ts`.
    - Register Capture handlers before step 0; write the step-0 screenshot (PNG under `runDir`, name contains the step number, stored relative) before the first decision.
    - Cycle: Observe, Decide (one text-only request per step), Execute, settle, re-observe. Take one screenshot after each state-changing action whose `domDigest` or path changed; otherwise reuse the most recent screenshot path so every Observation has a non-empty `screenshot`.
    - Stop on `done`, `reached` (`state_reached_dom` probability at least `REACHED_THRESHOLD`), `give_up` or an Executor give-up, `max-steps`, the Loop_Deadline (abort the pending gateway request via `AbortSignal`, stop waiting on the pending browser call), or an aborted input signal. Execute no further Action after the triggering step.
    - Give every Playwright call a timeout of `min(Playwright default, time remaining)`. Record each step as `{ observation, action, probabilities }`. Apply the Redactor to URL, title, names, dialog messages and refusal details.
    - When the page URL is off-origin after an Action: record a `refusal`, stop with `cross-origin`, take no screenshot of that page and reuse the last on-origin screenshot.
    - A non-image gateway error raises `StageError('runtime', cause)`; a screenshot write failure or a page crash raises `StageError('runtime', cause)` keeping screenshots already written.
    - _Requirements: 3.8, 4.6, 5.8, 7.4, 7.7, 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 12.11_

  - [x] 8.2 Implement the final screenshot and the Final_Image_Request
    - On every stop reason, take the final screenshot when the page is still available and on the Target_Origin; send no image request when no final screenshot exists.
    - Send exactly one request built with `finalImageQuestions(claim, pngBytes)` containing `state_reached` and `locate_subject` together, with an `AbortSignal` that fires at the Time_Budget with a reason identifying the loop's own deadline. Send no image in any step request.
    - On success record the `state_reached` probability, Subject_Box and dated model id, and set `finalState` to `reached` iff the probability is at least `REACHED_THRESHOLD`. On `JevImageError` set `finalImageError` (`'time-budget'` when the loop's own deadline aborted it, otherwise the error `reason`), leave the Box absent and derive `finalState` from Text_Signals (any step at or above the threshold, or ended `done`). Any other error raises `StageError('runtime', cause)`.
    - When stopped by `max-steps` or `time-budget`, `finalState` is `not_reached` unless the final signals say `reached`.
    - _Requirements: 8.5, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_

  - [x] 8.3 Write property test: no Action targets an unobserved ref (Done-when)
    - **Property 10: No Action ever carries a ref absent from the most recent Observation**
    - Generate Observations, Option lists and `next_action` answers (valid keys, invalid keys, `done`, `give_up`, out-of-range indexes); assert every `click` and `fill` handed to `execute` carries a Ref of the most recent Observation, and that `execute` makes no browser call and returns the correct give-up reason otherwise. This task is required because issue #10 "Done when" names this property test.
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 12.1**

  - [x] 8.4 Write property test for fixture-value containment
    - **Property 13: No fixture value ever appears outside the Executor and the Capture mask step**
    - **Validates: Requirements 6.4, 6.6, 6.7, 6.9, 12.14**

  - [x] 8.5 Write property test for screenshots on every Observation
    - **Property 16: Every Observation after the first carries a non-empty screenshot**
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [x] 8.6 Write property test for step and time budgets
    - **Property 18: The loop never exceeds its step or time budget, under any stop trigger**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.11, 12.5**

  - [x] 8.7 Write property test for terminal answers
    - **Property 19: A reached or terminal answer stops the loop without a further action**
    - **Validates: Requirements 9.4**

  - [x] 8.8 Write property test for the Loop_Result guarantee
    - **Property 20: The loop always resolves to a Loop_Result when at least one Observation exists**
    - **Validates: Requirements 9.9**

  - [x] 8.9 Write property test for per-call timeouts
    - **Property 21: Per-call timeout is the minimum of the Playwright default and the remaining budget**
    - **Validates: Requirements 9.12**

  - [x] 8.10 Write property test for final state resolution
    - **Property 22: Final state resolution is a deterministic function of the image result and the text signals**
    - **Validates: Requirements 9.6, 10.5, 10.6, 10.7, 10.11**

  - [x] 8.11 Write unit tests for the loop
    - Decision request failure raises `StageError` and stops; off-origin page after an Action; step-0 screenshot and final screenshot per stop reason; screenshot write failure; page crash keeps prior Observations; multipart 400 `JevImageError` yields `finalImageError`, no Box and Text_Signals `finalState`; exactly one Final_Image_Request containing both questions; no Final_Image_Request when no final screenshot exists; no image in step requests.
    - _Requirements: 3.8, 5.8, 8.1, 8.5, 8.6, 8.7, 10.2, 10.3, 10.6, 10.9, 12.6, 12.7_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement the Browser_Capability and pipeline wiring
  - [x] 10.1 Implement `selectClaim` and `mapLoopResultToRuntimeResult` in `capability.ts`
    - `selectClaim`: filter to `perClaim.surface === 'browser_ui'`; prefer `needed === true`, then highest `runtimeObservable`, first in `claims` order on ties; else highest `runtimeObservable` browser_ui; else highest among all claims; when `claims` is empty use the `change` subject text and mark the evidence claim `not_identified`.
    - `mapLoopResultToRuntimeResult`: pure and total. `finalState` unchanged; `evidence.change` from `context.change`; `evidence.claim`; `subject.url` is the base URL; one `{ kind, description }` per executed `click`, `fill`, `goto` in order with the Redactor applied; one `{ step, screenshot }` per Observation; `artifacts.runDir` and `artifacts.reportPath` (`<runDir>/report.html`, path string only). The result satisfies `satisfiesMinimumEvidence` for any LoopResult with at least one Observation.
    - _Requirements: 13.6, 13.8, 13.9, 13.10_

  - [x] 10.2 Implement `createBrowserCapability`
    - Return a `CapabilityEntry` named `browser_ui` with `surfaces: ['browser_ui']`. Export `RunDirMissingError` and `BrowserCapabilityDeps` (`cwd`, `env`, `openTarget`, `launchBrowser`, `clock`, `onLoopResult`).
    - `run`: throw `RunDirMissingError` before `openTarget` or launching a browser when `runDir` is absent; build `targetOptionsFromConfig(config, { cwd, env, runDir, signal })`; call `openTarget`; run `runLoop` with `baseUrl`, config settings, fixtures, claim text, Change_Terms from `context`, gateway and signal; map; call the Loop_Sink (default no-op); always call `TargetHandle.stop()` and `browser.close()` in one `finally` on success, error and abort. Errors propagate unchanged. Write no file besides screenshots.
    - The default `launchBrowser` uses `await import('playwright')` inside `run` and launches headless Chromium with `runtime.viewport`.
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.7, 13.9, 13.16_

  - [x] 10.3 Wire the default registry and `runDir` into `run/pipeline.ts`
    - Default `capabilities` becomes a registry containing `createBrowserCapability({ cwd, env, openTarget, launchBrowser })` built with the run's `cwd` and `env`. `run()`, `RuntimeHookInput` and `RuntimeResult` signatures do not change.
    - Always compute `runDir` as `path.resolve(cwd, output.dir ?? '.ce/runs', runDirName(now()))` when a capability is selected, including when `options.gateway` is supplied. Create `jev-calls.jsonl` only for a gateway the pipeline builds. A `SKIPPED` run never calls the capability.
    - Update `run/pipeline.test.ts`, `run/command.test.ts`, `run/command.target.test.ts` and `run/resolve.property.test.ts` to pass `EMPTY_REGISTRY` explicitly (or a temporary `cwd`) wherever they expect `UNSUPPORTED` for `browser_ui`.
    - _Requirements: 13.2, 13.11, 13.13, 13.14, 13.15, 13.16_

  - [x] 10.4 Write property test for claim selection
    - **Property 23: Claim selection follows a total, deterministic precedence order**
    - **Validates: Requirements 13.6**

  - [x] 10.5 Write property test for the result mapping
    - **Property 24: Loop_Result to RuntimeResult mapping is total and loses no required field**
    - **Validates: Requirements 13.8, 13.10**

  - [x] 10.6 Write unit tests for the Browser_Capability
    - Fake `openTarget`, fake browser, fake gateway, temporary Run_Dir. Assert: structural shape; `stop()` and `close()` on success, loop error and aborted signal; no target opened or browser launched when `runDir` is absent; claim selection for needed, not needed, tied and empty `claims`; mapping passes `satisfiesMinimumEvidence`; `required: false` never calls the capability; Loop_Sink invoked; `runDir` computed when a gateway is supplied.
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.6, 13.8, 13.9, 13.11, 13.12, 13.13, 13.14_

- [x] 11. End-to-end scenarios on demo-app (Done-when)
  - [x] 11.1 Write the dropdown-in-modal loop scenarios
    - Build the demo-app into a temporary directory and start it through `openTarget`; use real Chromium, a fixed `ChangeContext`, recordings of the fake gateway for text requests (state text is path-relative so recordings are port-independent) and the question-id wrapper from task 1.3 for the Final_Image_Request.
    - Scenario 1, claim "the theme dropdown is fully visible inside the settings modal": the loop executes `click` "Open settings" then `click` "Choose theme" and returns `finalState` `reached`; assert from page geometry that the list lies within the modal and the viewport.
    - Scenario 2, claim "the language dropdown is fully visible inside the settings modal": the loop executes `click` "Open settings" then `click` "Choose language"; assert from page geometry that the list extends beyond the modal; with a low-probability answer `finalState` is `not_reached`.
    - Add the recording fixtures the scenarios need under the existing fixtures layout.
    - This task is required because issue #10 "Done when" names this scenario.
    - _Requirements: 11.9, 11.10, 11.11, 11.12_

  - [x] 11.2 Write the `run()` end-to-end test with the default registry
    - Call `run()` with the default registry, a supplied fake gateway and a temporary `cwd`: a required `browser_ui` Assessment against the demo-app scenario of task 11.1 resolves to `EVIDENCED` with screenshots under the run directory and no `run.json` or `report.html` written.
    - _Requirements: 13.2, 13.9, 13.10, 13.12, 13.13_

- [x] 12. Architecture tests
  - [x] 12.1 Extend the architecture tests for `runtime/`
    - In the existing architecture test suite, assert that no file under `runtime/` imports `@typesafe-ai/sdk`, calls `fetch` for Jev, imports `outcome/resolve.ts` or declares question text, and that no module reachable statically from `index.ts` (including `run/pipeline.ts` and `runtime/capability.ts`) imports `playwright`.
    - _Requirements: 9.10, 10.4, 12.9, 12.17, 13.16_

- [x] 13. Verification and PR checklist for issue #10
  - [x] 13.1 Write `.ce/pr-checklist-issue-10.md`
    - Follow the layout of `.ce/pr-checklist-issue-9.md`: begin with `Closes #10`, a summary, a verification table of `npm run typecheck`, `npm test`, `npm run build` (run with `env -u OPENROUTER_API_KEY -u TYPESAFE_API_KEY`), and one row per issue #10 checklist item and per "Done when" line with the test that proves it:
      - observe with ≤240 ranked options: tasks 3.2, 4.2, 4.3
      - decide, one text-only request: tasks 4.2, 4.5
      - execute guards: tasks 5.1, 5.2, 8.3, 8.11
      - screenshots, max steps and time budget: tasks 8.1, 8.6
      - combined final image request and `JevImageError` fallback: tasks 8.2, 8.11
      - demo-app modal and dropdown: task 2.1
      - Done when, dropdown-in-modal reaches the claimed state: task 11.1
      - Done when, property test on unobserved refs: task 8.3
    - Record the real command output after running the commands.
    - _Requirements: 4.6, 10.2, 11.9, 12.1, 12.12_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP. Tasks 8.3, 11.1 and 11.2 and the architecture tests in 12.1 are not optional, because the issue #10 "Done when" lines and the PR to close #10 depend on them.
- Issue #10 coverage: observe and ranking (3, 4), decide (4), execute guards (5), dialogs and downloads (6), screenshots and budgets (6, 8), final image request and `JevImageError` fallback (8), demo-app scenario (2, 11), both "Done when" lines (8.3, 11.1).
- Each task references specific requirements for traceability; checkpoints give incremental validation.
- Property tests validate universal properties from the design; unit and integration tests cover fixed scenarios.
- Chromium-dependent tests need `npx playwright install chromium` locally.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.1", "6.1"] },
    { "id": 3, "tasks": ["3.4", "3.5", "4.2", "4.3", "4.4", "5.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "4.8", "5.2", "6.6"] },
    { "id": 5, "tasks": ["5.3", "5.4", "5.5"] },
    { "id": 6, "tasks": ["7"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["8.2"] },
    { "id": 9, "tasks": ["8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11"] },
    { "id": 10, "tasks": ["9"] },
    { "id": 11, "tasks": ["10.1"] },
    { "id": 12, "tasks": ["10.2", "10.4", "10.5"] },
    { "id": 13, "tasks": ["10.3", "10.6", "11.1"] },
    { "id": 14, "tasks": ["11.2", "12.1"] },
    { "id": 15, "tasks": ["13.1"] },
    { "id": 16, "tasks": ["14"] }
  ]
}
```
