# Implementation Plan: claims-assessment-eval

## Overview

Implements issue #7 ("[M1] Claims and assessment + eval set") in TypeScript, following `design.md` and `requirements.md` of this spec. Order: shared foundations, request builders in `jev/catalog.ts`, the pure Combiner, the Claim_Identifier and Assessor, an architecture test, then the `eval/` harness, the `fixtures/eval/` corpus, the `ce eval` CLI wiring with `.env` loading, and finally the manual Live_Run and journal record.

Conventions for every task:

- Tests use `FakeJevGateway` (`jev/fake.ts`) and need no API key. Property tests use fast-check with at least 100 runs and carry the tag `Feature: claims-assessment-eval, Property N: <title>`.
- All question text stays in `jev/catalog.ts`. Nothing in `assessment/` or `eval/` decides an Outcome or imports `outcome/resolve.ts`.
- Run `npm run typecheck` and `npm test` from the repository root. Use `vitest --run`, never watch mode.
- Group 12 is manual. It needs a real `OPENROUTER_API_KEY`, it is not part of CI, and no coding agent should run it unattended.

## Tasks

- [x] 1. Foundations: shared predicate, types and answer reading
  - [x] 1.1 Export `isTestFile` from `context/budget.ts` and `context/index.ts`
    - Extract the `RANK_TEST` predicate (`TEST_DIRS`, `.test.`, `.spec.`) of `rankOf` into an exported `isTestFile(path)`. `TEST_DIRS` stays private.
    - Change `rankOf` to call `isTestFile`. Ranking output must not change; existing `budget.rank.test.ts` must pass unmodified.
    - Re-export `isTestFile` from `packages/ce/src/context/index.ts`.
    - _Requirements: 4.10, 16.16_

  - [x] 1.2 Write unit test that `isTestFile` and `rankOf` agree
    - Add to a new `context/budget.istestfile.test.ts`. Check concrete paths: `tests/a.ts`, `src/__tests__/b.ts`, `e2e/c.ts`, `x.test.ts`, `x.spec.ts`, `src/app.ts`.
    - Assert `rankOf` gives the test rank exactly when `isTestFile` is true.
    - _Requirements: 16.16_

  - [x] 1.3 Create `assessment/types.ts`
    - Define `Surface`, `Claim`, `AssessedSubject`, `PerClaimAssessment`, `Cut`, `AssessmentRecord`, `Assessment`, `AssessmentSettings` as in the design. All fields plain JSON-serializable.
    - _Requirements: 2.1, 2.3, 3.2, 3.3, 8.1 to 8.5, 8.7, 10.2_

  - [x] 1.4 Create `assessment/answers.ts` (answer reading and validation)
    - Export `readNoul(answer)` and `readChoice(answer, labels)` that return probabilities, and throw `RangeError`/`TypeError` for a wrong `type`, a probability outside 0 to 1, or a Choice answer missing any of the six `SURFACE_LABELS`.
    - Export `argmaxSurface(probabilities)` that breaks ties toward the label earliest in `SURFACE_LABELS`.
    - Reuse these helpers from `claims.ts`, `assess.ts` and `eval/run.ts` so the Eval_Runner reads answers exactly like the Assessor.
    - _Requirements: 1.6, 5.1 to 5.5, 9.3, 13.3_

- [x] 2. Request builders in `jev/catalog.ts`
  - [x] 2.1 Add `buildClassificationRequest` and `buildAssessmentRequest`
    - Place next to `finalImageQuestions`. Plain object literals, `state: string`, no image, stage handled by the caller. Field labels only (`candidate:`, `title:`, `files:`, `claim:`, `patches:`, `checks:`), no question text, no catalog version change.
    - Classification: one question (`CATALOG.claimIsBehavior.built()`). Shorten only the title/files summary with `truncateToTokens` to stay within `STATE_BUDGET_TOKENS`. Never touch the candidate text.
    - Assessment: three questions. Apply `fitCheckResults(context.checks, REQUEST_HEADROOM_TOKENS)` and record `check-cap` cuts. When over budget, cut patches of non-test files last-to-first, then test files last-to-first, shortening only by the excess owed, recording `truncated` or `dropped` with `isTest` from `isTestFile`.
    - Throw a plain `Error` when the state is still over budget with every patch empty.
    - Return `{ request, cuts }`. No env, file system or network access.
    - _Requirements: 1.1 to 1.4, 4.1 to 4.14_

  - [x] 2.2 Write property test for Classification_Request composition
    - File: `jev/catalog.classification.property.test.ts`.
    - **Property 2: Classification_Request state composition (no-new-text)**
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 2.3 Write property test for Assessment_Request composition
    - File: `jev/catalog.assessment.property.test.ts`.
    - **Property 7: Assessment_Request state composition (no-new-text)**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.11, 4.12**

  - [x] 2.4 Write property test and unit tests for patch cutting
    - File: `jev/catalog.cutting.test.ts`.
    - **Property 8: Test_File patch-cutting protection**
    - **Validates: Requirements 4.5, 4.6, 4.7, 4.8**
    - Unit tests: only the non-test patch is cut when that suffices; last non-test file is cut first; test patch cut only after all others are empty; each cut recorded with the right `isTest`; still over budget with all patches empty throws.
    - _Requirements: 4.7 to 4.10, 16.14_

  - [x] 2.5 Write test that `catalog.snapshot.json` is unchanged
    - Assert the existing catalog snapshot test still passes without running `update:catalog-snapshot`, and that no catalog entry version changed.
    - _Requirements: 16.10_

- [x] 3. Combiner
  - [x] 3.1 Implement `assessment/combine.ts`
    - Pure `combine(subjects, settings)` returning `perClaim`, `required`, `decidedBy`, dominant `surface`, and `policyDecision` when `decidedBy === 'policy'`.
    - `needed = runtimeObservable >= observable && checksAdequate < adequate`. `uncertain` uses closed band `<= band` on both probabilities. `required = any(needed) || (any(uncertain) && onUncertain === 'evidence')`. `decidedBy = 'policy'` iff no `needed` and some `uncertain`.
    - Dominant surface per Decision D7. Empty input returns `required: false`, `decidedBy: 'classifier'`, `surface: 'non_runtime'`.
    - Do not import `outcome/resolve.ts` and do not compare surface with a capability catalog.
    - _Requirements: 5.6, 6.1 to 6.11, 7.1 to 7.4, 7.7_

  - [x] 3.2 Write property test for Combiner decision formulas
    - File: `assessment/combine.formulas.property.test.ts`. Include a `band = 0` case.
    - **Property 10: Combiner decision formulas**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.10, 6.11**

  - [x] 3.3 Write property test for Combiner totality
    - File: `assessment/combine.totality.property.test.ts`. Include the empty list.
    - **Property 11: Combiner totality and output cardinality**
    - **Validates: Requirements 5.6, 6.9**

  - [x] 3.4 Write property test for `decidedBy`
    - File: `assessment/combine.decidedby.property.test.ts`.
    - **Property 12: decidedBy iff and policy record**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

  - [x] 3.5 Write property test for policy irrelevance
    - File: `assessment/combine.policy.property.test.ts`.
    - **Property 13: Policy-irrelevance under classifier decision**
    - **Validates: Requirements 7.5**

  - [x] 3.6 Write unit tests for Combiner scenarios
    - File: `assessment/combine.test.ts`. Three uncertainty cases (`needed`; only `uncertain` with `evidence`; only `uncertain` with `skip`), and a subject far from both thresholds gives `decidedBy: 'classifier'` for both policies. Dominant surface tie goes to the earliest subject.
    - _Requirements: 6.5 to 6.7, 7.1 to 7.3, 16.4, 16.5_

- [x] 4. Claim_Identifier
  - [x] 4.1 Implement `assessment/claims.ts`
    - `identifyClaims(context, settings, gateway)`: `cli`-provenance candidates become Declared_Claims (`probability: null`, `declared: true`) with no request. Every other candidate gets one Classification_Request with `stage: 'assessment'`.
    - Create a Claim when `p >= claimThreshold`. Keep text verbatim, keep `context.candidates` order, record every classified candidate, question and model id for the Assessment_Record.
    - Malformed answers and gateway errors surface to the caller (wrapped by `assess()`).
    - _Requirements: 1.1 to 1.8, 2.1 to 2.4, 2.9_

  - [x] 4.2 Write property test for classification cardinality
    - File: `assessment/claims.cardinality.property.test.ts`. Use `FakeJevGateway` recordings built from the request builder and `stateHash`.
    - **Property 1: Classification request cardinality and exclusion**
    - **Validates: Requirements 1.1, 1.8, 2.3**

  - [x] 4.3 Write property test for claim identity and order
    - File: `assessment/claims.identity.property.test.ts`.
    - **Property 3: Claim identity and order**
    - **Validates: Requirements 1.7, 2.4**

  - [x] 4.4 Write property test for threshold monotonicity
    - File: `assessment/claims.monotonic.property.test.ts`.
    - **Property 4: Claim threshold monotonicity**
    - **Validates: Requirements 2.1, 2.2, 2.9**

  - [x] 4.5 Write unit tests for the Claim_Identifier
    - File: `assessment/claims.test.ts`. A candidate exactly at the threshold becomes a Claim; a Declared_Claim sends no request; a below-threshold candidate is recorded but not a Claim.
    - _Requirements: 2.1 to 2.3, 16.4_

- [x] 5. Assessor and public API
  - [x] 5.1 Implement `assessment/assess.ts`
    - `resolveAssessmentSettings(config, defaults = ConfigDefaults)`: per-value fallback; throws when a value is missing from both. It is the only reader of the `assessment` key.
    - `selectChangeSubject(context)`: title, then description, then first commit message; first non-blank line, trimmed; records provenance; throws when none exists.
    - `assess(context, config, gateway, options?)`: identify claims, build subjects (one per Claim, or one Change_Subject with id `change`), send one Assessment_Request per subject, read answers with `answers.ts`, call `combine`, assemble `AssessmentRecord` (questions, candidates, distinct model ids, settings, cuts, `policyDecision`).
    - Wrap any non-`StageError` as `StageError('assessment', cause)` including `RateLimitError`. No partial result, no `process.env`.
    - _Requirements: 2.5 to 2.8, 3.1 to 3.6, 4.13, 5.1 to 5.6, 8.1 to 8.6, 9.1 to 9.4, 10.1, 10.3 to 10.5, 10.7 to 10.9_

  - [x] 5.2 Create `assessment/index.ts`
    - Export `assess`, `resolveAssessmentSettings`, `combine` and the types `Assessment`, `AssessmentRecord`, `AssessmentSettings`, `AssessedSubject`, `Claim`, `Cut`, `PerClaimAssessment`, `Surface`.
    - _Requirements: 10.2, 10.9_

  - [x] 5.3 Write property test for `claimStatus` totality
    - File: `assessment/assess.claimstatus.property.test.ts`.
    - **Property 5: claimStatus totality**
    - **Validates: Requirements 2.5, 2.6, 2.7, 2.8**

  - [x] 5.4 Write property test for Change_Subject selection
    - File: `assessment/assess.subject.property.test.ts`. Include a description whose first line is blank and a context with no title or description.
    - **Property 6: Change_Subject selection priority**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

  - [x] 5.5 Write property test for surface argmax tie-break
    - File: `assessment/answers.surface.property.test.ts`.
    - **Property 9: Surface argmax tie-break**
    - **Validates: Requirements 5.3, 5.4**

  - [x] 5.6 Write property test for Assessment_Record completeness
    - File: `assessment/assess.record.property.test.ts`. Inject a fake secret and assert it never appears in the record.
    - **Property 14: Assessment_Record completeness and no-leak**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.6**

  - [x] 5.7 Write property test for JSON round-trip
    - File: `assessment/assess.roundtrip.property.test.ts`.
    - **Property 15: Assessment/record JSON round-trip**
    - **Validates: Requirements 8.7**

  - [x] 5.8 Write property test for malformed-answer rejection
    - File: `assessment/assess.malformed.property.test.ts`.
    - **Property 16: Malformed-answer rejection**
    - **Validates: Requirements 9.3**

  - [x] 5.9 Write property test for `assess()` determinism
    - File: `assessment/assess.determinism.property.test.ts`.
    - **Property 17: assess() determinism**
    - **Validates: Requirements 10.6**

  - [x] 5.10 Write property test and unit tests for settings fallback
    - File: `assessment/assess.settings.test.ts`.
    - **Property 18: resolveAssessmentSettings fallback**
    - **Validates: Requirements 10.7, 10.8**
    - Unit tests: `assess` with config `{}` and with partial `assessment` equals the result with values filled from `ConfigDefaults`; incomplete `defaults` plus missing config value raises `StageError('assessment', cause)`. Do not mutate `ConfigDefaults`.
    - _Requirements: 10.7, 10.8, 16.15_

  - [x] 5.11 Write unit tests for assessor errors and edge cases
    - File: `assessment/assess.test.ts`. No accepted Claim gives `not_identified` and a Change_Subject; empty context raises `StageError`; a malformed answer raises `StageError`; `RateLimitError` becomes `StageError('assessment', cause)` with the cause preserved; a foreign `StageError('context')` passes through unchanged.
    - _Requirements: 3.4, 9.1 to 9.4, 16.4_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Architecture test
  - [x] 7.1 Write `assessment/architecture.test.ts`
    - Model it on `jev/architecture.test.ts`. Assert that files under `assessment/` and `eval/`: do not import `outcome/resolve`; do not contain `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` as returned values; do not import `@typesafe-ai/sdk`, `jev/transport-sdk` or `jev/transport-json`; do not call `fetch`; do not define question text or call `noul`, `choice`, `score`, `box`, `image`, `withAssets`.
    - Assert that `process.loadEnvFile` appears only in `cli.ts` among files under `packages/ce/src/`.
    - _Requirements: 9.5 to 9.9, 14.18, 16.6_

- [x] 8. Eval harness (`packages/ce/src/eval/`)
  - [x] 8.1 Implement `eval/fixture.ts`
    - zod `EvalFixtureSchema`, `loadFixtures(dir)` returning tagged failures (`directory`, `schema`, `unlabelled-candidate`, `unknown-label`). Read `*.json` in ascending file-name order. Require `id` equal to file name without `.json`.
    - Build each fixture's `ChangeContext` through the providers of 8.2 and `resolveContext`, then cross-check labels: `isBehavior` required for non-`cli` candidates and rejected for `cli` candidates; the three assessment labels required for `isBehavior: true` and `cli` candidates; reject labels naming unknown candidate text. No Jev question before validation passes.
    - Never throws, never modifies fixture files.
    - _Requirements: 11.2 to 11.5, 12.1, 12.3 to 12.8_

  - [x] 8.2 Implement `eval/providers.ts`
    - `fixtureGitProvider`, `fixtureGithubProvider` (title/body only, no `baseSha`, `baseRef`, `headSha`, `before`; `unavailable` with `source-absent` when no title or description), `fixtureJunitProvider`, and `createStubExec()` that records calls and returns an error. Reuse production `resolveCliArgs` for `claims`.
    - Export a helper that calls `resolveContext` with these providers, the stub exec and the command `env`, and returns the stub's recorded calls so the caller can raise `StageError('context', cause)` naming the fixture id when `calls.length > 0`. Never read `GITHUB_EVENT_PATH`.
    - _Requirements: 12.2, 12.9 to 12.11, 14.11_

  - [x] 8.3 Implement `eval/memo.ts` (`EvalMemoGateway`)
    - Implements `JevGateway`. Key: stage, sorted `name@idVersion` list, `stateHash(state)`. Share one in-flight promise between concurrent identical requests; do not store a failed request. Expose `stats: { requests, memoHits }`.
    - _Requirements: 13.13 to 13.16_

  - [x] 8.4 Implement `eval/agreement.ts`
    - `AgreementRow`, `Disagreement`, and generic `buildRow(question, samples, equal)`; `agreement` is `null` iff `samples === 0`; disagreements count equals `samples - agreeing`.
    - _Requirements: 13.1, 13.6, 13.7, 13.10, 13.11_

  - [x] 8.5 Implement `eval/run.ts` (`runEval`)
    - Load fixtures, wrap the gateway in one `EvalMemoGateway`, build contexts per fixture in ascending id order, and raise `StageError('context')` when the stub exec recorded a call, before any Jev question for that fixture.
    - Ask `claim.is_behavior` for every non-`cli` candidate; ask the three assessment questions for every `isBehavior: true` and every `cli` candidate (Decision D9), using the same builders and `answers.ts` as the Assessor. Compare with thresholds per Decision D10.
    - Call `assess()` once per fixture and build the aggregate rows `assessment.required` and `assessment.claimStatus` only from its output.
    - Return the `EvalResult`: rows, disagreements, distinct model ids, fixture count, resolved settings (via `resolveAssessmentSettings`), `requests`, `memoHits`. Never decide an Outcome.
    - _Requirements: 12.1 to 12.11, 13.1 to 13.9, 13.12, 13.13_

  - [x] 8.6 Implement `eval/report.ts` and `eval/command.ts`
    - `report.ts`: print one line per row (question id, samples, agreeing, percentage; `n/a` for `null`), then the disagreement list. Never print keys, Authorization headers or request state.
    - `command.ts`: `runEvalCommand(argv, deps)` with `deps = { env, cwd, stdout, stderr, createGateway, now }`. Order: parse args (`--fixtures`, `--config`, also `--name=value`; unknown/duplicate/valueless option prints usage, returns 1, calls neither `loadConfig` nor `createGateway`), `loadConfig`, `requireJevCredentials`, `createGateway` with `createJsonlCallLog`, `runEval`, write `eval.json` and `jev-calls.jsonl` under `<output.dir>/eval-<timestamp>/`, print table and path. Return 1 on any failure (config via `reportConfigFailure(failure, collectSecretValues(env), stderr)`, fixture failures, `StageError` with stage name and cause constructor name), 0 on completion regardless of agreement. No `process.exit`, no `process.env`.
    - _Requirements: 8.8, 13.12, 14.1 to 14.9, 14.11 to 14.14_

  - [x] 8.7 Create `eval/index.ts`
    - Export `loadFixtures`, `EvalMemoGateway`, `runEval`, `runEvalCommand` and the types `EvalFixtureFile`, `EvalResult`, `AgreementRow`, `Disagreement`.
    - _Requirements: 14.12_

  - [x] 8.8 Write property test for eval bounds and accounting
    - File: `eval/agreement.property.test.ts`. Include the empty sample list.
    - **Property 19: Eval bounds and accounting**
    - **Validates: Requirements 13.1, 13.2, 13.6, 13.7, 13.10, 13.11**

  - [x] 8.9 Write property test and unit tests for `EvalMemoGateway`
    - File: `eval/memo.test.ts`.
    - **Property 20: Eval_Memo_Gateway memo-transparency**
    - **Validates: Requirements 13.13, 13.14, 13.15, 13.16**
    - Unit tests: two identical requests reach the underlying gateway once; differing state, question set or stage reach it separately; concurrent identical requests reach it once; a failed request is not stored; a recording gateway's Call_Log has `requests` entries; `requests + memoHits` equals the number asked.
    - _Requirements: 13.13 to 13.16, 16.13_

  - [x] 8.10 Write unit tests for fixture loading and providers
    - File: `eval/fixture.test.ts`. Schema failure reports file, field path, value and expected shape; unlabelled candidate; unknown label; `isBehavior` on a `cli` candidate rejected; missing or empty directory; ascending read order; no Jev question asked on any failure.
    - _Requirements: 12.1, 12.3 to 12.7, 16.7_

  - [x] 8.11 Write tests for the Eval_Runner
    - File: `eval/run.test.ts`. With `FakeJevGateway`: rows, aggregate rows, disagreement list, `null` agreement for an empty row, invalid fixture asks no question. Over the real `fixtures/eval/` with `node:child_process` spied: the spy is never called and the stub exec records no call. A GitHub stand-in returning a `headSha` makes `runEval` return `StageError('context', cause)` and ask no Jev question.
    - _Requirements: 12.9 to 12.11, 13.1 to 13.9, 16.7, 16.12_

  - [x] 8.12 Write tests for `runEvalCommand`
    - File: `eval/command.test.ts`. Temp `cwd`, injected `deps`, `createGateway` returning the Fake_Gateway. Check printed rows, `eval.json`, `jev-calls.jsonl`, exit 0 on completion, exit 1 for a missing credential with `createGateway` not called, exit 1 for an invalid config file, exit 1 for each malformed-flag case, and that no output contains the fake key.
    - _Requirements: 14.1 to 14.14, 16.9_

- [x] 9. Labelled fixtures (`fixtures/eval/`)
  - [x] 9.1 Author 15 to 20 fixtures
    - Create `fixtures/eval/<id>.json`, one Change per file, `id` equal to file name, labels set by reading the Change, not by running Jev. Public or synthetic content only, no secrets.
    - Coverage: at least 3 with `required: false` because Checks are adequate; at least 3 with `required: true` and surface `browser_ui`; at least 2 with `required: true` and a surface other than `browser_ui` and `non_runtime`; at least 1 `not_identified`; at least 1 with a `claims` entry (the `cli` candidate has no `isBehavior`); every one of the six Surface values appears in some label; at least 2 near-miss fixtures (tooling or docs change with behaviour-sounding title; user-facing file change whose Checks already cover it).
    - At most 12 candidates per fixture and no Comment_Line in patches unless it is the fixture's purpose. Validate with `loadFixtures` while authoring.
    - _Requirements: 11.1 to 11.11, 12.4, 12.5_

  - [x] 9.2 Write tests over the real fixture corpus
    - File: `eval/fixtures.corpus.test.ts`. Check count between 15 and 20, `id` equals file name, coverage rules of 11.6, 11.7 and 11.10, at most 12 candidates each, no `isBehavior` for `cli` candidates, no secret-looking strings, and that `loadFixtures` succeeds.
    - _Requirements: 11.1 to 11.11, 12.1, 12.4, 12.5, 16.8, 16.17_

- [x] 10. CLI wiring
  - [x] 10.1 Update `cli.ts`: `.env` loading and `eval` command
    - `help`, `--help`, `-h`, `--version`, `-v` are handled before anything loads `.env`. For `run` and `eval`: if `.env` exists in `cwd`, call `process.loadEnvFile` once (existing variables, including empty ones, are not overwritten). Missing file is silent. Unreadable file (`EACCES`, `EISDIR`) prints file name and error code only, never content, and exits 1 before the command runs. Never print values loaded from `.env`.
    - Add the `eval` case calling `runEvalCommand(rest, { env: process.env, cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr, createGateway: createJevGateway, now: () => new Date() })` and exit with its code. List `eval` in `--help` output.
    - _Requirements: 14.10, 14.13, 14.15 to 14.19_

  - [x] 10.2 Write child-process tests for `cli.ts`
    - File: `cli.env.test.ts`. Temp `cwd`, no `OPENROUTER_API_KEY` in the child env. Cases: `.env` with a fake key and `ce eval --fixtures <missing dir>` reports the missing fixture directory, not a missing credential, with no network call and no part of the key printed; no `.env` names `OPENROUTER_API_KEY`; a key already in the env is not replaced, including an empty string; `ce --help` does not load `.env`; `.env` as a directory exits 1, names `.env` and `EISDIR`, prints no content, and the command does not run.
    - _Requirements: 14.15 to 14.19, 16.11_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise. Run `npm run typecheck` and `npm test` with no API key in the environment.

- [ ] 12. Live run, journal record and pull request (MANUAL, not part of CI)
  - [ ] 12.1 MANUAL: Run `ce eval` against live Jev
    - Requires a real `OPENROUTER_API_KEY` in the environment or the gitignored `.env`. Run `npm run build`, then `node packages/ce/dist/cli.js eval` (or the repo's bin) with provider `openrouter`. Keep the generated `eval.json`.
    - If the key is unavailable, stop and record the blocked status in 12.2. Do not invent numbers.
    - If the run raises an error, record class and stage, fix the cause if it lies in this feature, and repeat. If a question or threshold must change, ask the maintainer first (Decision D2), update `catalog.snapshot.json` via `npm run update:catalog-snapshot` only after agreement, then repeat the run.
    - _Requirements: 15.1, 15.5, 15.6, 15.7_

  - [x] 12.2 MANUAL: Create `docs/journal/v0.0/eval-agreement.md`
    - New file only; do not edit any existing file under `docs/journal/v0.0/`. Content copied from the Live_Run `eval.json`: UTC date, git commit, provider, returned model ids, fixture count, effective thresholds, band and policy, the row table, the disagreement list, and the reproducing command.
    - State which values are measurements, that these are one measurement of one model on 15 to 20 fixtures and not a general accuracy claim, and link to issue #7 and `fixtures/eval/`. No API key, Authorization header, request state text or private repository text.
    - If blocked, write `not tested (blocked: OPENROUTER_API_KEY not set)` and treat the "Done when" line as not met.
    - _Requirements: 15.2 to 15.5, 15.8 to 15.10_

  - [x] 12.3 MANUAL: Verify the Issue_Checklist and "Done when"
    - Walk the traceability table of Requirement 17 for issue #7 (claims and threshold, three assessment questions, decision combination with band, policy and `decidedBy`, fixtures with `ce eval`, live run recorded). Record evidence per item: test name, file path or command output.
    - Fix any failure before continuing.
    - _Requirements: 17.1 to 17.3, 17.8_

  - [ ] 12.4 MANUAL: Open the pull request
    - Only when every implementation task is complete and 12.3 passed. Open a PR against `main` of rfxlamia/ce, body containing `Closes #7`, the checklist with evidence, and a link to `docs/journal/v0.0/eval-agreement.md`. No secrets in the body.
    - If 12.2 recorded the blocked status, state in the body that "Done when" is not met and do not open the PR as complete.
    - Do not merge the PR and do not close issue #7 by hand.
    - _Requirements: 17.4 to 17.7, 17.9 to 17.11_

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP. Requirement 16 asks for them, so skip only with the maintainer's agreement.
- `assessment/answers.ts` (task 1.4) is a small helper the design implies but does not name. It exists so the Assessor, Claim_Identifier and Eval_Runner read answers identically.
- Group 12 is a manual procedure, an exception to the coding-tasks-only rule, requested explicitly for this issue. It needs a live `OPENROUTER_API_KEY`, and CI never runs it.
- Each property test references the property number from `design.md` and the requirement clauses it checks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.2", "3.3", "3.4", "3.5", "3.6", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "5.1"] },
    { "id": 4, "tasks": ["5.2"] },
    { "id": 5, "tasks": ["5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "7.1"] },
    { "id": 6, "tasks": ["6"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 8, "tasks": ["8.5", "8.8", "8.9", "8.10", "9.1"] },
    { "id": 9, "tasks": ["8.6", "8.11", "9.2"] },
    { "id": 10, "tasks": ["8.7", "8.12", "10.1"] },
    { "id": 11, "tasks": ["10.2"] },
    { "id": 12, "tasks": ["11"] },
    { "id": 13, "tasks": ["12.1"] },
    { "id": 14, "tasks": ["12.2"] },
    { "id": 15, "tasks": ["12.3"] },
    { "id": 16, "tasks": ["12.4"] }
  ]
}
```
