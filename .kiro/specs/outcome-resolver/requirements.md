# Requirements Document

## Introduction

This feature implements the Outcome resolver of Continuous Evidence (CE) and its property tests: GitHub issue #8 in rfxlamia/ce, "[M1] Outcome resolver + property tests" (label `core`, milestone M1 "Otak: konteks & assessment"). It implements R8 of `docs/journal/v0.0/requirements.md` and the outcome table and exit-code rule of section 6 of `docs/journal/v0.0/design.md`. `SPEC.md` is normative and wins on any conflict. SPEC section 7.1 requires that every run resolves to exactly one outcome and that `SKIPPED` and `UNSUPPORTED` are never treated as the same condition. SPEC section 7.2 defines the minimum content of evidence. SPEC section 4.4 requires CE to distinguish "evidence is not needed" from "evidence is needed but no capability is available".

The Outcome resolver is the only place where an Outcome is decided (steering rule "Design rule" and "Placement rules"). It is a pure function. It consumes the result of the earlier stages (an error, the `Assessment`, and the result of the runtime loop) and returns one Outcome, the reason for it and, for `EVIDENCED`, the `finalState`. A second pure function maps the Outcome and the configured `output.fail-on` list to a process exit code. Neither function calls Jev, reads the environment, the clock or the file system, or starts a browser.

The issue has three checklist items and a "Done when" line. All of them are in scope:

1. A pure `packages/ce/src/outcome/resolve.ts` that follows the table in design section 6, including `EVIDENCED` with `finalState: reached | not_reached` (Requirements 1, 2, 3, 4 and 5).
2. fast-check invariants: exactly one Outcome; `SKIPPED ⇒ ¬required`; `UNSUPPORTED ⇒ required ∧ ¬supported`; `EVIDENCED ⇒` the bundle passes the SPEC section 7.2 check (Requirements 6, 7 and 8).
3. Exit codes and `output.fail-on` (Requirement 9).
4. "Done when": each invariant passes with at least 1000 runs (Requirement 10).

The owner comment on the issue asks how the resolver treats a surface such as `backend_internal` when `runtime_observable` is high (fixture `backend-cache-ttl`, `ce eval` run 2, issue #31). Requirement 4 answers this and Requirement 12 records the answer.

Requirement 13 maps every item of the issue to the requirements that cover it.

Code lives in `packages/ce/src/outcome/` (`types.ts`, `resolve.ts`, `evidence.ts`, `exit-code.ts`, `index.ts`) plus one change to `packages/ce/src/index.ts` (the existing `ExecutionOutcome` type is re-exported from the new module). Tests use vitest and fast-check and need no API key, no network and no browser.

### Facts verified in the code

The following statements were checked by reading the current source and the design before this document was written.

- F1. `packages/ce/src/outcome/` does not exist. `packages/ce/src/index.ts` defines `ExecutionOutcome` (`'SKIPPED' | 'EVIDENCED' | 'UNSUPPORTED' | 'ERROR'`) and a stub `run()` that throws "not implemented". No other source file decides an Outcome.
- F2. `assessment/combine.ts` returns `required` and a dominant `surface` and does not compare the surface with a capability catalog. The claims-assessment-eval spec, Decision D6, assigns that comparison and the mapping of `required` to `SKIPPED` or `UNSUPPORTED` to this issue.
- F3. `Assessment` (in `assessment/types.ts`) has `required: boolean`, `surface: Surface` (the dominant surface of Decision D7 of that spec), `decidedBy`, `perClaim` and `claimStatus`. `Surface` is `browser_ui | http_api | cli | backend_internal | native_app | non_runtime`.
- F4. `StageError` (in `errors.ts`) carries `stage: 'context' | 'assessment' | 'runtime' | 'evidence'`. Its message never repeats the message of the cause.
- F5. The config schema has `output.fail-on`, an optional array whose values are `error`, `unsupported` and `evidenced-not-reached`. `ConfigDefaults` sets it to `['error']`.
- F6. `output.fail-on` is read nowhere in the code yet. Config failures already end with exit code 1 through `reportConfigFailure` before any pipeline stage runs; they never reach the resolver.
- F7. The evidence bundle writer (`evidence/bundle.ts`) and the runtime loop (`runtime/`) do not exist. They belong to later issues. The resolver therefore cannot take a `run.json` as input and takes the plain data that those stages will hold.
- F8. Design section 6 states the table: an uncaught error gives `ERROR`; `required = false` gives `SKIPPED`; required with a surface not in the capability catalog gives `UNSUPPORTED`; required and supported with at least one observation gives `EVIDENCED` with `finalState`; required and supported with an unreachable target or no observation gives `ERROR`. The v0 capability catalog is `{ browser_ui }` (design section 4).
- F9. Issue #31 (open) describes a case where Jev picks `backend_internal` and gives `runtime_observable` 0.73, so the Combiner sets `needed = true` and `required = true`. Issue #31 itself says part of the impact may already be handled here, because an unsupported surface ends in `UNSUPPORTED`.

### Data model

```ts
const OUTCOMES = ['SKIPPED', 'EVIDENCED', 'UNSUPPORTED', 'ERROR'] as const;  // outcome/types.ts, single definition (Requirement 1)
type Outcome = (typeof OUTCOMES)[number];
type FinalState = 'reached' | 'not_reached';

interface ResolveInput {
  /** An error raised by any stage, already wrapped as StageError by the caller (Decision D10). When present, the outcome is ERROR. */
  error?: StageError;
  /** Absent when the assessment stage did not complete without an error. */
  assessment?: Pick<Assessment, 'required' | 'surface'>;
  /** Absent when the runtime stage did not run or produced no result. */
  runtime?: RuntimeResult;
  /** Surfaces the capability catalog supports. Default: V0_SUPPORTED_SURFACES = ['browser_ui']. */
  supportedSurfaces?: readonly Surface[];
}

interface RuntimeResult {
  finalState: FinalState;
  evidence: EvidenceSummary;        // the SPEC 7.2 content, see Requirement 7; evidence.observations is the only source of the observation count
}

type ResolveReason =
  | 'stage-error'                   // error present
  | 'assessment-missing'            // no error and no assessment
  | 'not-required'                  // SKIPPED
  | 'surface-unsupported'           // UNSUPPORTED
  | 'evidence-collected'            // EVIDENCED
  | 'no-observation'                // required, supported, no runtime result or zero observations
  | 'evidence-incomplete';          // runtime result fails the SPEC 7.2 check

interface Resolution {
  outcome: Outcome;
  reason: ResolveReason;
  finalState?: FinalState;          // present exactly when outcome is EVIDENCED
  errorStage?: Stage;               // present exactly when reason is 'stage-error'
  surface?: Surface;                // the surface the decision used, when an assessment was present
}
```

### Decisions

- D1. One definition of `Outcome`. The type `ExecutionOutcome` in `index.ts` is moved to `outcome/types.ts` as `Outcome`, derived from the constant `OUTCOMES` of the same file, and re-exported from `index.ts` under both names, so the public name `ExecutionOutcome` does not change and no second definition exists. Other modules (for example `evidence/summary.ts` and the `report.html` template of issue #11) read and compare an Outcome freely and take the four values from `OUTCOMES`; only the act of deciding an Outcome is restricted to `outcome/resolve.ts` (Requirement 1 criterion 7).
- D2. Total function. The resolver returns a `Resolution` for every possible `ResolveInput`, including inputs that earlier stages should not produce (no error and no assessment, or `required` with a missing runtime result). An input that cannot be mapped to `SKIPPED`, `UNSUPPORTED` or `EVIDENCED` resolves to `ERROR` with a reason. It never throws and never returns `undefined`. This is how "exactly one Outcome" (SPEC 7.1, R8.1) holds for all inputs.
- D3. Precedence. The rules are evaluated in this order and the first that applies decides: (1) `error` present gives `ERROR`; (2) `assessment` absent gives `ERROR`; (3) `required = false` gives `SKIPPED`; (4) `surface` not supported gives `UNSUPPORTED`; (5) runtime result absent, or `runtime.evidence.observations` empty, gives `ERROR` with the reason `no-observation`; (6) runtime evidence that fails the SPEC 7.2 check gives `ERROR` with the reason `evidence-incomplete`; (7) otherwise `EVIDENCED`. The number of observations is always the length of `runtime.evidence.observations`, and an empty list always gives `no-observation`, also when other parts of the Evidence_Summary are incomplete, because rule 5 is evaluated before rule 6 and because SPEC 7.2 itself requires at least one observation. An error always wins over a later `SKIPPED` or `UNSUPPORTED` because a stage failure means CE did not complete, and `ERROR` means "the CE process failed to complete" (SPEC 7.1). A browser crash after some observations (design section 10) is a stage error and therefore `ERROR`, with the artifacts that exist still available to the bundle writer. A 400 on the final image request (design section 10) is a recoverable `JevImageError`, not a Stage_Error: it never reaches `error` and never makes the Outcome `ERROR`; the run resolves from the text signals.
- D4. Treatment of surfaces that the catalog does not support (owner comment, issue #31, F9). The resolver decides `UNSUPPORTED` from `required` and the dominant `surface` only. It does not read `runtimeObservable`, `checksAdequate` or any other probability, and it does not change `required`. Consequences: (a) `required = true` with surface `backend_internal`, `native_app`, `http_api`, `cli` or `non_runtime` resolves to `UNSUPPORTED`, so the browser is never started for it; (b) the resolver never turns such a case into `SKIPPED`, because `SKIPPED` means that the Assessment found evidence unnecessary, and "no capability" is a different condition (SPEC 4.4, 5.5, 7.1); (c) whether a `backend_internal` claim with `runtime_observable` 0.73 should have `required = true` at all is a question about the Combiner and the question catalog (options A and B of issue #31), not about the resolver, and is out of scope here. Because the resolver reads only `required` and `surface`, any later change to the Combiner needs no change in the resolver.
- D5. `non_runtime` with `required = true`. The table in design section 6 maps every surface outside the catalog to `UNSUPPORTED`, and `non_runtime` is outside the catalog. The resolver follows the table and does not special-case it. Whether `required = true` and `non_runtime` can occur together is again a Combiner question (issue #31).
- D6. Evidence check without the bundle writer (F7). The SPEC 7.2 check is a pure predicate over `EvidenceSummary`, a plain object that holds exactly the five items of SPEC 7.2 (Requirement 7). The resolver calls the predicate on `runtime.evidence` before it returns `EVIDENCED`; when it fails, the resolver returns `ERROR` with the reason `evidence-incomplete`. This makes `EVIDENCED ⇒ SPEC 7.2 check` true by construction. The later bundle writer (issue #11) builds an `EvidenceSummary` from `run.json` and reuses the same predicate, so the check is defined once.
- D7. Exit code mapping (Requirement 9) is not an Outcome decision. It lives in `outcome/exit-code.ts`, receives a `Resolution`, and never changes it. It follows design section 6: `0` unless the outcome is listed in `output.fail-on`; `1` for `ERROR`, `2` for `UNSUPPORTED`, `3` for `EVIDENCED` with `finalState: not_reached`, each only when listed.
- D8. Dominant surface only. The resolver uses `assessment.surface`, the dominant surface of Decision D7 of the claims-assessment-eval spec. A Change with several Claims on different surfaces is resolved by that one surface. This is a limit of the v0 design and not a decision of this feature.
- D9. Out of scope: wiring `run()` end to end and calling `process.exit` (the resolver and the exit-code function only return values), writing `run.json` and `report.html` (issue #11), the runtime loop (`runtime/`), any change to the Combiner, the question catalog or `Assessment` (issue #31), and any new config key. The config key `output.fail-on` already exists and is not changed.

- D10. Wrapping of uncaught errors. Design section 6 says that any uncaught error gives `ERROR`, while `ResolveInput.error` is typed `StageError`. The contract is: the pipeline (`run()`, when it is wired under a later issue) catches every thrown value at the top level and, when it is not already a `StageError`, wraps it in a `StageError` that names the stage in progress before it calls the resolver (design section 10). The resolver therefore only sees `StageError`. The alternative, widening `error` to `unknown` so that the resolver accepts any thrown value, was not chosen: the resolver would then have to guess a stage for `errorStage`, and `errorStage` would no longer be present exactly when the reason is `stage-error` with a valid `Stage`. The wrapping itself is out of scope here (Decision D9) and is recorded in Requirement 2 criterion 6.

Assumptions (the issue and the journal leave these open):

- `output.fail-on` entries are matched by the Outcome they name: `error` names `ERROR`, `unsupported` names `UNSUPPORTED`, `evidenced-not-reached` names `EVIDENCED` with `finalState: not_reached`. An `ERROR` outcome that is not listed exits with `0`, as R8.4 states, even though this means the default list `['error']` is what makes CI fail on errors.
- The reason codes in `ResolveReason` are stable strings that the bundle writer may store as `outcomeReason`. Their human wording belongs to `evidence/summary.ts`.

## Glossary

- **Outcome_Resolver**: The module `packages/ce/src/outcome/resolve.ts` and its function `resolveOutcome`. The only place that decides an Outcome.
- **Exit_Code_Mapper**: `packages/ce/src/outcome/exit-code.ts` and its function `exitCodeFor`.
- **Evidence_Checker**: `packages/ce/src/outcome/evidence.ts` and its predicate `satisfiesMinimumEvidence`, the SPEC 7.2 check (Requirement 7).
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC 7.1).
- **Resolve_Input**: The `ResolveInput` object of the Data model.
- **Resolution**: The `Resolution` object that the Outcome_Resolver returns.
- **Resolve_Reason**: One of the `ResolveReason` codes.
- **Final_State**: `reached` or `not_reached`, the state of the claimed behaviour at the end of the runtime loop.
- **Runtime_Result**: The `RuntimeResult` object, the data the runtime stage hands over.
- **Evidence_Summary**: The `EvidenceSummary` object with the five items of SPEC 7.2 (Requirement 7).
- **Required**: `assessment.required`.
- **Dominant_Surface**: `assessment.surface`, chosen under Decision D7 of the claims-assessment-eval spec.
- **Capability_Catalog**: The set of surfaces the v0 runtime supports. `V0_SUPPORTED_SURFACES` is `['browser_ui']`.
- **Supported**: The Dominant_Surface is in the Capability_Catalog. Not supported is the complement.
- **Fail_On**: The `output.fail-on` list of the Effective_Config. Its values are `error`, `unsupported` and `evidenced-not-reached`.
- **Exit_Code**: The integer that `exitCodeFor` returns: `0`, `1`, `2` or `3`.
- **Observation**: One captured state of the Subject (a screenshot with the page state) in the Runtime_Result.
- **Stage_Error**: A `StageError` of `errors.ts`.
- **Surface**: One of `browser_ui`, `http_api`, `cli`, `backend_internal`, `native_app`, `non_runtime`.
- **Invariant_Test**: A fast-check property test of Requirement 6, 7 or 8, run with at least 1000 runs (Requirement 10).
- **Issue_Checklist**: The acceptance checklist of issue #8, reproduced in Requirement 13.
- **Effective_Config**: As defined in the ce-config-loader spec.
- **Assessment**, **Combiner**: As defined in the claims-assessment-eval spec.

## Requirements

### Requirement 1: Pure Outcome resolver module

**User Story:** As a maintainer, I want one pure function that decides the Outcome, so that no other file and no model answer can decide it. *(R8.1; steering "Design rule" and "Placement rules"; design section 6)*

#### Acceptance Criteria

1. THE Outcome_Resolver SHALL export the function `resolveOutcome(input: ResolveInput): Resolution` from `packages/ce/src/outcome/resolve.ts`.
2. THE Outcome_Resolver SHALL return a Resolution whose `outcome` is exactly one of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` and `ERROR`, for every Resolve_Input.
3. THE Outcome_Resolver SHALL NOT throw an exception for any Resolve_Input that satisfies the TypeScript type, including a Resolve_Input with no `error`, no `assessment` and no `runtime`.
4. THE Outcome_Resolver SHALL be a pure function: for equal Resolve_Inputs it SHALL return equal Resolutions, and it SHALL NOT modify its input.
5. THE modules in `packages/ce/src/outcome/` SHALL NOT import `node:fs`, `node:child_process`, `node:http`, `node:https`, `playwright`, `@typesafe-ai/sdk`, anything from `packages/ce/src/jev/`, or anything from `packages/ce/src/runtime/`, and SHALL NOT read `process.env`, `Date`, `Math.random` or `performance`. The architecture test SHALL check the global names on the source text after comments have been removed, as the existing `assessment/architecture.test.ts` does, so that a comment that mentions `Date` does not fail the test.
6. THE type `Outcome` SHALL be defined once, in `outcome/types.ts`, and `index.ts` SHALL re-export it as `ExecutionOutcome` and as `Outcome` (Decision D1). No other file SHALL define a union type of the four Outcome literals.
7. THE act of deciding an Outcome SHALL happen only in `outcome/resolve.ts`: no other non-test source file, inside or outside `packages/ce/src/outcome/`, SHALL assign an Outcome value (a property or variable initialised with an Outcome literal, a `return` of an Outcome literal, or a cast of a string to `Outcome`). Reading and comparing an Outcome (for example `resolution.outcome === 'EVIDENCED'` in `evidence/summary.ts` or in the `report.html` template of issue #11) SHALL be allowed everywhere. `outcome/types.ts` MAY hold the four literals in the declaration of `OUTCOMES`.
8. THE module `outcome/types.ts` SHALL export the constant `OUTCOMES`, a readonly tuple of the four Outcome literals, and `Outcome` SHALL be derived from it, so that other modules take the list of Outcomes from `OUTCOMES` and do not repeat the literals.
9. THE Outcome_Resolver SHALL accept the optional field `supportedSurfaces` and WHEN it is absent THE Outcome_Resolver SHALL use `V0_SUPPORTED_SURFACES`, which holds exactly `browser_ui`.
10. THE Outcome_Resolver SHALL export `V0_SUPPORTED_SURFACES`, `OUTCOMES` and `resolveOutcome` through `outcome/index.ts`.

### Requirement 2: Errors and incomplete stages resolve to ERROR

**User Story:** As a CI author, I want a failed run to say `ERROR` and name the stage, so that I never mistake a failure for a skip. *(R8.3; design sections 6 and 10; SPEC 7.1)*

#### Acceptance Criteria

1. WHEN the Resolve_Input has an `error`, THE Outcome_Resolver SHALL return the Outcome `ERROR`, the Resolve_Reason `stage-error` and `errorStage` equal to the `stage` of the Stage_Error, whatever the other fields of the Resolve_Input hold.
2. WHEN the Resolve_Input has no `error` and no `assessment`, THE Outcome_Resolver SHALL return the Outcome `ERROR` and the Resolve_Reason `assessment-missing`.
3. THE Outcome_Resolver SHALL NOT include the message, the stack or the `cause` of a Stage_Error in the Resolution.
4. WHEN the Outcome is `ERROR` and the Resolve_Reason is not `stage-error`, THE Outcome_Resolver SHALL leave `errorStage` absent.
5. WHEN the Resolve_Input has an `error` and the `assessment` states `required = false`, THE Outcome_Resolver SHALL return `ERROR`, not `SKIPPED` (Decision D3).
6. THE type of `ResolveInput.error` SHALL be `StageError`, and the caller of the Outcome_Resolver (the pipeline, `run()`) SHALL wrap every thrown value that is not a `StageError` in a `StageError` that names the stage in progress before it calls `resolveOutcome` (Decision D10). The Outcome_Resolver SHALL NOT accept an `unknown` error and SHALL NOT infer a stage. Wiring this into `run()` is out of scope (Decision D9).
7. THE Outcome_Resolver SHALL NOT resolve to `ERROR` because of a recoverable Jev image failure (a `JevImageError`, design section 10): such a failure is not a Stage_Error, so a Resolve_Input without `error` that comes from a run with that failure resolves by the other rules (Decision D3).

### Requirement 3: SKIPPED when evidence is not required

**User Story:** As a developer, I want CE to say plainly that it skipped because the Assessment found evidence unnecessary, so that a skip is never confused with an inability. *(R5.3, R8.2; SPEC 3.6, 7.1)*

#### Acceptance Criteria

1. WHEN the Resolve_Input has no `error` and the `assessment` states `required = false`, THE Outcome_Resolver SHALL return the Outcome `SKIPPED` and the Resolve_Reason `not-required`, whatever the Dominant_Surface and the `runtime` field hold.
2. WHEN the Outcome is `SKIPPED`, THE Outcome_Resolver SHALL leave `finalState` absent and SHALL set `surface` to the Dominant_Surface.
3. THE Outcome_Resolver SHALL NOT return `SKIPPED` when `required = true`, and SHALL NOT return `SKIPPED` because a surface is unsupported.

### Requirement 4: UNSUPPORTED when the surface is outside the Capability_Catalog

**User Story:** As a developer, I want CE to tell me when evidence is needed but v0 cannot produce it, so that I know the gap is a limit of CE and not a decision that all is well. *(R5.4, R8.2; SPEC 4.4, 5.5, 7.1; issue #31 and the owner comment on issue #8)*

#### Acceptance Criteria

1. WHEN the Resolve_Input has no `error`, the `assessment` states `required = true` and the Dominant_Surface is not in `supportedSurfaces`, THE Outcome_Resolver SHALL return the Outcome `UNSUPPORTED` and the Resolve_Reason `surface-unsupported`.
2. THE Outcome_Resolver SHALL return `UNSUPPORTED` for `required = true` with each of the Dominant_Surfaces `http_api`, `cli`, `backend_internal`, `native_app` and `non_runtime` when `supportedSurfaces` is absent (Decisions D4 and D5).
3. THE Outcome_Resolver SHALL decide between `UNSUPPORTED` and a supported path using only `required` and the Dominant_Surface. It SHALL NOT read `runtimeObservable`, `checksAdequate`, `surfaceConfidence`, `decidedBy` or any other probability, and SHALL NOT change the value of `required` (Decision D4).
4. WHEN the Outcome is `UNSUPPORTED`, THE Outcome_Resolver SHALL return the same Resolution whether the `runtime` field of the input is present with any value or absent. This is tested as a property (Requirement 6 criterion 11).
5. WHEN the Outcome is `UNSUPPORTED`, THE Outcome_Resolver SHALL set `surface` to the Dominant_Surface and leave `finalState` absent.
6. THE test suite SHALL include an example for the case of issue #31: an `assessment` with `required = true` and the Dominant_Surface `backend_internal`, built as the Combiner builds it for `runtimeObservable = 0.73` and `checksAdequate` below the default Adequate_Threshold, resolves to `UNSUPPORTED` with the Resolve_Reason `surface-unsupported`.
7. WHERE `supportedSurfaces` is given and contains the Dominant_Surface, THE Outcome_Resolver SHALL treat that surface as supported, so that a later capability (for example `http_api`) needs no change in the resolver.

### Requirement 5: EVIDENCED with finalState, and ERROR when no evidence exists

**User Story:** As a reviewer, I want `EVIDENCED` to mean that CE observed the Subject at runtime and to tell me whether the claimed state was reached. *(R7.4, R8.1; design section 6; SPEC 7.1)*

#### Acceptance Criteria

1. WHEN the Resolve_Input has no `error`, the `assessment` states `required = true`, the Dominant_Surface is supported, and the `runtime` result holds at least one Observation and an Evidence_Summary that passes the Evidence_Checker, THE Outcome_Resolver SHALL return the Outcome `EVIDENCED`, the Resolve_Reason `evidence-collected` and `finalState` equal to the `finalState` of the Runtime_Result.
2. THE `finalState` of an `EVIDENCED` Resolution SHALL be `reached` or `not_reached`, and SHALL be copied from the Runtime_Result without interpretation (R7.4: giving up or exhausting the budget with at least one Observation is `EVIDENCED` with `not_reached`).
3. WHEN the Outcome is not `EVIDENCED`, THE Outcome_Resolver SHALL leave `finalState` absent. WHEN the Outcome is `EVIDENCED`, THE Outcome_Resolver SHALL set `finalState`.
4. THE number of Observations SHALL be the length of `runtime.evidence.observations`. WHEN the Resolve_Input has no `error`, `required = true`, the Dominant_Surface is supported, and the `runtime` result is absent or `runtime.evidence.observations` is empty, THE Outcome_Resolver SHALL return the Outcome `ERROR` and the Resolve_Reason `no-observation` (target unreachable or nothing captured, R6.3, R7.4), also when other parts of the Evidence_Summary are incomplete. The Resolve_Reason `no-observation` takes precedence over `evidence-incomplete` (Decision D3), and SPEC 7.2 also requires at least one observation.
5. WHEN the Resolve_Input has no `error`, `required = true`, the Dominant_Surface is supported, `runtime.evidence.observations` holds at least one Observation and the Evidence_Summary fails the Evidence_Checker, THE Outcome_Resolver SHALL return the Outcome `ERROR` and the Resolve_Reason `evidence-incomplete` (Decision D6).
6. THE Outcome_Resolver SHALL NOT use a probability, a Jev answer or the content of a screenshot to choose between `reached` and `not_reached`.

### Requirement 6: Invariants for exactly one Outcome and for SKIPPED and UNSUPPORTED

**User Story:** As a maintainer, I want the outcome contract proven by property tests over all inputs, so that a later change to the pipeline cannot break SPEC 7.1. *(R8.1, R8.2, R12.2; SPEC 7.1; issue checklist item 2)*

#### Acceptance Criteria

1. THE test suite SHALL include a fast-check generator `arbResolveInput` that produces Resolve_Inputs covering: with and without `error` (each `Stage`); with and without `assessment`; `required` true and false; each of the six Surfaces; with and without `supportedSurfaces` (including the empty list and the list of all six surfaces); with and without `runtime`; `finalState` both values; zero, one and many Observations; Evidence_Summaries that pass and fail the Evidence_Checker. THE generator SHALL be weighted (`fc.oneof` with `weight` entries) so that the branch that needs six conditions at once, `EVIDENCED` (no `error`, `assessment` present, `required = true`, a supported surface, `runtime` present, at least one Observation and a passing Evidence_Summary), occurs in a large share of the generated inputs (at least 15 percent), and so that the other three Outcomes each occur in at least 10 percent.
2. THE Invariant_Test "exactly one Outcome" SHALL assert that, for every generated Resolve_Input, `resolveOutcome` returns without throwing and the `outcome` of the Resolution is a member of `OUTCOMES`. A single fast-check property cannot see across samples, so the test SHALL collect the Outcomes returned during the run in a counter that is filled inside the property, and SHALL assert after `fc.assert` has returned that the counter holds all four Outcomes (so the generator reaches every branch). The weights of criterion 1 make that assertion deterministic in practice over at least 1000 runs.
3. THE Invariant_Test "exactly one Outcome" SHALL also assert that exactly one of the four predicates `outcome === 'SKIPPED'`, `outcome === 'EVIDENCED'`, `outcome === 'UNSUPPORTED'` and `outcome === 'ERROR'` is true.
4. THE Invariant_Test "SKIPPED implies not required" SHALL assert that, for every generated Resolve_Input where the Outcome is `SKIPPED`, `assessment` is present and `assessment.required` is `false`.
5. THE Invariant_Test "UNSUPPORTED implies required and not supported" SHALL assert that, for every generated Resolve_Input where the Outcome is `UNSUPPORTED`, `assessment.required` is `true` and the Dominant_Surface is not in the effective `supportedSurfaces`.
6. THE test suite SHALL include the converse properties: WHEN no `error` is present, `assessment.required` is `false`, THEN the Outcome is `SKIPPED`; WHEN no `error` is present, `required` is `true` and the Dominant_Surface is not supported, THEN the Outcome is `UNSUPPORTED`. These two properties together state that `SKIPPED` and `UNSUPPORTED` never occur for the same input and are never swapped (SPEC 7.1, R8.2).
7. THE test suite SHALL include a property that, for the same `assessment` and `runtime`, adding an `error` always gives `ERROR`, and removing the `error` never gives `ERROR` with the Resolve_Reason `stage-error`.
8. THE test suite SHALL include a property that the Outcome does not depend on `assessment.perClaim`, `assessment.decidedBy`, `assessment.record` or `assessment.claimStatus`: two Assessments with equal `required` and `surface` and any other fields give equal Resolutions (Requirement 4 criterion 3).
9. THE test suite SHALL include a property that `finalState` is present if and only if the Outcome is `EVIDENCED`, and that `errorStage` is present if and only if the Resolve_Reason is `stage-error`.
10. THE test suite SHALL include a determinism property: calling `resolveOutcome` twice on the same input gives deeply equal Resolutions, and the input is deeply equal to a copy taken before the call.
11. THE test suite SHALL include a property for `runtime` independence: for every generated Resolve_Input whose Resolution has the Outcome `UNSUPPORTED` or `SKIPPED`, replacing `runtime` with any other generated Runtime_Result or removing it gives a deeply equal Resolution (Requirement 3 criterion 1, Requirement 4 criterion 4).

### Requirement 7: SPEC 7.2 minimum evidence check

**User Story:** As a reviewer, I want every `EVIDENCED` run to carry the change, the claim, the observed Subject, the actions, the observations and where to inspect them, so that evidence is inspectable and a claim is never fabricated. *(SPEC 7.2; R9.2; issue checklist item 2)*

#### Acceptance Criteria

1. THE Evidence_Checker SHALL export the type `EvidenceSummary` and the pure predicate `satisfiesMinimumEvidence(summary: EvidenceSummary): boolean` from `packages/ce/src/outcome/evidence.ts`.
2. THE `EvidenceSummary` SHALL hold the five items of SPEC 7.2 as plain JSON-serializable data: `change` (the change and the claim status), `claim`, `subject` (the observed runtime), `actions` (the verification actions performed, a list that MAY be empty), `observations` (a list of captured observations, each with the path of its screenshot) and `artifacts` (where the evidence can be inspected: the run directory and the report path).
3. THE predicate SHALL return `true` only when all of the following hold: (a) the `change` identifies the Change by at least one non-empty value among title, description, base, head, or a non-empty list of changed files; (b) the `claim` holds either `status: 'identified'` with a non-empty claim `id` and non-empty claim `text` and a Provenance, or `status: 'not_identified'` with no claim text; (c) the `subject` holds a non-empty target URL; (d) `actions` is a list; (e) `observations` holds at least one entry and every entry has a non-empty screenshot path; (f) `artifacts` holds a non-empty run directory and a non-empty report path.
4. WHEN the `claim` holds `status: 'not_identified'`, THE predicate SHALL return `true` only if the `claim` has no text, so that the evidence states that a claim could not be identified and CE does not invent one (SPEC 7.2, R4.3).
5. WHEN the `claim` holds `status: 'identified'` with an empty or whitespace-only `text`, THE predicate SHALL return `false`.
6. THE predicate SHALL be pure and total: it SHALL return a boolean and not throw for any value that satisfies the TypeScript type, including empty strings and empty lists.
7. THE Outcome_Resolver SHALL call `satisfiesMinimumEvidence` on `runtime.evidence` before it returns `EVIDENCED` (Decision D6, Requirement 5 criterion 5).
8. THE Evidence_Checker SHALL be defined once and SHALL be the check that the bundle writer of issue #11 reuses; this feature SHALL NOT write `run.json`.

### Requirement 8: Invariant for EVIDENCED implies the SPEC 7.2 check

**User Story:** As a reviewer, I want a property test that no `EVIDENCED` run can lack the minimum evidence, so that "evidenced" is never claimed without something to inspect. *(R8.1, R9.2; SPEC 7.2; issue checklist item 2)*

#### Acceptance Criteria

1. THE Invariant_Test "EVIDENCED implies SPEC 7.2 check" SHALL assert that, for every generated Resolve_Input where the Outcome is `EVIDENCED`, `runtime` is present, `satisfiesMinimumEvidence(runtime.evidence)` is `true`, and the evidence holds at least one Observation.
2. THE test suite SHALL include the converse property: for every generated Resolve_Input with no `error`, `required = true`, a supported Dominant_Surface and a `runtime` whose Evidence_Summary passes `satisfiesMinimumEvidence`, the Outcome is `EVIDENCED` and `finalState` equals the `finalState` of the Runtime_Result.
3. THE test suite SHALL include a property that, for every generated Resolve_Input with no `error`, `required = true`, a supported Dominant_Surface and a `runtime` whose Evidence_Summary fails `satisfiesMinimumEvidence`, the Outcome is `ERROR` with the Resolve_Reason `evidence-incomplete`, or `no-observation` when the list of Observations is empty.
4. THE test suite SHALL include a property for `satisfiesMinimumEvidence`: removing any one of the five items (change, claim, subject, observations, artifacts) from a summary that passes gives a summary that fails; and replacing the `claim` of a passing summary by `not_identified` with no text still passes.
5. THE test suite SHALL include a property that a summary with `claim.status: 'not_identified'` and a non-empty claim text fails the predicate (no fabricated claim).
6. THE generator of Evidence_Summaries SHALL be able to produce both passing and failing summaries, and the test SHALL assert that both kinds occur among the generated values.

### Requirement 9: Exit codes and `output.fail-on`

**User Story:** As a CI author, I want CE to exit non-zero only for the outcomes I listed, so that CE does not act as a merge gate unless I choose it. *(R8.4; design section 6; SPEC 4.4; issue checklist item 3)*

#### Acceptance Criteria

1. THE Exit_Code_Mapper SHALL export `exitCodeFor(resolution: Resolution, failOn: readonly FailOnEntry[] | undefined): 0 | 1 | 2 | 3` from `packages/ce/src/outcome/exit-code.ts`, where `FailOnEntry` is `'error' | 'unsupported' | 'evidenced-not-reached'`, the same values as `output.fail-on` of the Config_Schema.
2. WHEN `failOn` is `undefined`, THE Exit_Code_Mapper SHALL use `['error']`, the value in `ConfigDefaults.output['fail-on']`.
3. WHEN the Outcome is `ERROR` and `failOn` contains `error`, THE Exit_Code_Mapper SHALL return `1`.
4. WHEN the Outcome is `UNSUPPORTED` and `failOn` contains `unsupported`, THE Exit_Code_Mapper SHALL return `2`.
5. WHEN the Outcome is `EVIDENCED`, `finalState` is `not_reached` and `failOn` contains `evidenced-not-reached`, THE Exit_Code_Mapper SHALL return `3`.
6. THE Exit_Code_Mapper SHALL return `0` in every other case, including: any Outcome whose entry is not in `failOn`; the Outcome `SKIPPED` for every `failOn`; the Outcome `EVIDENCED` with `finalState: reached` for every `failOn`; and every Outcome when `failOn` is the empty list.
7. THE Exit_Code_Mapper SHALL NOT return `0` for `ERROR` when `failOn` is the default `['error']`, and SHALL return `0` for `ERROR` when `failOn` is `[]` (R8.4: exit `0` unless the Outcome is listed).
8. THE Exit_Code_Mapper SHALL be pure: the result depends only on `resolution.outcome`, `resolution.finalState` and the entries of `failOn`, and does not depend on the order of `failOn` or on duplicate entries.
9. THE Exit_Code_Mapper SHALL return the code as a value and SHALL NOT call `process.exit`, print, or read the environment.
10. THE test suite SHALL include a property over every Outcome and every subset of the three Fail_On entries that checks the table of criteria 3 to 6, and that `SKIPPED` and `EVIDENCED` with `reached` always give `0`.
11. THE test suite SHALL include a unit test that checks the three non-zero codes are distinct from each other and from `0`, so that an integrating system can tell the three failures apart.
12. THE Exit_Code_Mapper SHALL NOT validate `output.fail-on` (the Config_Schema already rejects other values, F5), and the config failure exit code `1` of `reportConfigFailure` SHALL NOT be changed (F6).

### Requirement 10: Property test volume and test policy

**User Story:** As a maintainer, I want every invariant to run enough cases and no API key, so that the "Done when" line of the issue is checked by CI. *(R12.2; steering "Test policy"; issue "Done when")*

#### Acceptance Criteria

1. THE Invariant_Test of Requirement 6 criteria 2 to 5 (exactly one Outcome, SKIPPED implies not required, UNSUPPORTED implies required and not supported) and of Requirement 8 criterion 1 (EVIDENCED implies the SPEC 7.2 check) SHALL each run with `numRuns` of at least 1000, set explicitly in the test and not left to the fast-check default.
2. THE remaining properties of Requirements 6, 8 and 9 SHALL run with `numRuns` of at least 200.
3. THE test suite SHALL pass with no API key, no network, no browser and no running application in the environment, and SHALL NOT import `jev/fake.ts`, `playwright` or `@typesafe-ai/sdk`.
4. THE test suite SHALL include an architecture test, in the style of `assessment/architecture.test.ts`, that checks Requirement 1 criteria 5 to 7: the import and global restrictions of `outcome/`, and that no non-test source file other than `outcome/resolve.ts` assigns, returns or casts to an Outcome literal (comment-stripped source, patterns of Requirement 1 criterion 7). The test SHALL also include a case with a synthetic source text that compares `resolution.outcome === 'EVIDENCED'` and SHALL assert that this comparison is not reported, so that issue #11 is not blocked.
5. THE fast-check properties SHALL use a fixed seed only when reproducing a failure; the default run SHALL use a random seed, and the failing seed and counterexample SHALL be printed by fast-check on failure.
6. WHEN `npm test` and `npm run typecheck` run from the repository root, THE test suite SHALL pass and the typecheck SHALL report no error.

### Requirement 11: Public API and exports

**User Story:** As an author of later stages (evidence bundle, runtime loop, CLI), I want one import for the resolver, the checker and the exit-code mapper, so that every stage uses the same definitions. *(R1.4; design section 2)*

#### Acceptance Criteria

1. THE `outcome/index.ts` module SHALL export `resolveOutcome`, `OUTCOMES`, `V0_SUPPORTED_SURFACES`, `satisfiesMinimumEvidence`, `exitCodeFor` and the types `Outcome`, `FinalState`, `ResolveInput`, `RuntimeResult`, `ResolveReason`, `Resolution`, `EvidenceSummary` and `FailOnEntry`.
2. THE `packages/ce/src/index.ts` module SHALL export `resolveOutcome`, `exitCodeFor` and the types `Resolution`, `ResolveInput`, `Outcome` and `ExecutionOutcome`, so that the public API names the resolver without a deep import.
3. THE modules in `outcome/` SHALL import `Surface` and `Assessment` of the Assessment stage, and `StageError` and `Stage` of `errors.ts`, only with `import type`, so that `outcome/` has no runtime dependency on `assessment/` or on `errors.ts`. The architecture test SHALL check that every import from `assessment/` or `errors.ts` in `outcome/` (non-test files) is a type-only import.
4. THE stub `run()` in `index.ts` SHALL stay as it is; wiring the resolver into `run()` is out of scope (Decision D9).

### Requirement 12: Interaction with issue #31

**User Story:** As the project owner, I want the effect of the resolver on the `backend-cache-ttl` case recorded, so that issue #31 is decided with the facts from this issue. *(Owner comment on issue #8; issue #31)*

#### Acceptance Criteria

1. THE Requirement 4 criterion 6 test SHALL document, in its name, that the case of issue #31 ends in `UNSUPPORTED` and not `SKIPPED` and not a browser run.
2. THE pull request body SHALL state, for issue #31: the resolver resolves `required = true` with surface `backend_internal` to `UNSUPPORTED` (the browser is not started); the resolver does not read `runtime_observable`; the remaining question is whether such a claim should be `required = true`, which is the choice between options A and B of issue #31; and the options are not decided by this pull request.
3. THE pull request SHALL NOT change the Combiner, the question catalog, `catalog.snapshot.json` or the `Assessment` type.
4. THE pull request body SHALL link issue #31 with the words `Refs #31` and SHALL NOT contain `Closes #31`, `Fixes #31` or `Resolves #31`, so that merging does not close issue #31.

### Requirement 13: Issue acceptance, traceability and closing the issue

**User Story:** As the project owner, I want each acceptance criterion of issue #8 traced to requirements and verified, and the issue closed by the merged pull request, so that the issue board reflects real state.

#### Acceptance Criteria

1. THE Issue_Checklist SHALL be traced to these requirements, so that each item of the issue is covered by at least one requirement:

   | Issue #8 item | Requirements |
   | --- | --- |
   | Pure `outcome/resolve.ts` per the table in design section 6 | 1, 2, 3, 4, 5 |
   | `EVIDENCED` with `finalState: reached \| not_reached` | 5.1 to 5.3, 5.6 |
   | fast-check: exactly one Outcome | 1.2, 1.3, 6.1 to 6.3, 6.9 to 6.11 |
   | fast-check: `SKIPPED ⇒ ¬required` | 3, 6.4, 6.6 |
   | fast-check: `UNSUPPORTED ⇒ required ∧ ¬supported` | 4, 6.5, 6.6 |
   | fast-check: `EVIDENCED ⇒` bundle passes SPEC 7.2 check | 5.1, 5.5, 7, 8 |
   | Exit codes and `output.fail-on` | 9 |
   | Done when: invariants pass with at least 1000 runs each | 10.1, 10.2, 10.6 |
   | Owner comment: surfaces such as `backend_internal` with high `runtime_observable` | 4.2, 4.3, 4.6, Decisions D4 and D5, 12 |
   | Refs R8 (R8.1 to R8.4) | 1, 2, 3, 4, 5, 6, 9 |
   | Refs design section 6 | 1 to 9 |

2. WHEN all implementation tasks are complete, THE implementer SHALL verify each item of the Issue_Checklist against the delivered code and SHALL record the evidence for each: a passing test name, a file path or a command output. The three checklist items are the pure resolver with `finalState`, the four fast-check invariants, and the exit codes with `output.fail-on`.
3. WHEN all implementation tasks are complete, THE implementer SHALL verify the "Done when" line of issue #8 by running the Invariant_Tests and recording that each of the four ran with `numRuns` of at least 1000 and passed.
4. WHEN all implementation tasks are complete (`all_tasks_complete`) and the verification of criteria 2 and 3 passes, THE implementer SHALL open a pull request against `main` of rfxlamia/ce.
5. THE pull request body SHALL contain the line `Closes #8` so that GitHub closes issue #8 when the pull request is merged.
6. THE pull request body SHALL list the items of the Issue_Checklist, each with its recorded evidence, and SHALL contain the statement of Requirement 12 criterion 2.
7. THE implementer SHALL NOT merge the pull request and SHALL NOT close issue #8 by hand.
8. IF any verification in criteria 2 or 3 fails, THEN THE implementer SHALL fix the failure before opening the pull request.
9. THE pull request body SHALL NOT contain any API key or other secret value.
10. THE completion of all implementation tasks (`all_tasks_complete`) SHALL be a hard gate for opening the pull request. IF any implementation task is not complete, THEN THE implementer SHALL NOT open the pull request, even when every other step has passed.
