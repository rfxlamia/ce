# Requirements Document

## Introduction

This feature builds the bounded Observe → Decide → Execute loop of Continuous Evidence (CE) and the browser capability that plugs it into the run pipeline: GitHub issue #10 in rfxlamia/ce, "[M2] Observe → Decide → Execute loop" (label `runtime`, milestone M2). It implements `runtime/observe.ts`, `runtime/decide.ts`, `runtime/execute.ts`, `runtime/loop.ts`, `runtime/capture.ts` and `runtime/capability.ts` (steering "Structure", design section 2; `capability.ts` is an addition to the planned layout), requirement R7 "Bounded verification loop" of `docs/journal/v0.0/requirements.md`, and design sections 5 and 12. `SPEC.md` is normative and wins on any conflict with this document or the journal.

The loop drives a browser (Playwright, Chromium) against a ready Target_Handle from the `runtime-target` spec (issue #9). It reaches the state described by a Claim without a test script, chooses each action only from options built from an observation, and never does anything outside the bounds below. It produces observations, screenshots, a step log and a final signal. It does not decide the Outcome: the Outcome is decided only in `outcome/resolve.ts` (steering "Design rule"). The loop returns a Loop_Result, and the Browser_Capability maps it to the `RuntimeResult` (`finalState`, `evidence`) that `resolveOutcome` consumes.

### Ownership of the pipeline integration and of evidence files

The `runtime-target` spec (Requirement 9 criterion 3) hands the pipeline integration to #10: "The capability of #10 calls `openTarget`, uses the handle and calls `stop()` in a `finally` block". This spec owns it, in Requirement 13. Until Requirement 13 is implemented, `browser_ui` stays `UNSUPPORTED` because the default registry is empty.

Evidence files are split as follows, and this split is the single statement of ownership for both specs:

- #9 (`runtime-target`) writes `target.log` in the run directory.
- #10 (this spec) writes the screenshot PNG files under the run directory (Requirement 8) and returns the data about the run (Loop_Result) through the Browser_Capability. It writes no other file.
- #11 (`evidence/`, "Evidence bundle, run.json schema, terminal summary") writes `run.json`, `report.html` and the terminal and markdown summaries, and validates the bundle schema. It does not exist yet.
- `run-vertical-slice` (#41) criterion "SHALL NOT write `run.json`, `report.html` or any other evidence file" stays true: it concerns the pipeline, not the capability.

This spec supersedes design section 3 ("data model") of `docs/journal/v0.0/design.md` for these fields: `Observation.navigation`, `Observed_Element.fixtureKeys`, and an Action set without `hover`, `focus` or an input `value` (the Action carries a `fixtureKey`, never a value). `SPEC.md` still wins over this document.

Any sibling-spec wording that reads as "#10 owns the evidence files" is superseded by this list. `EvidenceSummary.artifacts.reportPath` is a path that #11 will fill in with the file it writes; this feature supplies the path string only (Requirement 13 criterion 9).

### Issue #10 checklist coverage

Every checklist item and the "Done when" line of issue #10 maps to requirements, so that a pull request for this spec can close the issue.

| Issue #10 item | Requirements |
| --- | --- |
| `observe`: actionable elements (role, name, stable locator, visibility), ≤240 options ranked by proximity to the change | 1, 2 |
| `decide`: one text-only request {`next_action`, `state_reached_dom`}; options only from the observation plus `done` / `give_up` | 3 |
| `execute`: refuse unobserved refs; same-origin only; `fill` values from `runtime.fixtures`; dialogs/downloads dismissed and logged | 4, 5, 6, 7 |
| Screenshot after each state-changing action; max steps and time budget | 8, 9 |
| Final image request {`state_reached`, `locate_subject` (Box)} through the JSON transport as one combined `noul` + `box` request; `JevImageError` falls back to text signals and the report omits the highlight | 10 |
| Expand demo-app with a modal + dropdown scenario (dropdown clipping inside a modal) | 11 |
| Done when: the dropdown-in-modal scenario reaches the claimed state on demo-app | 11, 12, 13 |
| Done when: property test, no action ever targets an unobserved ref | 4, 12 |

Requirement 13 (Browser capability) has no checklist line of its own. It is required so that the "Done when" line holds through `ce run` and not only through a direct call of the loop.

### Review feedback coverage

First review:

| Feedback item | Resolution |
| --- | --- |
| B1 pipeline integration has no owner | Adopted. Requirement 13, ownership list above, Out of scope O5 and O6 |
| B2 Requirement 11.8 not deterministic with the fake | Adopted. Requirement 3 criterion 9 (relative paths, fixed history format), Requirement 11 criteria 8 to 10 |
| B3 fixture leak through the screenshot, URL and title | Adopted, option (b). Requirement 6 criteria 4 to 8 (mask plus redaction); former criterion 6 replaced |
| I1 page text in question text | Adopted. Requirement 1 criteria 8 to 10 |
| I2 hover/focus dead path | Adopted. Both removed from the Action_Set |
| I3 fixture matching undefined | Adopted. Requirement 6 criteria 1 and 2 |
| I4 Navigation_Option storage and double counting | Adopted. Requirement 1 criterion 11, Requirement 2 criteria 2 and 3 |
| I5 time, settle, popups, redirects | Adopted. Requirement 5 criteria 7 and 8, Requirement 7 criteria 6 to 8, Requirement 8 criteria 9 and 10, Requirement 9 criteria 2, 3 and 11, Requirement 10 criterion 11 |
| M1 screenshot on non-captured step | Adopted. Requirement 8 criterion 4 |
| M2 Change_Terms noise | Adopted. Glossary Change_Terms and Proximity_Score, Requirement 2 criterion 8 |
| M3 argmax tie-break | Adopted. Requirement 3 criterion 7 |
| M4 CI Chromium install | Adopted. Requirement 12 criterion 13 |
| M5 negative geometry case | Adopted. Requirement 11 criteria 11 and 12 |

No feedback item of the first review is declined. Two points are adopted in a narrower form than suggested: for B3 only option (b) is implemented (not option (a)), because a screenshot with an exception would still leak fixture values to the classifier; for B2 the final image request is matched by question id in a test double, because a rendered PNG is not byte-stable across machines.

Second review:

| Feedback item | Resolution |
| --- | --- |
| B1 Requirement 13.3 and 13.12 conflict, `runDir` empty when a gateway is supplied | Adopted. Requirement 13 criteria 3, 13 and 14 (the pipeline always computes `runDir` when a capability is selected, the call log stays pipeline-built only, `run()` signature unchanged), criterion 2 and 15 (affected test files), Fact F9 |
| I1 claim selection ignores surface | Adopted. Requirement 13 criterion 6 (first filter `surface === 'browser_ui'`) |
| I2 6.4 too absolute for the image | Adopted, both options in part. Requirement 6 criteria 4, 7 and 9 (text guarantee stays absolute; the image guarantee covers Filled_Fields and elements whose text contains a fixture value; other pixels are stated as not guaranteed) |
| I3 default registry imports Playwright everywhere | Adopted. Requirement 13 criterion 16 (lazy `await import('playwright')` inside `run`), Requirement 12 criterion 17 |
| I4 `finalImageError` type inconsistent | Adopted. Glossary Loop_Result, Requirement 10 criteria 6 and 11 (`JevImageErrorReason \| 'time-budget'`, distinguished through `signal.reason`) |
| M1 Playwright calls are not cancellable | Adopted. Requirement 9 criteria 3 and 12, Assumption A2 |
| M2 settle rule cost with polling apps | Adopted as a documented risk. Assumption A1 |
| M3 who fills Loop_Sink | Adopted. Glossary Loop_Sink, Requirement 13 criterion 9 (no-op until #11, `ce run` does not persist the step log) |
| M4 11.12 overclaims | Adopted. Requirement 11 criterion 12 (the geometry assertion is the proof; the double's answer only checks the probability mapping) |
| M5 drift from design section 3 | Adopted. Introduction line "supersedes design section 3" |

No feedback item of the second review is declined.

### Facts verified in the code and the journal

- F1. `jev/catalog.ts` already defines `runtime.next_action` (a `choice` question whose criteria are the option descriptions keyed `"0"`, `"1"`, … plus the fixed keys `done` and `give_up`; it throws `RangeError` above `MAX_NEXT_ACTION_OPTIONS`, 240), `runtime.state_reached_dom` (`noul`, text only), `runtime.state_reached` (`noul`, image) and `runtime.locate_subject` (`box`, image). It also exports `finalImageQuestions(claim, pngBytes)`, which builds the combined Final_Image_Request. This feature builds no question text and no image request of its own (steering "Placement rules").
- F2. `jev/gateway.ts` exposes `JevGateway.ask(request, options)`. `HybridJevGateway` routes a request that carries an image over the JSON transport and raises `JevImageError` on an image failure (steering `jev-gateway-decision`). Only `jev/` knows that two transports exist.
- F3. `config/schema.ts` already defines `runtime.max-steps` (default 12), `runtime.timeout` (default `90s`), `runtime.viewport`, `runtime.fixtures` (string map) and `target.routes` (string list). The schema has no `allow-origins` key and no reached threshold. This feature does not change `config/` (see Out of scope O2 and O3).
- F4. `packages/ce/src/runtime/` holds only `target.ts` and its tests. `playwright` is not yet a dependency of any workspace package. This feature adds it to `packages/ce` (steering "Stack").
- F5. `examples/demo-app` has a header "Menu" toggle with a navigation dropdown and an "Increment" counter. It has no modal and no select dropdown. It is a Vite app with no knowledge of CE.
- F6. `outcome/types.ts` defines `RuntimeResult { finalState: 'reached' | 'not_reached'; evidence: EvidenceSummary }` and `FinalState`. `EvidenceSummary` (in `outcome/evidence.ts`) holds `change`, `claim` (`identified` with `id`, `text`, `provenance`, or `not_identified`), `subject.url`, `actions[]`, `observations[] { step, screenshot }` and `artifacts { runDir, reportPath }`. `resolveOutcome` returns `ERROR` with reason `no-observation` when `observations` is empty, and `ERROR` with reason `evidence-incomplete` when `satisfiesMinimumEvidence` is false (every observation needs a non-empty `screenshot`, and `subject.url`, `artifacts.runDir` and `artifacts.reportPath` must be non-empty). Journal R7.4 and design section 12 decide that a loop that gives up or exhausts its budget resolves to `EVIDENCED` with `finalState: not_reached`.
- F7. The design measures the text-only `next_action` request at p95 under 1 s against a per-step budget of 7.5 s (design section 5, spike findings). CI tests use `FakeJevGateway` and need no API key (steering "Test policy").
- F8. `FakeJevGateway` looks up a recording by `(id@version, stateHash, question name)`. `stateHash` hashes the exact request state text; for a request with an image it also hashes the SHA-256 of the image bytes. A state that contains a full URL with a random port (`pickFreePort()` in `demo-app.testsupport.ts`) changes the hash on every run, and a rendered PNG differs between machines and Chromium builds.
- F9. `run/types.ts` defines `RuntimeHookInput { context, claims, assessment, config, gateway, runDir?, signal? }`, `RuntimeHook` and `CapabilityEntry { name, surfaces, run }`. In `run/pipeline.ts` (lines 99 to 107) `runDir` is computed only in the branch where `options.gateway` is NOT supplied, so it is absent whenever a gateway is supplied, which is the case for every keyless test. `run/pipeline.ts` defaults `capabilities` to `EMPTY_REGISTRY`, calls `selectCapability`, awaits `entry.run(...)`, and wraps a thrown error as `StageError('runtime', cause)`. `runtime-target` Requirement 9 criterion 4 locks the signatures of `run()`, `RuntimeHookInput` and `RuntimeResult`. `targetOptionsFromConfig(config, extras)` in `runtime/target.ts` needs `cwd`, `env`, `runDir` and `signal`; `RuntimeHookInput` carries only `runDir` and `signal` of those.
- F10. `Assessment.perClaim` holds one entry per assessed subject: `{ claimId, runtimeObservable, checksAdequate, surface, surfaceConfidence, needed, uncertain }`, where `claimId` is a Claim id or `'change'`. `Assessment.subjects` holds the text of each subject, including the Change_Subject when no Claim was identified.

### Assumptions and risks for the design

- A1. The settle rule of Requirement 8 criterion 9 waits for 500 ms without a request in flight. An app with polling or analytics traffic never goes idle, so every settle wait ends at the Settle_Timeout (3 s) and 12 steps would spend 36 s of the default 90 s Time_Budget. v0 accepts this because each such timeout is recorded as a `settle` entry in the Event_Log. The design should treat this as a known cost and may refine the rule later.
- A2. Playwright calls cannot be cancelled through an `AbortSignal`. The loop bounds them by a per-call timeout instead (Requirement 9 criterion 12).

### Out of scope for v0

- O1. Browsers other than Chromium, and capabilities other than `browser_ui` (steering "Product", non-goals).
- O2. A `runtime.allow-origins` setting. Design section 5 mentions it, but the schema has no such key and issue #10 requires "same-origin only". v0 therefore allows exactly the Target_Origin. Adding an allow-list is a later change that touches `config/`.
- O3. A configurable reached threshold. The Reached_Threshold is a constant of the runtime module in v0.
- O4. Drag, hover, focus, keyboard shortcuts, file upload, choosing a value of a native `select`, multi-tab and iframe traversal. The Action_Set is the one in Requirement 3 criterion 4.
- O5. Starting or stopping the target inside the loop. The `runtime-target` spec owns the lifecycle code; the loop receives a ready `baseUrl`. The call of `openTarget` and `stop()` belongs to the Browser_Capability of this spec (Requirement 13).
- O6. Writing `run.json`, `report.html`, the terminal summary and the schema validation. Issue #11 (`evidence/`) owns them. This feature writes screenshots only, supplies the data they render (Requirement 8 criterion 3, Requirement 10 criterion 6, Requirement 13 criterion 9) and the rule that the report omits the highlight when the Box is absent.
- O7. Running more than one Claim per run. The Browser_Capability runs the loop for exactly one selected Claim (Requirement 13 criterion 6).

## Glossary

- **Runtime_Loop**: The module `runtime/loop.ts` that runs the bounded Observe → Decide → Execute cycle and returns a Loop_Result.
- **Observer**: The module `runtime/observe.ts` that turns a Playwright page into an Observation.
- **Decider**: The module `runtime/decide.ts` that turns an Observation and a Claim into one text-only gateway request and maps the answer to an Action.
- **Executor**: The module `runtime/execute.ts` that turns an Action into a Playwright call.
- **Capture**: The module `runtime/capture.ts` that takes screenshots, waits for the page to settle, and records dialog, download and popup events.
- **Browser_Capability**: The module `runtime/capability.ts`. It builds the `CapabilityEntry` named `browser_ui` that opens the target, runs the Runtime_Loop and maps the Loop_Result to a `RuntimeResult`.
- **Jev_Gateway**: The `JevGateway` interface of `jev/gateway.ts`. The Runtime_Loop uses it and never calls `fetch` or the SDK for Jev (steering `jev-gateway-decision`).
- **Target_Handle**: The value returned by `openTarget` in the `runtime-target` spec. It holds `baseUrl` and `stop()`.
- **Target_Origin**: The origin (scheme, host, port) of `Target_Handle.baseUrl`.
- **Claim**: The Claim of `SPEC.md` section 3.2 that the loop tries to reach, carried as text (`Claim.text`).
- **Selected_Claim**: The one Claim, or the Change_Subject text, chosen by Requirement 13 criterion 6.
- **Run_Dir**: The `runDir` of `RuntimeHookInput`: the absolute directory of the run, under which the screenshots are written.
- **Observation**: The record `{ step, url, title, elements, navigation, screenshot, domDigest }`. `screenshot` is a path relative to the Run_Dir. `navigation` is the list of Navigation_Options available at that step.
- **Observed_Element**: One entry `{ ref, role, name, locator, visible, enabled, href?, fixtureKeys }` of an Observation. `ref` is a string of the form `e<N>` that is unique within one Observation. `name` is the Sanitized_Text of the accessible name. `href` is present for a link and holds its target resolved against the Target_Origin. `fixtureKeys` is the sorted list of fixture keys that match the field (Requirement 6 criterion 1), empty for any element that is not a fill-capable field. An Observed_Element has no field for the value of an input.
- **Ref**: The `ref` field of an Observed_Element. A Ref is valid for exactly the Observation that produced it.
- **Actionable_Element**: A DOM element that a user can act on: a link, a button, a text input, a textarea, a select, a checkbox, a radio button, or any element with an ARIA role of `button`, `link`, `menuitem`, `option`, `tab`, `combobox`, `checkbox`, `radio`, `switch` or `textbox`.
- **Stable_Locator**: A Playwright locator string for an Observed_Element, built in this order of preference: `data-testid`, role plus accessible name, `id`, then a CSS path. It is deterministic for an unchanged DOM. It uses the full, unsanitized accessible name and is never written into question text.
- **Sanitized_Text**: Text from the page (accessible name, title, path, dialog message) after these steps in order: replace every run of whitespace and control characters, including newlines, with one space; trim; replace every fixture value with `[redacted]` (Requirement 6 criterion 6); truncate to at most 80 characters, where a truncated text ends with `…` and the `…` counts toward the 80; escape `\` as `\\` and `"` as `\"`. The path form of Sanitized_Text uses a limit of 200 characters.
- **Option**: One entry of the `runtime.next_action` question. A Navigation_Option or an Element_Option has an index key `"0"`, `"1"`, …; `done` and `give_up` are the two fixed terminal options.
- **Element_Option**: An Option for one visible and enabled Observed_Element, or for one (field, fixture key) pair of a fill-capable field. Its description has the form `e12: button "Menu"` (Ref, role, quoted Sanitized_Text name), or `e5: textbox "Email" fill from fixture "email"` for a fill Option.
- **Navigation_Option**: An Option to go to a configured route (`target.routes`) of the Target_Origin whose resolved URL is not the `href` of an observed link. Its description has the form `go to /path`. Observed links are not Navigation_Options; they are Element_Options.
- **Option_Cap**: The maximum number of non-terminal Options in one request, Element_Options and Navigation_Options together: 240 (`MAX_NEXT_ACTION_OPTIONS`).
- **Change_Terms**: The set of lower-case word tokens taken from the paths of the changed files and from the added lines (`+` lines) of their patches in `ChangeContext.change.files`. A token is a maximal run of ASCII letters and digits after splitting camelCase boundaries. A token is dropped when it has fewer than 3 characters, consists only of digits, or is in the Change_Stopwords.
- **Change_Stopwords**: The constant set of tokens that carry no change meaning: `const`, `let`, `var`, `function`, `return`, `import`, `export`, `from`, `default`, `class`, `extends`, `new`, `this`, `true`, `false`, `null`, `undefined`, `void`, `type`, `interface`, `string`, `number`, `boolean`, `async`, `await`, `else`, `for`, `while`, `div`, `span`, `px`, `rem`, `auto`, `none`, `flex`, `block`, `inline`, `src`, `index`, `test`, `spec`, `tsx`, `jsx`, `css`, `html`, `json`, `node`, `modules`, `packages`, `diff`, `git`, `the`, `and`.
- **Proximity_Score**: For an Observed_Element, the number of distinct Change_Terms that equal a token of its Match_Text. A higher score is closer to the change. The score uses whole-token equality, not substring matching.
- **Match_Text**: The concatenation of the role, the Sanitized_Text name, and the `data-testid` and `id` values of the element, tokenised like Change_Terms. It does not include a CSS path.
- **Action**: One of the kinds `click` (with a `ref`), `fill` (with a `ref` and a `fixtureKey`), `goto` (with a `url`), `done`, `give_up` (with a `reason`).
- **State_Changing_Action**: An Action of kind `click`, `fill` or `goto`. `done` and `give_up` are not state-changing.
- **Fixtures**: The map `runtime.fixtures` of the effective config. A fixture is addressed by its key.
- **Redactor**: The function that replaces every non-empty fixture value in a text with `[redacted]`, longest value first.
- **Max_Steps**: The effective `runtime.max-steps`.
- **Time_Budget**: The effective `runtime.timeout`, converted to milliseconds with `parseDuration`. It bounds the whole run of the loop, including the final capture and the Final_Image_Request.
- **Final_Reserve**: The part of the Time_Budget reserved for the final capture and the Final_Image_Request: the smaller of 10 000 ms and 20 percent of the Time_Budget.
- **Loop_Deadline**: Time_Budget minus Final_Reserve. No new step starts after the Loop_Deadline.
- **Settle_Timeout**: The constant 3 000 ms that bounds one settle wait.
- **State_Reached_DOM**: The probability that the `runtime.state_reached_dom` answer assigns to "yes".
- **Reached_Threshold**: The constant in `runtime/` that State_Reached_DOM must meet. v0 value: 0.7.
- **Event_Log**: The ordered list of recorded dialog events, download events, popup events, settle timeouts and refusals of the loop. Each entry has `step`, `kind` (`dialog`, `download`, `popup`, `settle`, `refusal`), and a `detail` string that is Redactor output.
- **Filled_Field**: A field that the Executor filled during the run, identified by its Stable_Locator.
- **Final_Image_Request**: The single gateway request built by `finalImageQuestions` that carries the final screenshot with `state_reached` (`noul`) and `locate_subject` (`box`).
- **Subject_Box**: The Box answer of `runtime.locate_subject`.
- **Text_Signals**: The `runtime.state_reached_dom` answers of the steps already taken, with the Observation record of the last step.
- **Loop_Result**: The value the Runtime_Loop returns: `finalState`, the Observation list, the step log (observation, action, option probabilities), the Event_Log, the final screenshot path, the final signals, the optional Subject_Box, the dated model id of the Final_Image_Request, an optional `finalImageError` of type `JevImageErrorReason | 'time-budget'` (the `reason` of a `JevImageError`, or `time-budget` when the loop itself aborted the request at the Time_Budget), and the stop reason (`done`, `reached`, `give_up`, `max-steps`, `time-budget`, `aborted`).
- **Loop_Sink**: The optional callback `onLoopResult(loopResult, info)` of the Browser_Capability dependencies, default no-op, through which #11 receives the Loop_Result. The default registry of the Run_Pipeline leaves it at the no-op until #11 supplies one, so `ce run` does not yet persist the step log.
- **Demo_App**: `examples/demo-app`.
- **Dropdown_Modal_Scenario**: The scenario added to the Demo_App by Requirement 11.

## Requirements

### Requirement 1: Observe the page as actionable elements

**User Story:** As a developer, I want CE to see the page as a list of things it can act on, so that every later decision rests on observed facts.

#### Acceptance Criteria

1. WHEN the Runtime_Loop observes the page, THE Observer SHALL return an Observation with the page URL, the page title, a `step` number, a `domDigest`, the list of Observed_Elements and the list of Navigation_Options.
2. THE Observer SHALL include in `elements` one Observed_Element per Actionable_Element, with its role, its accessible name, its Stable_Locator, its visibility and its enabled state.
3. THE Observer SHALL assign each Observed_Element a Ref of the form `e<N>` that is unique within the Observation and that follows document order.
4. THE Observer SHALL compute the visibility of an Observed_Element as true only WHEN Playwright reports the element as visible and the element is not clipped to zero size by an ancestor.
5. THE Observer SHALL compute `domDigest` as a hash of the Observed_Element list (Ref, role, name, locator, visible, enabled, href, fixtureKeys), so that two observations of an unchanged page have equal digests.
6. WHEN the same DOM is observed twice, THE Observer SHALL return the same Refs, the same Stable_Locators and the same `domDigest`.
7. IF an Actionable_Element has no accessible name, THEN THE Observer SHALL record its name as an empty string and keep the element in the list.
8. THE Observer SHALL treat the text content of the page as data and SHALL NOT copy any text of the page into an instruction of the question (Requirement 3 criterion 6).
9. THE Observer SHALL store every accessible name and the page title in an Observation as Sanitized_Text, and SHALL use only Sanitized_Text when it builds Option descriptions and state text.
10. THE Observer SHALL NOT read the value of any input, textarea or select, including a password input.
11. THE Observer SHALL store the Navigation_Options of the step in `Observation.navigation`, each as an absolute URL on the Target_Origin with its path form, so that Requirement 5 criterion 2 validates against stored data.

### Requirement 2: Rank and cap the options by proximity to the change

**User Story:** As a developer, I want the loop to keep the options most related to my change, so that a large page does not hide the element I changed.

#### Acceptance Criteria

1. THE Decider SHALL build one Element_Option for each Observed_Element whose `visible` and `enabled` fields are both true, and SHALL build no Element_Option for any other Observed_Element.
2. THE Decider SHALL build no Element_Option for a link whose `href` has an origin other than the Target_Origin.
3. THE Decider SHALL build one Navigation_Option for each distinct entry of `target.routes`, after resolving the entry against the Target_Origin, and SHALL skip an entry whose resolved URL equals the `href` of an observed link, so that a link and a route never produce two Options.
4. THE Decider SHALL rank Element_Options and Navigation_Options by descending Proximity_Score, and SHALL break ties by document order of the Observed_Element (a Navigation_Option follows all Element_Options of equal score, in the order of `target.routes`).
5. THE Decider SHALL keep at most Option_Cap (240) non-terminal Options, Element_Options and Navigation_Options together, and SHALL keep the 240 with the highest rank WHEN more than 240 exist.
6. THE Decider SHALL produce the same ordered Option list for the same Observation, Change_Terms, `target.routes` and Fixtures keys on every call.
7. WHEN no Change_Terms exist, THE Decider SHALL rank every Option with Proximity_Score 0, which keeps document order.
8. THE Decider SHALL compute Change_Terms with the Change_Stopwords and the token rules of the Glossary, and SHALL compute Proximity_Score from the Match_Text, so that a CSS path never contributes to a score.
9. THE Decider SHALL pass the Option descriptions to the catalog builder for `runtime.next_action` and SHALL NOT write any question text itself.

### Requirement 3: Decide with one text-only request

**User Story:** As a developer, I want each step to cost one fast text request, so that the loop stays within its time budget.

#### Acceptance Criteria

1. WHEN the Runtime_Loop needs a decision, THE Decider SHALL send exactly one request to the Jev_Gateway per step, containing the two questions `next_action` and `state_reached_dom`.
2. THE Decider SHALL build that request from text only, with no image asset, so that the request takes the SDK transport.
3. THE Decider SHALL put in the request state the Claim text, the page path, the page title and the step history, and SHALL put the Option descriptions in the `next_action` question.
4. THE Decider SHALL map the `next_action` answer to exactly one Action from this set: an Element_Option index to `click` on that element's Ref, or to `fill` on that element's Ref with the fixture key of the Option; a Navigation_Option index to `goto`; `done`; or `give_up`.
5. THE Decider SHALL derive the Action kind for an Element_Option from the Option itself: `fill` for a fill Option (Requirement 6 criterion 1), `click` for every other Option.
6. THE Decider SHALL map an answer key that is neither an Option index of the request nor `done` nor `give_up` to `give_up` with reason `invalid-answer`.
7. THE Decider SHALL pick the answer key by the highest probability, and WHEN several keys share the highest probability, THE Decider SHALL choose the lowest Option index, then `give_up`, then `done` (so that an ambiguous answer prefers the safer terminal option).
8. IF the request fails with an error other than a `JevImageError`, THEN THE Runtime_Loop SHALL raise `StageError('runtime', cause)` and SHALL stop.
9. THE Decider SHALL write the request state as text in which the page location is the Sanitized_Text path of the page relative to the Target_Origin (path, query and fragment, never scheme, host or port), and in which each step of the history is one line of the form `step <N>: <kind> <description> -> <result>`, where `<kind>` is the Action kind, `<description>` is the Sanitized_Text Option description and `<result>` is `changed`, `unchanged` or `refused` (a `changed` result means the `domDigest` or the path differs from the previous Observation). The state SHALL contain nothing that varies between runs of the same scenario, such as a port, a timestamp, a temporary directory or a random identifier.
10. WHEN the Option list is empty, THE Decider SHALL still send the request, so that `done` and `give_up` remain available.

### Requirement 4: Refuse actions on unobserved refs

**User Story:** As a developer, I want CE to never act on something it did not observe, so that the run stays predictable.

#### Acceptance Criteria

1. THE Executor SHALL accept an Action with a `ref` only WHEN that Ref belongs to the most recent Observation of the loop and names an Observed_Element with `visible` true and `enabled` true.
2. IF an Action carries a Ref that is absent from the most recent Observation, THEN THE Executor SHALL perform no browser call, SHALL record a `refusal` entry in the Event_Log with the Ref, and SHALL signal the Runtime_Loop to give up with reason `unobserved-ref`.
3. IF an Action carries a Ref of an Observed_Element with `visible` false or `enabled` false, THEN THE Executor SHALL perform no browser call, SHALL record a `refusal` entry, and SHALL signal the Runtime_Loop to give up with reason `ineligible-ref`.
4. THE Executor SHALL resolve a Ref to a browser locator only through the Stable_Locator stored in the most recent Observation, and SHALL NOT build a locator from text supplied by the Decider.
5. IF the Stable_Locator of an accepted Ref matches no element or more than one element at execution time, THEN THE Executor SHALL perform no click or fill, SHALL record a `refusal` entry, and SHALL signal the Runtime_Loop to give up with reason `locator-mismatch`.
6. FOR ALL Observations, Option lists and `next_action` answers, every `click` and `fill` Action that the Runtime_Loop hands to the Executor SHALL carry a Ref that is present in the most recent Observation (the invariant tested by Requirement 12 criterion 1).

### Requirement 5: Stay on the target origin

**User Story:** As a developer, I want the loop to stay on my application, so that CE never sends a browser to an arbitrary site.

#### Acceptance Criteria

1. IF a `goto` Action has a URL whose origin differs from the Target_Origin, THEN THE Executor SHALL perform no navigation, SHALL record a `refusal` entry with the URL origin, and SHALL signal the Runtime_Loop to give up with reason `cross-origin`.
2. THE Executor SHALL accept a `goto` URL only WHEN the URL is among the `navigation` entries stored in the most recent Observation.
3. WHEN a `click` causes the page to navigate to a URL whose origin differs from the Target_Origin, THE Executor SHALL abort that navigation request before it is sent, SHALL record a `refusal` entry, and SHALL signal the Runtime_Loop to give up with reason `cross-origin`.
4. THE Executor SHALL abort every browser request to an origin other than the Target_Origin that is a top-level or frame navigation or a form submission, and SHALL allow sub-resource requests of the page.
5. THE Executor SHALL submit no form whose action URL has an origin other than the Target_Origin.
6. WHEN comparing origins, THE Executor SHALL compare scheme, host and port, after normalizing the default port.
7. WHEN a server response redirects a same-origin navigation to another origin, THE Executor SHALL check every redirect hop against the Target_Origin, SHALL abort the hop whose origin differs, SHALL record a `refusal` entry, and SHALL signal the Runtime_Loop to give up with reason `cross-origin`.
8. WHEN an Action has completed and the page URL has an origin other than the Target_Origin, THE Runtime_Loop SHALL record a `refusal` entry, SHALL stop with reason `cross-origin`, SHALL take no screenshot of that page, and SHALL use the last screenshot taken on the Target_Origin as the final screenshot.

### Requirement 6: Fill values come only from fixtures and never leave the machine

**User Story:** As a developer, I want CE to type only values I configured and never to send them to the classifier or store them in evidence, so that it never invents or leaks data.

#### Acceptance Criteria

1. THE Observer SHALL set `fixtureKeys` of a text input, textarea or element with role `textbox` to the sorted list of fixture keys that match the field, WHERE a fixture key matches a field WHEN the key, trimmed and compared case-insensitively, equals the `name` attribute, the `id` attribute, a token of the `autocomplete` attribute, or the full accessible name of the field (trimmed, case-insensitive). THE Observer SHALL receive only the fixture keys and never a fixture value.
2. THE Decider SHALL build one fill Element_Option for each (field, matching fixture key) pair of a visible, enabled field, and SHALL describe it by the fixture key and never by the fixture value.
3. THE Executor SHALL fill a field only with the value of the fixture key carried by the `fill` Action, and IF that key is absent from `runtime.fixtures` or is not among the `fixtureKeys` of the target Observed_Element, THEN THE Executor SHALL perform no fill, SHALL record a `refusal` entry, and SHALL signal the Runtime_Loop to give up with reason `unknown-fixture`.
4. THE Runtime_Loop SHALL NOT send any fixture value to the Jev_Gateway in any request as text, and SHALL NOT write any fixture value to the Event_Log, the step log, an Observation or the Loop_Result. The Final_Image_Request is covered by criteria 7 and 9: the screenshot is masked for Filled_Fields and for elements whose text contains a fixture value, and other pixels are not guaranteed to be free of a fixture value.
5. WHEN `runtime.fixtures` is absent or empty, THE Decider SHALL build no fill Option.
6. THE Runtime_Loop SHALL apply the Redactor to the page URL, the page title, every accessible name, every dialog message and every refusal detail before it enters a request state, an Observation, the Event_Log or the Loop_Result, so that a value reflected by the page (for example in a `GET` form query string) does not leak.
7. THE Capture SHALL mask every Filled_Field with the Playwright `mask` option in every screenshot it takes after the field was filled, including the final screenshot that is sent to the Jev_Gateway, so that a filled value is never visible in an image that leaves the machine or that is stored in the Run_Dir.
8. IF a Filled_Field cannot be located when a screenshot is taken, THEN THE Capture SHALL mask every `input`, `textarea` and `select` of the page for that screenshot.
9. THE Capture SHALL also mask, in every screenshot, every element whose DOM text content contains a fixture value as a case-sensitive substring (for example a "Welcome demo@example.com" banner), WHERE the Capture alone receives the fixture values for this purpose and passes none of them to the Observer, the Decider or the Jev_Gateway. A fixture value that appears only as pixels with no DOM text (canvas, image, SVG text outside the DOM text of an element) is not covered, and the Loop_Result SHALL NOT claim that it is.

### Requirement 7: Dismiss and log dialogs, downloads and popups

**User Story:** As a developer, I want a surprise dialog, download or new tab not to hang or alter the run, so that the loop always continues on the page it started on.

#### Acceptance Criteria

1. WHEN the page opens a JavaScript dialog (`alert`, `confirm`, `prompt` or `beforeunload`), THE Capture SHALL dismiss it and SHALL append a `dialog` entry to the Event_Log with the dialog type and its message.
2. WHEN the page starts a file download, THE Capture SHALL cancel it, SHALL NOT write the file to disk, and SHALL append a `download` entry to the Event_Log with the suggested file name.
3. THE Capture SHALL register the dialog, download and popup handlers before the first Observation, so that no dialog blocks the page.
4. WHEN a dialog, download or popup event occurs during a step, THE Runtime_Loop SHALL record it in the Event_Log with that step number.
5. THE Capture SHALL truncate a dialog message in the Event_Log to 500 characters.
6. WHEN the page opens a new tab or window (a `target="_blank"` link or `window.open`), THE Capture SHALL close the new page, SHALL append a `popup` entry to the Event_Log with the Sanitized_Text URL of the new page, and SHALL append a `refusal` entry.
7. THE Runtime_Loop SHALL keep observing and acting on the page it started on after a popup was closed, and SHALL NOT treat a popup as a reason to give up.
8. THE Capture SHALL NOT observe, screenshot or send to the Jev_Gateway any page other than the one the loop started on.

### Requirement 8: Screenshot after each state-changing action

**User Story:** As a reviewer, I want a screenshot of every state the loop produced, so that I can inspect the path to the claimed state.

#### Acceptance Criteria

1. THE Runtime_Loop SHALL capture a screenshot of the initial page state as step 0, before the first decision.
2. WHEN a State_Changing_Action completes, THE Runtime_Loop SHALL capture one screenshot of the resulting page state after the page has settled (criterion 9), and SHALL store it as the screenshot of the Observation that follows.
3. THE Runtime_Loop SHALL write each screenshot as a PNG file under the Run_Dir given to it, with a name that contains the step number, and SHALL store the path relative to the Run_Dir in `Observation.screenshot`.
4. WHEN an Action is not state-changing, or the `domDigest` did not change after an Action, THE Runtime_Loop SHALL still re-observe the page, SHALL capture no new screenshot, and SHALL set `Observation.screenshot` to the path of the most recent screenshot, so that every Observation has a non-empty `screenshot` (the `satisfiesMinimumEvidence` rule).
5. THE Runtime_Loop SHALL capture a final screenshot at the end of the loop, whatever the stop reason, WHEN the page is still available and its origin is the Target_Origin.
6. IF a screenshot cannot be written, THEN THE Runtime_Loop SHALL raise `StageError('runtime', cause)`.
7. IF the browser page crashes, THEN THE Runtime_Loop SHALL keep the last screenshot already written, SHALL raise `StageError('runtime', cause)`, and SHALL NOT discard the Observations captured so far.
8. THE Capture SHALL take every screenshot with the Playwright option `animations: 'disabled'`, and with the masks of Requirement 6 criterion 7.
9. WHEN an Action completes, and before every Observation and every screenshot that follows it, THE Capture SHALL wait for the page to settle: no browser request in flight for 500 ms and an unchanged `domDigest` across two reads 100 ms apart, bounded by the Settle_Timeout.
10. IF the page has not settled within the Settle_Timeout, THEN THE Capture SHALL append a `settle` entry to the Event_Log and SHALL continue with the page as it is.

### Requirement 9: Bounded loop

**User Story:** As a developer, I want the loop to stop on a fixed budget, so that a stuck run costs a known amount.

#### Acceptance Criteria

1. THE Runtime_Loop SHALL execute at most Max_Steps Actions.
2. THE Runtime_Loop SHALL stop before starting a new step WHEN the elapsed time reaches the Loop_Deadline, with stop reason `time-budget`.
3. WHEN a step is in progress and the Loop_Deadline passes, THE Runtime_Loop SHALL abort the pending gateway request through its `AbortSignal`, SHALL stop waiting for the pending browser call (criterion 12), and SHALL continue to the final capture within the Final_Reserve.
4. WHEN the `next_action` answer is `done`, or State_Reached_DOM is at least the Reached_Threshold, THE Runtime_Loop SHALL stop with stop reason `done` or `reached` respectively and continue to the final capture, without executing a further Action.
5. WHEN the `next_action` answer is `give_up`, or the Executor signals a give-up, THE Runtime_Loop SHALL stop and continue to the final capture.
6. WHEN the loop stops on Max_Steps or the time budget, THE Runtime_Loop SHALL set `finalState` to `not_reached` unless the final signals of Requirement 10 criterion 5 say `reached`.
7. THE Runtime_Loop SHALL start its clock when the loop is entered, using an injectable clock, so that budgets are testable without real time.
8. THE Runtime_Loop SHALL record each step as `{ observation, action, probabilities }` where `probabilities` are the probabilities of the Options considered, as returned by the gateway answer.
9. WHEN at least one Observation exists at the end of the loop, THE Runtime_Loop SHALL return a Loop_Result and SHALL NOT throw because the claimed state was not reached.
10. THE Runtime_Loop SHALL NOT decide the Outcome and SHALL NOT import `outcome/resolve.ts`; it returns data for `resolveOutcome` to consume.
11. WHEN the `AbortSignal` given to the Runtime_Loop aborts, THE Runtime_Loop SHALL stop with stop reason `aborted` and continue to the final capture, using whatever part of the Final_Reserve remains.
12. THE Runtime_Loop SHALL give every Playwright call (navigation, click, fill, screenshot, locator query, settle wait) a timeout equal to the smaller of the Playwright default and the time remaining until the Time_Budget, because a Playwright call cannot be cancelled through an `AbortSignal`.

### Requirement 10: Final image request through the JSON transport

**User Story:** As a developer, I want one final screenshot judged and located, so that the report can show where the claimed state appears, without slowing the loop.

#### Acceptance Criteria

1. WHEN the loop ends and a final screenshot exists, THE Runtime_Loop SHALL send exactly one Final_Image_Request to the Jev_Gateway, built with `finalImageQuestions(claim, pngBytes)`.
2. THE Final_Image_Request SHALL contain `state_reached` (`noul`) and `locate_subject` (`box`) in one request, and the Runtime_Loop SHALL NOT split them into two requests.
3. THE Runtime_Loop SHALL send no image in any request of the loop steps (Requirement 3 criterion 2) and SHALL send at most one image request per run.
4. THE Runtime_Loop SHALL NOT import the SDK, call `fetch` for Jev, or choose a transport; the Jev_Gateway routes the image request to its JSON transport.
5. WHEN the Final_Image_Request succeeds, THE Runtime_Loop SHALL record the `state_reached` probability and the Subject_Box in the Loop_Result, and SHALL set `finalState` to `reached` WHEN the `state_reached` probability is at least the Reached_Threshold, and to `not_reached` otherwise.
6. IF the Final_Image_Request raises `JevImageError`, THEN THE Runtime_Loop SHALL NOT fail the run, SHALL set `finalImageError` to the error `reason` (a `JevImageErrorReason`), SHALL leave the Subject_Box absent, and SHALL set `finalState` from the Text_Signals: `reached` WHEN any step recorded State_Reached_DOM at or above the Reached_Threshold or ended with `done`, and `not_reached` otherwise.
7. WHEN the Subject_Box is absent, THE Loop_Result SHALL carry no box, so that the report renders the final screenshot without a highlight.
8. IF the Final_Image_Request raises an error that is not a `JevImageError`, THEN THE Runtime_Loop SHALL raise `StageError('runtime', cause)`.
9. WHEN no final screenshot exists because the page was never available, THE Runtime_Loop SHALL send no Final_Image_Request.
10. THE Runtime_Loop SHALL include in the Loop_Result the dated model id returned by the gateway for the Final_Image_Request, so that `run.json` can store it.
11. THE Runtime_Loop SHALL pass an `AbortSignal` to the Final_Image_Request that aborts when the Time_Budget is spent, with a `signal.reason` that identifies the loop's own deadline. IF the request raises a `JevImageError` and that signal is aborted with the deadline reason, THEN THE Runtime_Loop SHALL set `finalImageError` to `time-budget`; IF the request raises a `JevImageError` for any other cause, THEN THE Runtime_Loop SHALL set `finalImageError` to the error `reason`. In both cases the Runtime_Loop SHALL handle the error as in criterion 6, so that the whole run, including the final capture and the Final_Image_Request, does not exceed the Time_Budget.

### Requirement 11: Demo-app modal and dropdown scenario

**User Story:** As a maintainer, I want the demo app to include a dropdown that is clipped inside a modal, and one that is not, so that CE has a real "fix dropdown clipping in modal" scenario to reach and one it must not claim to reach.

#### Acceptance Criteria

1. THE Demo_App SHALL provide a button with the accessible name "Open settings" that opens a modal dialog with `role="dialog"` and the accessible name "Settings".
2. THE modal SHALL contain a dropdown trigger button with the accessible name "Choose theme" that opens a list of at least three options with `role="option"`, including one named "Dark".
3. THE Demo_App SHALL render the "Choose theme" list so that its bounding box is fully inside both the viewport and the bounding box of the modal (the claimed state "dropdown options are fully visible inside the modal").
4. WHEN the option "Dark" is chosen, THE Demo_App SHALL show the text "Theme: Dark" in an element with the accessible name "Current theme".
5. THE Demo_App SHALL provide a "Close" button in the modal that closes it.
6. THE Demo_App SHALL keep the existing "Menu" toggle, navigation, and "Increment" counter unchanged in behavior and accessible names.
7. THE Demo_App SHALL contain no reference to CE and no test hook that exists only for CE.
8. THE Demo_App modal SHALL contain a second dropdown trigger button with the accessible name "Choose language" inside a container that clips its overflow, so that the opened list of at least three options with `role="option"` extends beyond the bounding box of the modal (the negative case, a real clipping defect).
9. WHEN the Runtime_Loop runs against a started Demo_App with the claim "the theme dropdown is fully visible inside the settings modal", a fixed `ChangeContext` fixture, and a gateway in which the text-request answers are recordings of the fake gateway and the Final_Image_Request is answered by question id, THE Runtime_Loop SHALL execute `click` on "Open settings" and then `click` on "Choose theme", and SHALL return a Loop_Result with `finalState` `reached`.
10. THE test of criterion 9 SHALL be deterministic across runs and machines: the recordings of the text requests SHALL match because the state text uses paths relative to the Target_Origin and the fixed history format of Requirement 3 criterion 9 (a random port from `pickFreePort()` changes nothing), and the Final_Image_Request SHALL be answered by a test double that matches on the question id and never on the image bytes (a test-support gateway wrapper, because `FakeJevGateway` matches by the hash of the image).
11. THE test of criterion 9 SHALL read the dropdown geometry from the page (the bounding box of the list, the modal and the viewport) and SHALL assert that the list is within the modal and the viewport, so that the scenario reaches the claimed state in fact and not only in the fake's answers.
12. THE test suite SHALL include a second scenario with the claim "the language dropdown is fully visible inside the settings modal", in which the loop executes `click` on "Open settings" and then `click` on "Choose language", and SHALL assert from the page geometry that the list extends beyond the modal. The geometry assertion is the proof that the scenario is a real clipping defect. WHEN the double answers with a low probability, the Loop_Result has `finalState` `not_reached`, and that part of the test only checks the mapping from the answered probability to `finalState`.

### Requirement 12: Test coverage and module boundaries

**User Story:** As a maintainer, I want the loop's safety invariants tested by property and its boundaries enforced, so that a regression cannot silently weaken them.

#### Acceptance Criteria

1. THE test suite SHALL include a property-based test (fast-check) asserting that for all generated Observations, Option lists and `next_action` answers (valid keys, invalid keys, `done`, `give_up`, indexes out of range), no Action handed to the Executor carries a Ref that is absent from the most recent Observation.
2. THE test suite SHALL include a property-based test asserting that the Option list has at most 240 non-terminal Options, is in descending Proximity_Score order, and has a stable order across repeated calls.
3. THE test suite SHALL include a property-based test asserting that every Option index key maps to exactly one Action, that `done` and `give_up` map to the Actions of the same names, and that the answer tie-break of Requirement 3 criterion 7 is deterministic.
4. THE test suite SHALL include a property-based test asserting that a `goto` Action to an origin other than the Target_Origin never results in a navigation, and an integration test with two local servers asserting that a same-origin redirect to the other server is aborted (Requirement 5 criterion 7).
5. THE test suite SHALL include a property-based test asserting that the loop executes at most Max_Steps Actions, starts no step after the Loop_Deadline, and that the Final_Image_Request receives an aborting signal at the Time_Budget, all with the injectable clock.
6. THE test suite SHALL include a unit test with the fake gateway that simulates the multipart 400 (`JevImageError`) on the Final_Image_Request and asserts that the Loop_Result carries `finalImageError`, no Subject_Box, and a `finalState` taken from the Text_Signals.
7. THE test suite SHALL include a unit test asserting that the Final_Image_Request is one request containing both `state_reached` and `locate_subject`.
8. THE test suite SHALL run keyless: every Jev call uses `jev/fake.ts` or a test double and no test reads `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`.
9. THE test suite SHALL include an architecture test asserting that no file under `runtime/` imports `@typesafe-ai/sdk`, calls `fetch` for Jev, imports `outcome/resolve.ts`, or declares question text, extending the existing architecture tests.
10. THE test suite SHALL include a unit test asserting that the dialog, download and popup handlers dismiss or close the event and append the Event_Log entries of Requirement 7.
11. THE Runtime_Loop SHALL be exported from `runtime/` with injectable `page` or browser factory, gateway, clock and run directory, so that the tests above run without a real network.
12. WHEN `npm run typecheck` and `npm test` run on a clean checkout, THE test suite SHALL pass without a pre-built `examples/demo-app/dist`, building the Demo_App into a temporary directory in the manner of `demo-app.testsupport.ts`.
13. THE CI workflow `.github/workflows/ci.yml` SHALL run `npx playwright install --with-deps chromium` after `npm ci` and before `npm test`, and a test that needs Chromium SHALL fail with a message that names the command `npx playwright install chromium` WHEN the browser is missing.
14. THE test suite SHALL include property-based tests asserting that no fixture value appears in any request state, Observation, Event_Log entry or Loop_Result for generated pages that reflect the value in the URL, the title or an accessible name, that Sanitized_Text never exceeds its limit and never contains a newline or an unescaped quote, and that Change_Terms contain no Change_Stopword and no token shorter than 3 characters.
15. THE test suite SHALL include a unit test asserting that a screenshot taken after a fill carries a mask for the Filled_Field (the `mask` option is passed), and a test of the fallback of Requirement 6 criterion 8.
16. THE test suite SHALL include a round-trip test of the state text builder (Requirement 3 criterion 9): the same inputs yield byte-identical state text, and the text contains no scheme, host or port of the Target_Origin.
17. THE test suite SHALL include an architecture test asserting that no module reachable statically from `index.ts` imports `playwright` (Requirement 13 criterion 16), and a test that the Capture masks an element whose DOM text contains a fixture value (Requirement 6 criterion 9).

### Requirement 13: Browser capability

**User Story:** As a developer running `ce run`, I want the browser loop plugged into the run pipeline, so that a required Assessment on `browser_ui` produces Evidence instead of `UNSUPPORTED`.

#### Acceptance Criteria

1. THE Browser_Capability SHALL export `createBrowserCapability(deps)` from `runtime/capability.ts`, returning a `CapabilityEntry` with `name` `browser_ui`, `surfaces` `['browser_ui']` and a `run` function that is a `RuntimeHook`, WHERE `deps` holds the injectable `cwd`, `env`, `openTarget`, browser launcher, clock and Loop_Sink.
2. WHERE the caller of `run()` supplies no `capabilities` option, THE Run_Pipeline SHALL use a default registry that contains the Browser_Capability built with the `cwd` and `env` of the run (the Run_Pipeline owns these values because `RuntimeHookInput` carries neither, and its signature stays locked), replacing the empty default. A test that needs the `UNSUPPORTED` outcome SHALL pass `EMPTY_REGISTRY` explicitly (the affected test files are listed in criterion 15).
3. IF `RuntimeHookInput.runDir` is absent, THEN THE Browser_Capability SHALL throw an error whose class is `RunDirMissingError` before it calls `openTarget` and before it launches a browser, so that the Run_Pipeline resolves the run to `ERROR` with `errorStage` `runtime`, and SHALL NOT fall back to a temporary directory (CE writes evidence only in the run directory). With criterion 13 in force, this error is reachable only through a caller that invokes the capability directly without a `runDir`.
4. WHEN the Browser_Capability runs, THE Browser_Capability SHALL build the target options with `targetOptionsFromConfig(config, { cwd, env, runDir, signal })`, call `openTarget` with them, run the Runtime_Loop with `Target_Handle.baseUrl`, the `config.runtime` settings, the Fixtures, the Selected_Claim text, the Change_Terms of `context`, the gateway and the signal of the input, and call `stop()` of the Target_Handle in a `finally` block on every path, including a thrown error and an aborted signal.
5. THE Browser_Capability SHALL close the browser it launched in the same `finally` block, after the Runtime_Loop returned or threw.
6. THE Browser_Capability SHALL select exactly one Claim by this rule, applying the filters in this order: first keep only the `claims` whose `perClaim` entry has `surface` equal to `browser_ui`; from those, keep the ones whose `needed` is true, and choose the one with the highest `runtimeObservable`; WHEN none of them is needed, choose from the `browser_ui` ones the one with the highest `runtimeObservable`; WHEN no Claim has a `browser_ui` entry, choose from all `claims` the one with the highest `runtimeObservable`; WHEN two Claims tie, choose the first in `claims` order; WHEN `claims` is empty, use the text of the `subjects` entry of kind `change` as the claim text of the loop, and record the claim in the evidence as `not_identified`.
7. IF `openTarget`, the browser launch (including a missing Chromium) or the Runtime_Loop throws, THEN THE Browser_Capability SHALL let the error propagate unchanged, so that the Run_Pipeline wraps it as `StageError('runtime', cause)` and resolves the run to `ERROR`.
8. THE Browser_Capability SHALL map the Loop_Result to the `RuntimeResult` as follows: `finalState` is the `finalState` of the Loop_Result without change; `evidence.change` takes `title`, `description`, `base`, `head` and the `path` of each changed file from `context.change`; `evidence.claim` is `identified` with the `id`, `text` and `provenance` of the Selected_Claim, or `not_identified` (criterion 6); `evidence.subject.url` is `Target_Handle.baseUrl`; `evidence.actions` holds one `{ kind, description }` for each executed `click`, `fill` and `goto`, in order, with the Redactor applied; `evidence.observations` holds one `{ step, screenshot }` for each Observation, with the relative screenshot path; `evidence.artifacts.runDir` is the Run_Dir and `evidence.artifacts.reportPath` is `<runDir>/report.html`.
9. THE Browser_Capability SHALL pass the Loop_Result, the Selected_Claim and the Run_Dir to the Loop_Sink before it returns. The default Loop_Sink of the default registry is a no-op until #11 supplies one, so `ce run` does not yet persist the step log. THE Browser_Capability SHALL write no `run.json`, `report.html` or other file besides the screenshots of Requirement 8 (ownership list in the Introduction). The `reportPath` of criterion 8 is a path only: the file is written by #11.
10. FOR ALL Loop_Results with at least one Observation and a valid input, THE `RuntimeResult` of criterion 8 SHALL satisfy `satisfiesMinimumEvidence`, so that the run resolves to `EVIDENCED` and not to `ERROR` with reason `evidence-incomplete`.
11. WHILE the Assessment has `required` equal to `false`, THE Run_Pipeline SHALL NOT call the Browser_Capability, so that a `SKIPPED` run neither starts nor contacts the target (this criterion restates `runtime-target` Requirement 9 criterion 6 for the capability and adds no new behavior).
12. THE test suite SHALL include tests of the Browser_Capability with a fake `openTarget`, a fake browser, the fake gateway and a temporary Run_Dir, asserting: `stop()` is called on success, on a loop error and on an aborted signal; no target is opened and no browser launched when `runDir` is absent; the claim selection of criterion 6 for needed, not needed, tied and empty `claims`; the mapping of criterion 8 passes `satisfiesMinimumEvidence`; and an end-to-end `run()` call with the default registry and a supplied fake gateway (with a temporary `cwd`) resolves a required `browser_ui` Assessment to `EVIDENCED` with the demo-app scenario of Requirement 11.
13. WHEN the Run_Pipeline selects a capability, THE Run_Pipeline SHALL always compute `runDir` as `path.resolve(cwd, output.dir ?? '.ce/runs', runDirName(now()))` and pass it in `RuntimeHookInput`, including WHEN the caller supplied `options.gateway`. The `run()` signature, `RuntimeHookInput` and `RuntimeResult` do not change, so `runtime-target` Requirement 9 criterion 4 holds. A test only needs to pass a temporary directory as `cwd`.
14. THE Run_Pipeline SHALL create the Jev call log (`jev-calls.jsonl`) only for a gateway that the Run_Pipeline builds itself, and SHALL NOT create a call log or a Run_Dir directory for a supplied gateway beyond what the Browser_Capability writes into the Run_Dir.
15. THE change SHALL update the tests that expect `UNSUPPORTED` for `browser_ui` through the default registry, so that each passes `EMPTY_REGISTRY` explicitly or a temporary `cwd`: `run/pipeline.test.ts`, `run/command.test.ts`, `run/command.target.test.ts` and `run/resolve.property.test.ts`.
16. THE default registry SHALL load Playwright lazily: the browser launcher of the Browser_Capability SHALL call `await import('playwright')` inside `run`, and neither `run/pipeline.ts`, `runtime/capability.ts` nor `index.ts` SHALL import `playwright` statically, so that a consumer of `run()` whose Assessment is `SKIPPED`, or a machine without Chromium, never loads Playwright.
