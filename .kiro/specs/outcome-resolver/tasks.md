# Implementation Plan: Outcome resolver

## Overview

Implements [`requirements.md`](./requirements.md) and [`design.md`](./design.md) of this spec (issue #8, "[M1] Outcome resolver + property tests"). `SPEC.md` is normative and wins on any conflict. All code is TypeScript under `packages/ce/src/outcome/`, plus one change to `packages/ce/src/index.ts`. Tests use vitest and fast-check and need no API key, no network and no browser.

Order of work: data types first, then the Evidence_Checker, then the shared test arbitraries, then the resolver, then the exit-code mapper, then the public API and the architecture test, then verification and the pull request. Every module is exported or covered by a test before the next one starts, so no code is left unreferenced.

Out of scope (Decision D9): wiring `run()`, calling `process.exit`, writing `run.json` or `report.html`, the runtime loop, and any change to the Combiner, the question catalog, `catalog.snapshot.json` or the `Assessment` type.

## Tasks

- [x] 1. Define the outcome data types
  - [x] 1.1 Create `packages/ce/src/outcome/types.ts`
    - Export `OUTCOMES` (readonly tuple of the four literals), `Outcome` derived from it, `FinalState`, `V0_SUPPORTED_SURFACES` (`['browser_ui'] as const satisfies readonly Surface[]`), `ResolveReason`, `RuntimeResult`, `ResolveInput` and `Resolution`
    - Import `Surface` and `Assessment` from `../assessment/index.js`, and `Stage` and `StageError` from `../errors.js`, with `import type` only
    - Import `EvidenceSummary` from `./evidence.js` with `import type` only (the file is created in task 1.2; the type import resolves once it exists)
    - `types.ts` is the only non-`resolve.ts` file that may hold the four Outcome literals, and only inside `OUTCOMES`
    - _Requirements: 1.6, 1.8, 1.9, 5.2, 11.3_

  - [x] 1.2 Create `packages/ce/src/outcome/evidence.ts` with the `EvidenceSummary` type and `satisfiesMinimumEvidence`
    - Define `EvidenceSummary` with the five items of SPEC 7.2: `change`, `claim` (discriminated union of `identified` and `not_identified`), `subject`, `actions`, `observations`, `artifacts`
    - Import `Provenance` from `../context/types.js` with `import type` only
    - Implement the pure, total predicate as in the design: change identified by a non-empty title, description, base or head, or a non-empty file list; claim valid for its status; non-empty subject URL; `actions` is an array; at least one observation and every screenshot path non-empty; non-empty run directory and report path
    - Use a `nonEmpty` helper that trims whitespace, so an identified claim with whitespace-only text fails
    - No import of `node:fs`, `playwright`, `jev/` or `runtime/`; no `process.env`, `Date`, `Math.random` or `performance`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_

- [x] 2. Create the shared test arbitraries
  - [x] 2.1 Create `packages/ce/src/outcome/arbitraries.ts` (test-only, imported from test files)
    - Export `arbStageError`, `arbSurface`, `arbAssessment` (`Pick<Assessment, 'required' | 'surface'>`), `arbPassingSummary`, `arbFailingSummary`, `arbEvidenceSummary` (weighted `fc.oneof` so both passing and failing summaries occur), `arbRuntimeResult`, `arbSupportedSurfaces` (including the explicit empty list and the list of all six Surfaces as corpus entries) and `arbResolveInput`
    - Weight `arbResolveInput` over the seven branches of the precedence flowchart so that `EVIDENCED` appears in at least 15 percent of samples and each of the other three Outcomes in at least 10 percent
    - Cover each `Stage`, zero, one and many observations, and both `finalState` values
    - No import of `jev/fake.ts`, `playwright` or `@typesafe-ai/sdk`
    - _Requirements: 6.1, 8.6, 10.3_

- [x] 3. Test the Evidence_Checker
  - [x] 3.1 Write unit tests in `packages/ce/src/outcome/evidence.test.ts`
    - A minimal passing summary, a `not_identified` summary, an identified claim with whitespace-only text, an empty summary
    - _Requirements: 7.3, 7.4, 7.5_

  - [x] 3.2 Write property test for the six-condition specification in `evidence.property.test.ts`
    - **Property 15: `satisfiesMinimumEvidence` matches the six-condition specification exactly**
    - The test computes the six conditions independently from the generated summary; `numRuns` of at least 200
    - **Validates: Requirements 7.3, 7.4, 7.5**

  - [x] 3.3 Write property test for totality in `evidence.property.test.ts`
    - **Property 16: `satisfiesMinimumEvidence` is total**
    - **Validates: Requirements 7.6**

  - [x] 3.4 Write property test for necessity of each item in `evidence.property.test.ts`
    - **Property 17: Every one of the five Evidence_Summary items is necessary**
    - Also asserts that replacing the claim of a passing summary with `not_identified` still passes
    - **Validates: Requirements 8.4**

  - [x] 3.5 Write property test for no fabricated claim in `evidence.property.test.ts`
    - **Property 18: No fabricated claim**
    - **Validates: Requirements 7.4, 7.5, 8.5**

- [x] 4. Implement the Outcome_Resolver
  - [x] 4.1 Create `packages/ce/src/outcome/resolve.ts`
    - Implement `resolveOutcome(input: ResolveInput): Resolution` as the seven ordered early returns of Decision D3: `stage-error`, `assessment-missing`, `not-required`, `surface-unsupported`, `no-observation`, `evidence-incomplete`, `evidence-collected`
    - Read `input.supportedSurfaces ?? V0_SUPPORTED_SURFACES` once; read only `error.stage`, `assessment.required`, `assessment.surface` and `runtime`; never read the cause, message or stack of the Stage_Error and never any probability
    - Return a fresh `Resolution` literal on every branch; set `finalState` only for `EVIDENCED`, `errorStage` only for `stage-error`, and `surface` whenever an assessment is present
    - Call `satisfiesMinimumEvidence(runtime.evidence)` before returning `EVIDENCED`; no throw, no mutation of the input
    - This file is the only non-test file that assigns or returns an Outcome literal
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.5, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.7_

  - [x] 4.2 Write unit tests in `packages/ce/src/outcome/resolve.test.ts`
    - One example per `ResolveReason`, and the `Resolution` shape for each Outcome
    - The case of issue #31: `required = true` with Dominant_Surface `backend_internal` resolves to `UNSUPPORTED` with reason `surface-unsupported`; the test name states that this is `UNSUPPORTED` and not `SKIPPED` and not a browser run
    - `required = true` with each of `http_api`, `cli`, `backend_internal`, `native_app` and `non_runtime` resolves to `UNSUPPORTED` by default; a custom `supportedSurfaces` that contains the surface makes it supported
    - An error together with `required = false` resolves to `ERROR`; the serialized `Resolution` does not contain the cause message
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.1, 4.2, 4.6, 4.7, 5.1, 5.4, 5.5, 12.1_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Write the property and invariant tests for the resolver
  - [x] 6.1 Write the "exactly one Outcome" invariant in `resolve.outcome-membership.property.test.ts`
    - **Property 1: Resolution is always exactly one Outcome**
    - `numRuns` of at least 1000, set explicitly; exactly one of the four `outcome === ...` predicates is true; a counter filled inside the property is asserted after `fc.assert` to hold all four Outcomes
    - **Validates: Requirements 1.2, 1.3, 6.2, 6.3**

  - [x] 6.2 Write property test for determinism and non-mutation in `resolve.outcome-membership.property.test.ts`
    - **Property 2: Determinism and non-mutation**
    - **Validates: Requirements 1.4, 6.10**

  - [x] 6.3 Write property test for ERROR precedence in `resolve.error-precedence.property.test.ts`
    - **Property 3: A Stage_Error always wins (ERROR precedence)**
    - **Validates: Requirements 2.1, 2.3, 2.5**

  - [x] 6.4 Write property test for missing assessment in `resolve.error-precedence.property.test.ts`
    - **Property 4: Missing assessment resolves to ERROR**
    - **Validates: Requirements 2.2**

  - [x] 6.5 Write property test for toggling the Stage_Error in `resolve.error-precedence.property.test.ts`
    - **Property 14: Adding or removing the Stage_Error is the only thing that toggles `stage-error`**
    - **Validates: Requirements 6.7**

  - [x] 6.6 Write property test for SKIPPED in `resolve.skipped.property.test.ts`
    - **Property 5: SKIPPED when not required**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 6.7 Write the "UNSUPPORTED implies required and not supported" invariant in `resolve.unsupported.property.test.ts`
    - **Property 6: UNSUPPORTED iff required and the surface is outside the effective catalog**
    - `numRuns` of at least 1000, set explicitly; includes the default list, the empty list and the list of all six Surfaces
    - **Validates: Requirements 1.9, 4.1, 4.3, 4.5, 4.7, 6.5**

  - [x] 6.8 Write property test for field independence in `resolve.field-independence.property.test.ts`
    - **Property 7: Outcome ignores fields other than `error.stage`, `assessment.required` and `assessment.surface`**
    - **Validates: Requirements 4.3, 6.8**

  - [x] 6.9 Write property test for `runtime` independence in `resolve.field-independence.property.test.ts`
    - **Property 8: `runtime` is irrelevant once the Outcome is SKIPPED or UNSUPPORTED**
    - **Validates: Requirements 4.4, 6.11**

  - [x] 6.10 Write the "EVIDENCED implies the SPEC 7.2 check" invariant in `resolve.evidenced.property.test.ts`
    - **Property 9: EVIDENCED iff required, supported, and the evidence passes the check**
    - `numRuns` of at least 1000, set explicitly; asserts both directions and that `finalState` is copied from the Runtime_Result
    - **Validates: Requirements 5.1, 5.2, 8.1, 8.2**

  - [x] 6.11 Write property test for empty observations in `resolve.evidenced.property.test.ts`
    - **Property 10: Empty observations always give `no-observation`, even over an otherwise-incomplete summary**
    - **Validates: Requirements 5.4, 8.3**

  - [x] 6.12 Write property test for incomplete evidence in `resolve.evidenced.property.test.ts`
    - **Property 11: A non-empty but incomplete Evidence_Summary gives `evidence-incomplete`**
    - **Validates: Requirements 5.5, 8.3**

  - [x] 6.13 Write the "SKIPPED implies not required" invariant and the converse properties in `resolve.presence-iff.property.test.ts`
    - **Property 13: SKIPPED and UNSUPPORTED are exact converses and never overlap**
    - `numRuns` of at least 1000, set explicitly; asserts `SKIPPED` iff `required === false`, and `UNSUPPORTED` iff `required === true` and the surface is unsupported, when no `error` is present
    - **Validates: Requirements 6.4, 6.5, 6.6**

  - [x] 6.14 Write property test for `finalState` and `errorStage` presence in `resolve.presence-iff.property.test.ts`
    - **Property 12: `finalState` and `errorStage` presence are exact iff-conditions**
    - **Validates: Requirements 2.4, 3.2, 5.3, 6.9**

- [x] 7. Implement the Exit_Code_Mapper
  - [x] 7.1 Create `packages/ce/src/outcome/exit-code.ts`
    - Export `FailOnEntry` and `exitCodeFor(resolution, failOn): 0 | 1 | 2 | 3` as in the design: default `['error']` when `failOn` is `undefined`, a `Set` so order and duplicates do not matter, `1` for `ERROR`, `2` for `UNSUPPORTED`, `3` for `EVIDENCED` with `finalState: not_reached`, each only when listed, otherwise `0`
    - Read only `resolution.outcome`, `resolution.finalState` and `failOn`; no `process.exit`, no printing, no environment access; no validation of `output.fail-on`; `reportConfigFailure` is not changed
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.12_

  - [x] 7.2 Write unit tests in `packages/ce/src/outcome/exit-code.test.ts`
    - The three non-zero codes are distinct from each other and from `0`
    - `ERROR` gives `1` for the default list and `0` for `[]`
    - _Requirements: 9.2, 9.7, 9.11_

  - [x] 7.3 Write property test for the default list in `exit-code.property.test.ts`
    - **Property 19: Exit code with no `failOn` equals exit code with the default list**
    - **Validates: Requirements 9.2**

  - [x] 7.4 Write the exit-code table property in `exit-code.property.test.ts`
    - **Property 20: Exit code matches the outcome/fail-on table exactly**
    - Over every Outcome and every subset of the three Fail_On entries; `numRuns` of at least 200; `SKIPPED` and `EVIDENCED` with `reached` always give `0`
    - **Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.10**

  - [x] 7.5 Write property test for order and duplicates in `exit-code.property.test.ts`
    - **Property 21: Exit code ignores order and duplicates**
    - **Validates: Requirements 9.8**

- [x] 8. Wire the public API and enforce the architecture rules
  - [x] 8.1 Create `packages/ce/src/outcome/index.ts`
    - Export `resolveOutcome`, `OUTCOMES`, `V0_SUPPORTED_SURFACES`, `satisfiesMinimumEvidence`, `exitCodeFor` and the types `Outcome`, `FinalState`, `ResolveInput`, `RuntimeResult`, `ResolveReason`, `Resolution`, `EvidenceSummary` and `FailOnEntry`
    - _Requirements: 1.10, 11.1_

  - [x] 8.2 Update `packages/ce/src/index.ts`
    - Delete the inline `ExecutionOutcome` union and re-export `Outcome` as both `Outcome` and `ExecutionOutcome` from `./outcome/index.js` (Decision D1)
    - Re-export `resolveOutcome`, `exitCodeFor`, `OUTCOMES` and the types `Resolution` and `ResolveInput`
    - Leave the stub `run()` and `RunResult` untouched (Decision D9); `npm run typecheck` must keep every existing use of `ExecutionOutcome` compiling
    - _Requirements: 1.6, 11.2, 11.4_

  - [x] 8.3 Write `packages/ce/src/outcome/architecture.test.ts` in the style of `assessment/architecture.test.ts`
    - Strip comments, exclude `*.test.ts` and the test-only `arbitraries.ts`
    - Within `outcome/`: no import of `node:fs`, `node:child_process`, `node:http`, `node:https`, `playwright`, `@typesafe-ai/sdk`, `jev/` or `runtime/`; no `process.env`, `Date`, `Math.random` or `performance`; every import from `assessment/` or `errors.ts` is `import type`
    - Across `src/`: no non-test file other than `outcome/resolve.ts` assigns, returns or casts to an Outcome literal; `outcome/types.ts` is allowed to hold the literals in `OUTCOMES`
    - A synthetic source snippet that compares `resolution.outcome === 'EVIDENCED'` is not reported
    - _Requirements: 1.5, 1.6, 1.7, 10.3, 10.4, 11.3_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Verify issue #8 and open the pull request
  - [x] 10.1 Verify the Issue_Checklist and the "Done when" line, and prepare the pull request body
    - Run `npm run typecheck` and `npm test` from the repository root; both must pass (a failure is fixed before continuing)
    - Confirm that the four Invariant_Tests set `numRuns` of at least 1000 and passed: Property 1 (exactly one Outcome), Property 13 (`SKIPPED ⇒ ¬required`, with Property 6 for the converse), Property 6 (`UNSUPPORTED ⇒ required ∧ ¬supported`) and Property 9 (`EVIDENCED ⇒` SPEC 7.2 check)
    - Write the pull request body to a file in the repository's pull-request checklist location (`.ce/pr-checklist.md` is the existing one): list each item of the Issue_Checklist (the traceability table of Requirement 13 criterion 1) with its recorded evidence (test name, file path or command output)
    - The body contains `Closes #8` and `Refs #31`, and contains none of `Closes #31`, `Fixes #31` or `Resolves #31`
    - The body states for issue #31: the resolver resolves `required = true` with surface `backend_internal` to `UNSUPPORTED` (the browser is not started); the resolver does not read `runtime_observable`; the remaining question is whether such a claim should be `required = true`, the choice between options A and B of issue #31, which this pull request does not decide
    - The body contains no API key or other secret value; the Combiner, the question catalog, `catalog.snapshot.json` and the `Assessment` type are not changed
    - _Requirements: 10.1, 10.2, 10.6, 12.2, 12.3, 12.4, 13.1, 13.2, 13.3, 13.5, 13.6, 13.8, 13.9_

  - [x] 10.2 Open the pull request against `main` of rfxlamia/ce
    - Hard gate: do this only when every implementation task above is complete and the checks of task 10.1 pass; otherwise do not open the pull request
    - Use the body prepared in task 10.1 (for example `gh pr create --base main --body-file <file>`)
    - Do not merge the pull request and do not close issue #8 by hand
    - _Requirements: 13.4, 13.5, 13.7, 13.10_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. The sub-tasks that carry the issue's "Done when" invariants (6.1, 6.7, 6.10, 6.13), the issue #31 example (4.2), the exit-code table and distinct-codes tests (7.2, 7.4) and the architecture test (8.3) are not marked optional, because the requirements state them as SHALL.
- Each task references specific requirements for traceability, and each property test names its property in `design.md`.
- The four Invariant_Tests set `numRuns` of at least 1000 explicitly; the other properties use at least 200.
- Property tests of the same file are placed in different waves so that no two tasks write the same file at the same time.
- The checkpoints (5 and 9) ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "4.1", "7.1"] },
    { "id": 3, "tasks": ["3.1", "3.2", "4.2"] },
    { "id": 4, "tasks": ["3.3"] },
    { "id": 5, "tasks": ["3.4"] },
    { "id": 6, "tasks": ["3.5"] },
    { "id": 7, "tasks": ["5"] },
    { "id": 8, "tasks": ["6.1", "6.3", "6.6", "6.7", "6.8", "6.10", "6.13", "7.2", "7.3", "8.1"] },
    { "id": 9, "tasks": ["6.2", "6.4", "6.9", "6.11", "6.14", "7.4", "8.2", "8.3"] },
    { "id": 10, "tasks": ["6.5", "6.12", "7.5"] },
    { "id": 11, "tasks": ["9"] },
    { "id": 12, "tasks": ["10.1"] },
    { "id": 13, "tasks": ["10.2"] }
  ]
}
```
