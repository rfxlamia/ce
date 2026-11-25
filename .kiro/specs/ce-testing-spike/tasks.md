# Implementation Plan: CE Testing Spike (Jev via OpenRouter)

## Overview

This plan builds the throwaway Spike_Harness in `spike/jev-openrouter/` (TypeScript, run with `tsx`), runs it against the live service, and turns the measurements into a Findings_Document and design reconciliation. It implements GitHub issue #3.

Constraints that apply to every task:

- The harness lives outside `packages/ce/src/` and outside the root npm workspaces. It is never part of root `npm test`, `npm run build`, or `npm run typecheck`.
- No production CE code is added. Probe question text stays local to the harness and is never written to `jev/catalog.ts`.
- Secrets live only in the git-ignored `.env`. No credential value goes into any committed file, sample, log, or the Findings_Document.
- `SPEC.md` is not edited. A contradiction with `SPEC.md` is reported in the Findings_Document and needs a maintainer decision (R6.5).
- Tasks marked **[REQUIRES REAL KEY — USER-RUN]** need the user's `OPENROUTER_API_KEY` in `.env`. An agent must not run them or invent their results (R9.3).

## Tasks

- [x] 1. Scaffold the harness and environment tooling
  - [x] 1.1 Create harness package, env example, and gitignore rules
    - Create `spike/jev-openrouter/package.json` (private, not a workspace member) with devDependencies `dotenv`, `@typesafe-ai/sdk`, `tsx`, `typescript`, `vitest`, `fast-check`, and scripts `spike` (runs `run.ts`) and `test` (runs the harness's own vitest). Add `tsconfig.json`.
    - Create the folder skeleton `checks/`, `lib/`, `fixtures/`.
    - Create root `.env.example` listing `OPENROUTER_API_KEY=` and `TYPESAFE_API_KEY=` with empty values.
    - Update root `.gitignore` to ignore `.env` and keep `.env.example` tracked (read the file first, do not clobber existing entries).
    - Confirm the root `package.json` workspaces globs (`packages/*`, `examples/*`) do not match `spike/`, and do not add `dotenv` to `packages/ce`.
    - _Requirements: 8.6, 8.7, 8.11, 8.12, 8.13, 8.14, 8.15, 9.4_

- [x] 2. Implement harness libraries
  - [x] 2.1 Implement `lib/stats.ts`
    - Export `computeStats(samples, failureCount)` returning `p50`, `p95`, `min`, `max`, `count`, `failures`, computed from successful samples only. Handle the empty array without throwing.
    - _Requirements: 3.3, 3.5_

  - [x] 2.2 Implement `lib/sanitize.ts`
    - Export `sanitizeRequest`, `sanitizeResponse`, and `assertNoEnvLeak` (throws if the value contains the current `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` value). Drop `Authorization` and other credential headers.
    - _Requirements: 7.2, 8.2, 8.15_

  - [x] 2.3 Implement `lib/env.ts`, `lib/client.ts`, and the call wrapper
    - `env.ts`: load `.env` with `dotenv` without overriding variables already set, and without error when the file is missing. Exit with a message naming `OPENROUTER_API_KEY` and send no request when it is unset. Report `TYPESAFE_API_KEY` as absent without failing.
    - `client.ts`: `buildClient({ provider })` for `openrouter` (`baseURL` `https://openrouter.ai/api`) and `typesafe`. Never log the key.
    - Call wrapper: time one call, catch errors, and return a `HarnessCallResult` with `errorClass`, `httpStatus`, `errorMessage`, `retryAfter`, `latencyMs`, `modelReturned`, and token usage. Do not retry.
    - Never print or write credential values.
    - _Requirements: 1.5, 3.6, 4.1, 8.1, 8.2, 8.3, 8.4, 8.9, 8.10_

  - [x] 2.4 Implement `lib/samples.ts`
    - `newDatedOutputDir(base)` creates a new timestamped directory under `docs/journal/v0.0/samples/` and never reuses or overwrites one.
    - `writeSample` calls `assertNoEnvLeak`, writes sanitized `RawSample` JSON with `modelId` and `latencyMs`, and writes any image as a separate file referenced by `imageRef`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.8_

  - [x] 2.5 Implement conformance diff and model-id aggregation
    - `lib/conformance.ts`: compare a response answer to the SDK_Types shape (`noul`, `choice`, `score`, `box`) and return entries `{ field, expectedType, observedValue }`.
    - `lib/models.ts`: group returned Model_Ids per request type with counts, ignoring failed calls.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.3_

  - [x] 2.6 Write property test for latency statistics
    - **Property 1: Latency statistics separate successes from failures and are internally consistent**
    - Use `fast-check` with at least 100 runs, as in the design's Testing Strategy.
    - **Validates: Requirements 3.3, 3.5**

  - [x] 2.7 Write unit tests for stats and sanitize
    - Stats: empty array, single sample, all-equal, reverse-sorted, successes with non-zero failures.
    - Sanitize: `assertNoEnvLeak` throws on a string containing a set env value and passes otherwise. `Authorization` header is stripped and other fields are untouched.
    - _Requirements: 3.3, 3.5, 7.2, 8.2_

  - [x] 2.8 Write unit tests for env, client wrapper, and samples
    - Env: pre-set variable is not overridden, missing `.env` does not throw, missing `OPENROUTER_API_KEY` exits naming the variable with no request sent, missing `TYPESAFE_API_KEY` is recorded as skipped.
    - Wrapper: thrown `TypeError`, thrown plain object, error with `status`, rate-limit error with `retry-after`.
    - Samples: two successive dated directories never collide, image is written as a separate referenced file.
    - _Requirements: 1.5, 3.6, 7.5, 8.3, 8.4, 8.8, 8.9, 8.10_

  - [x] 2.9 Write unit tests for conformance diff and model-id aggregation
    - Conformance: missing field and wrong-typed field each produce a named entry.
    - Models: all same id, two distinct ids split evenly, failed call mixed with successes.
    - _Requirements: 1.4, 4.3_

- [x] 3. Checkpoint - Ensure all tests pass
  - Run the harness's own tests (`npm test` inside `spike/jev-openrouter`, no key needed). Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the checks (code only, no live run)
  - [x] 4.1 Implement `checks/primitives.ts`
    - Send one `choice`, one `noul`, and one `score` probe through the OpenRouter_Route with `typesafe/jev-1.14`, using locally defined question text on a synthetic state.
    - Record full responses, conformance diffs, and model ids. A failed call is recorded and does not stop the others.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1_

  - [x] 4.2 Implement `checks/mixed-state.ts`
    - Send the Mixed_State_Request (text and `image_url` parts, `noul` and `box`) using `fixtures/demo-app-screenshot.png`. Send the `TypeSafe-Danger-Zone-Images: true` header and record any model override needed for `box` (the docs say `jev-preview`). Record the override explicitly.
    - Record both answers' presence, box coordinates, and coordinate convention. Leave "box encloses subject" as a field for human judgment.
    - Repeat with the image removed and record whether the response shape changes.
    - On failure or an absent `box`: try separate `noul` and `box` requests, then the `typesafe` provider when `TYPESAFE_API_KEY` is set. Record each result, or record the skip.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 8.4_

  - [x] 4.3 Implement `checks/latency.ts`
    - Build a Next_Action_Request (text only, about 100 locally invented options) and a Final_Image_Request (screenshot, `noul` and `box`). Send at least 20 sequential samples of each.
    - Compute stats with `computeStats`, excluding failures. Record option count, reported input tokens, failure count, and any `retry-after` or rate-limit occurrence with its request.
    - Include the per-step budget comparison input (stated budget: 90 s timeout / 12 steps, about 7.5 s per step) so the Findings_Document can state fit or no fit.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1_

  - [x] 4.4 Implement `fixtures/capture-screenshot.ts`
    - A Playwright script that opens a running `examples/demo-app` (URL as an argument) and writes `spike/jev-openrouter/fixtures/demo-app-screenshot.png` (PNG). It needs no API key.
    - _Requirements: 2.2_

- [x] 5. Wire the harness together
  - [x] 5.1 Implement `lib/findings.ts`
    - Generate a draft Findings_Document at `docs/journal/v0.0/spike-jev-openrouter.md` from collected `HarnessCallResult[]`. Sections in order: primitive compatibility, mixed text and image state, latency, model identification. Each has method, result, and a status line.
    - Fill in run date, SDK version, Node.js version, Pinned_Model, Model_Id field location, distinct Model_Ids with counts, the samples directory name, and measurement limits (sample count, time of day, network location, single run).
    - Leave status values and the consequences list (R5.5, R6.4) as clearly marked items for the human reviewer. Call `assertNoEnvLeak` before writing.
    - A check that could not run is written as `not confirmed` with its cause and no inferred result.
    - _Requirements: 3.7, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 9.3_

  - [x] 5.2 Implement `run.ts`
    - Load env first, exit before any request if `OPENROUTER_API_KEY` is missing, then run primitives, mixed-state, and latency in order. Write Raw_Samples to a new dated directory and generate the draft Findings_Document. Write partial results if a check fails.
    - Do not wire `run.ts` into any root script.
    - _Requirements: 7.1, 8.1, 8.3, 8.6, 8.7, 8.8, 9.3_

  - [x] 5.3 Write `spike/jev-openrouter/README.md`
    - Document the single run command from the repository root (`npx tsx spike/jev-openrouter/run.ts`), that `OPENROUTER_API_KEY` goes in `.env` (copied from `.env.example`), the optional `TYPESAFE_API_KEY`, how to capture the screenshot fixture, and that the harness is not part of `npm test`.
    - _Requirements: 8.5, 8.7_

- [x] 6. Checkpoint - Ensure all tests pass
  - Run the harness tests and `npm run typecheck` from the repository root to confirm `packages/ce` is unaffected. Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Live run and reconciliation (manual, needs the user)
  - [x] 7.1 **[USER-RUN, no key needed]** Capture the demo-app screenshot fixture
    - Start `examples/demo-app` in a terminal, then run the `capture-screenshot.ts` script from task 4.4 against its URL. Confirm `fixtures/demo-app-screenshot.png` exists and shows the intended subject.
    - _Requirements: 2.2_

  - [x] 7.2 **[REQUIRES REAL KEY — USER-RUN]** Execute the harness against the live service
    - The user puts their `OPENROUTER_API_KEY` in `.env` (and optionally `TYPESAFE_API_KEY`), then runs the documented command from the README. An agent must not run this or fabricate output.
    - Result: a dated samples directory and a draft Findings_Document.
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 3.1, 3.2, 4.1, 8.5, 9.3_

  - [x] 7.3 **[USER-REVIEW]** Complete the Findings_Document
    - Using the real outputs, judge whether the box encloses the subject, set each check's status (`confirmed`, `confirmed with differences`, `not confirmed`), and write the consequences list naming each affected `design.md` section or journal requirement (or "no change needed"). Report any contradiction with `SPEC.md` without editing `SPEC.md`.
    - _Requirements: 2.3, 5.3, 5.5, 6.4, 6.5, 9.2, 9.3_

  - [x] 7.4 Verify no credential leaked
    - Grep the samples directory, the Findings_Document, and `git status` output for the user's key values (do not print the values) and confirm `.env` is untracked and ignored.
    - _Requirements: 5.7, 7.2, 8.2, 8.15_

  - [x] 7.5 Reconcile `docs/journal/v0.0/design.md`
    - For each non-`confirmed` check, update the affected sections (candidates from the spec design: `box` needing `jev-preview`, image header requirement, `score` answer shape). If all checks are `confirmed`, mark the section 12 open question resolved and link the Findings_Document. Keep consistent with `SPEC.md` and leave `SPEC.md` unchanged.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [~] 7.6 **[USER-RUN]** Commit and close issue #3
    - Commit the Findings_Document, samples, design changes, and harness (never `.env`). Close issue #3 once all four checks have a status.
    - _Requirements: 9.1, 9.2, 9.4_

- [~] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Task 7 is manual by design. Tasks 7.2 needs the user's real key, and no agent should run it or infer its results.
- Property 1 is the only property test, because every other criterion is a live-service or document check.
- Each task references specific requirement clauses for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 2, "tasks": ["2.6", "2.7", "2.8", "2.9"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "4.4"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3"] },
    { "id": 7, "tasks": ["6"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["7.2"] },
    { "id": 10, "tasks": ["7.3"] },
    { "id": 11, "tasks": ["7.4", "7.5"] },
    { "id": 12, "tasks": ["7.6"] },
    { "id": 13, "tasks": ["8"] }
  ]
}
```
