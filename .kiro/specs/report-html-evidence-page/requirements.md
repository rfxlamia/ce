# Requirements Document

## Introduction

This feature implements GitHub issue #14 in rfxlamia/ce, "[M4] report.html — the evidence page" (label `polish`). It covers R9 criterion 4 of `docs/journal/v0.0/requirements.md` and section 9 ("Report design") of `docs/journal/v0.0/design.md`. `SPEC.md` is normative (sections 3.5, 4.2, 7.1 and 7.2) and wins on any conflict with this document or the journal.

Today a run writes `run.json`, screenshots, `target.log` and `jev-calls.jsonl` into its Run_Dir (spec `evidence-bundle`). `evidence/report/` holds only a `.gitkeep`. The Terminal_Summary prints the path of `report.html` when the file exists and falls back to the path of `run.json` otherwise (`bundle.ts`, `summary.ts`). This feature adds the Report_Generator, which turns one validated Run_Record into one self-contained `report.html`, so that a reviewer understands the run without opening `run.json`.

### Approved visual reference

The mockup `.kiro/specs/report-html-evidence-page/mockup/report.sample.html` is the approved visual reference for the Report_File. It fixes the visual direction: dark theme, an outcome-tinted Banner card with a drawn icon, the CE logo in the header, signal tags, probability bars and the step timeline. The mockup is a reference for layout and look, not a normative source. Where the mockup and `SPEC.md` disagree, `SPEC.md` wins. The data in the mockup (Change title, URLs, probabilities, model id, timings, screenshots) is fictional and carries no meaning for the implementation. Requirements 3 (criteria 10 to 18), 10 (criteria 12 to 14), 15, 16 and 17 turn the approved visual decisions into testable criteria. They state observable structure and contrast, not CSS values, except where a value is a testable threshold.

### Issue checklist traceability

| Issue checklist item | Requirements |
| --- | --- |
| One offline file: outcome banner → claims with provenance chips → assessment probability bars with the question asked → step timeline (screenshot, action, alternatives with probabilities) → final screenshot with Box highlight → logs → raw `run.json` | 1 (offline file), 2 (order), 3 (banner), 4 (claims, chips), 5 (assessment bars, question), 6 (timeline), 7 (final screenshot, Box), 8 (logs), 9 (raw `run.json`), 12 (data the report needs) |
| Dark theme by default; keyboard navigable; good contrast | 10 (including heading scale, criteria 12 to 14), 3 (tinted Banner contrast, criterion 16) |
| Classifier output always labelled as a signal, not a verdict | 11 |
| Done when: a reviewer understands the run without opening `run.json` | 13 (comprehension), 3 to 8 |
| Refs: R9.4, Design §9 | 1, 2, 11, 14 |
| Steering rules (outcome placement, `JevImageError` recoverable, fake gateway, no secrets) | 7, 11, 14, 15, 16 |
| Approved visual direction (mockup `report.sample.html`), added after the issue was written | Introduction (reference), 3 criteria 10 to 18 (Banner), 5 criterion 11 (no side stripe), 10 criteria 12 to 14 (heading scale, no one-sided accent), 17 (brand logo), 16 criteria 11 to 13 (tests) |

### Facts verified in the code

- F1. `packages/ce/src/evidence/report/` contains only `.gitkeep`. No module writes `report.html`. The header of `evidence/bundle.ts` states that the Bundle_Writer "writes no `report.html`", and `run-vertical-slice` Requirement 11 criterion 4 states that the Run_Pipeline writes no `report.html`. Both statements describe the state before this feature.
- F2. `bundle.ts` exports `REPORT_HTML_FILE = 'report.html'`. `persist()` returns `reportPath` as `<runDir>/report.html` when the Run_Dir listing taken before the write contains that name, and `<runDir>/run.json` otherwise. `discoverArtifacts` lists only `.png` files (kind `screenshot`), `target.log` (kind `log`) and `jev-calls.jsonl` (kind `jev-calls`). `report.html` is not an artifact kind.
- F3. `RunRecordSchema` (`evidence/schema.ts`, `schemaVersion` `"1"`) is a `z.discriminatedUnion('outcome', ...)` of four strict variants. `redactRunRecord` walks every string of the record through `redactSecretValues` before validation, so the validated record that `persist()` writes is already redacted.
- F4. `StepRecord` holds `step`, `url`, `title`, `action` (`kind`, `description`), `executed`, `screenshot` and `probabilities`, a `Record<string, number>` keyed by Option index, `done` and `give_up` (`loop.ts`, `StepLogEntry.probabilities`). The description of each Option is not stored in the Run_Record or in `StepLogEntry`, so the record cannot say what an alternative was.
- F5. `FinalImage` holds `model`, `error` and `screenshot`. `LoopResult.subjectBox` (`{ x, y, width, height }`, fractions of the screenshot, `x` and `y` the top-left corner) and `LoopResult.finalSignals` (`stateReachedDom`, `stateReached`) exist in `runtime/loop.ts`, but `RuntimeTrace` (`evidence/trace.ts`) and the Run_Record carry neither. `capability.ts` states that `subjectBox` "is not part of the `RuntimeResult`". The report therefore cannot draw the Box highlight from the Run_Record today.
- F6. `AssessmentReportRecord.questions` holds `idVersion`, `subjectId`, `probability` and `probabilities` for each assessment question, and no question text. Question text lives only in `jev/catalog.ts` (`CATALOG`, entries with `idVersion`), and the steering rule "All Jev question text lives in `jev/catalog.ts`" forbids another file from defining it.
- F7. `ClaimRecord.provenance` and `context.candidates[].provenance` use `provider` in `git | github | cli | junit | config | runtime`, with optional `ref` and `location`.
- F8. `FinalImage.error` is a string reason. A failed final image request is recoverable: the run resolves from text signals and the Outcome is unchanged (decision `jev-gateway-decision`, `JevImageError`). `RuntimeRecord.stopReason` is one of `done | reached | give_up | max-steps | time-budget | aborted`.
- F9. `EventLogRecord.kind` is one of `dialog | download | popup | settle | refusal`. `target.log` is listed as an artifact of kind `log` when CE started the target. The report receives no content of `target.log` or `jev-calls.jsonl` through the Run_Record, only their names.
- F10. The `ERROR` variant allows `config`, `context`, `assessment`, `subject`, `finalImage` and `runtime` to be `null`, and the Validation_Failure shape (`error.fields` non-empty, all lists empty) is a value of the `ERROR` variant.
- F11. The Outcome is decided only in `outcome/resolve.ts`. `outcome/architecture.test.ts` rule (d) fails when another non-test file assigns, returns or casts to an Outcome literal. A comparison such as `=== 'ERROR'` is allowed.
- F12. `comment.ts` already labels classifier numbers with `signal:` in the PR comment, and `summary.ts` exports `rationaleLine` for the terminal rationale.
- F13. The CE logo exists as `docs/img/logo-transparent.png` (2000x2000 px, RGBA, about 590 KB, with a large empty margin). It is not usable as is: it would add 590 KB (about 790 KB as base64) to every report. The mockup embeds a cropped (content box only) and downscaled (360 px wide) WebP of about 18 KB as a `data:` URI. The dominant logo color is about `#7490b8`.
- F14. The Action ships as a committed bundle (`action/dist/`), and `packages/ce` is built with `npm run build`. A binary file read from the source tree at run time would be missing in both unless the build or bundle carries it.

### Design implications

- I1. Requirement 12 changes the Run_Record (F4, F5, F6), so Requirement 3 criterion 3 of `evidence-bundle` applies: the `schemaVersion` literal changes, `schemas/run.schema.json` is regenerated, and the staleness test, the round-trip test and the `ajv` agreement test keep passing.
- I2. The report cannot be listed in `artifacts` of the record it is generated from. The report is derived from the validated record after `run.json` is written, and `report.html` stays outside `artifacts` (Requirement 14 criterion 3).
- I3. A failure to write `report.html` must not change the Outcome. Only the Outcome_Resolver decides the Outcome (F11), and `run.json` has already been written with the Outcome by then. The failure is therefore reported and the Terminal_Summary falls back to the `run.json` path, which F2 already supports (Requirement 14 criterion 4).
- I4. The design says screenshots are "referenced relatively" (Design §9), so "one offline file" means one HTML file with inline CSS and JavaScript and no network dependency, beside the screenshots of the same Run_Dir.

### Decisions taken in this document

- D1. The report is a pure function of one Run_Record. It reads no run input file, no environment variable and no clock, and it decides no Outcome. The only other input is the Logo_Asset, a committed constant that is the same for every run (Requirement 17).
- D2. The report is written from the validated, redacted record. The record is the only source of facts. The one added lookup is the question text, taken from `jev/catalog.ts` by `idVersion` (Requirement 5 criterion 4).
- D3. The theme is dark regardless of the viewer's `prefers-color-scheme`. A light theme and a theme switch are out of scope.
- D4. Contrast targets WCAG 2.1 level AA: 4.5:1 for text and 3:1 for non-text UI components and focus indicators. A unit test computes the ratios from the palette.
- D5. A failure to write `report.html` is non-fatal (I3).
- D6. The `ce report` command listed in the planned layout is out of scope. This feature adds no CLI command.
- D7. The logo is embedded inline as a `data:` URI from a pre-sized Logo_Asset committed under `packages/ce/src/evidence/report/`. The report never references `docs/` and never links the 590 KB original (F13).
- D8. The Banner is one card whose whole surface carries the Outcome_Tone. No card or block of the Report_File uses a one-sided colored border, side stripe or bar as an accent.
- D9. The `data:` URI exception is limited to the Logo_Asset. Screenshots are never embedded (Requirement 15 criterion 6).

## Glossary

- **Report_Generator**: The module under `packages/ce/src/evidence/report/` that builds the Report_File text from a Run_Record. It is a pure function (D1).
- **Report_File**: The file `report.html` in the Run_Dir.
- **Run_Dir**: The directory `<output.dir>/<run-id>/` of one run (spec `evidence-bundle`).
- **Run_Record**: The validated, redacted content of `run.json` (spec `evidence-bundle`).
- **Bundle_Writer**: The module `packages/ce/src/evidence/bundle.ts`.
- **Run_Pipeline**: The `run()` function and the files in `packages/ce/src/run/` that it uses.
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC section 7.1).
- **Outcome_Resolver**: The `resolveOutcome` function in `outcome/resolve.ts`, the only place where an Outcome is decided.
- **Banner**: The first section of the Report_File. It shows the Outcome, its reason and the facts that explain it.
- **Claim_Section**: The section that lists the Claims of the Run_Record.
- **Provenance_Chip**: A small label that shows the `provider` of a provenance record, with its `ref` and `location` when present.
- **Assessment_Section**: The section that shows the Assessment, its questions and its probabilities.
- **Probability_Bar**: A horizontal bar whose filled length is proportional to one probability, together with the probability as text.
- **Timeline_Section**: The section that lists the steps of the runtime loop in order.
- **Alternative**: One Option that the runtime classifier considered at a step, with its description and probability. `done` and `give_up` are Alternatives with fixed descriptions.
- **Final_Section**: The section that shows the final screenshot, the Box_Highlight and the final image status.
- **Box_Highlight**: A rectangle drawn over the final screenshot at the subject Box that the final image request returned.
- **Logs_Section**: The section that shows the event log, the stop reason and the list of log artifacts.
- **Raw_Section**: The last section. It shows the complete Run_Record as text.
- **Signal**: A probability returned by the classifier (Jev). A Signal is evidence about the classifier's reading of the state, not a verdict on the correctness of the software (SPEC section 3.5).
- **Question_Catalog**: The module `packages/ce/src/jev/catalog.ts`, the only place that defines Jev question text.
- **Contrast_Ratio**: The WCAG 2.1 relative luminance ratio of two colors.
- **Untrusted_Text**: Any string of the Run_Record that originates from the Change, the target application or the page under test, for example Claim text, page titles, URLs and Option descriptions.
- **Secret_Value**: A value that `collectSecretValues` returns for the run environment, and any match of a configured `context.redact` pattern.
- **Minimal_Record**: A Run_Record of an `ERROR` Outcome whose nullable fields are `null` (F10).
- **Logo_Asset**: The committed, pre-sized, cropped raster image of the CE logo under `packages/ce/src/evidence/report/` (Requirement 17).
- **Logo_Image**: The `<img>` element in the page header whose `src` is the Logo_Asset as a `data:` URI.
- **Outcome_Tone**: The one hue assigned to an Outcome. The four Outcomes have four distinct Outcome_Tones.
- **Outcome_Icon**: The drawn inline SVG shown next to the Outcome word in the Banner.
- **Lead_Facts**: The Change title and the Subject URL in the Banner.
- **Meta_Row**: The Banner row of secondary facts: final state, stop reason, start time, duration and CE version.
- **Type_Scale**: The font sizes of the Report_File for the body text and for heading levels 1 to 3, defined as CSS custom properties or declared sizes that a test can read.
- **Fake_Gateway**: The `FakeJevGateway` of `jev/fake.ts` (with `GatewayTestSupport`), which replays recorded answers and needs no API key.

## Requirements

### Requirement 1: One offline file

**User Story:** As a reviewer, I want one HTML file that opens without a network, so that I can inspect a run from a CI artifact, an email attachment or a local disk.

#### Acceptance Criteria

1. THE Report_Generator SHALL produce the Report_File as one UTF-8 HTML document that contains all of its CSS and JavaScript inline.
2. THE Report_File SHALL contain no `http:`, `https:` or protocol-relative (`//`) URL in a `src`, `href`, `srcset`, `action`, `@import` or `url()` position, and SHALL contain no `<link>` element that loads a stylesheet, font or script. The only `data:` URI that the Report_File SHALL contain is the `src` of the Logo_Image (Requirement 17).
3. THE Report_File SHALL reference each screenshot by the Bundle_Relative_Path of the Run_Record, as a relative URL, so that the screenshots in the same Run_Dir display when the Report_File is opened from disk.
4. THE Report_File SHALL contain a `<meta http-equiv="Content-Security-Policy">` element whose policy allows no network origin: `default-src 'none'`, inline style, inline script, and an `img-src` directive whose sources are exactly `'self'` and `data:`. The policy SHALL contain no other `img-src` source, no `connect-src`, `font-src` or `frame-src` source, and no `http:` or `https:` source.
5. IF a screenshot file referenced by the Report_File cannot be loaded by the viewer, THEN THE Report_File SHALL show the alternative text of the image, which names the screenshot path and the step number, so that a reader can find the file.
6. THE Report_File SHALL present all content of Requirements 3 to 9 in the document text, so that the Report_File is readable when JavaScript is disabled.
7. THE Report_File SHALL declare `lang="en"` and `charset` UTF-8, and SHALL set a `<title>` that contains the Outcome and the run start time of the Run_Record.

### Requirement 2: Section order

**User Story:** As a reviewer, I want the sections in a fixed order that follows the question I ask first, so that I read the answer before the detail.

#### Acceptance Criteria

1. THE Report_File SHALL present these seven sections in this order: Banner, Claim_Section, Assessment_Section, Timeline_Section, Final_Section, Logs_Section, Raw_Section.
2. THE Report_File SHALL render all seven sections for every Outcome. WHEN a section has no data for the Outcome, THE Report_File SHALL render the section heading with one line that states why it is empty, for example "No runtime steps: the run resolved SKIPPED before the runtime stage".
3. THE Report_File SHALL give each section an `id` and a heading element, and SHALL provide a navigation list of in-page links to the seven sections after the Banner.
4. THE Report_File SHALL provide each section heading as a heading element of level 2 and the document title as one heading element of level 1, so that the heading outline is a tree without skipped levels.

### Requirement 3: Outcome banner

**User Story:** As a reviewer, I want the first thing on the page to be the Outcome and why it happened, so that I know in five seconds whether evidence exists.

#### Acceptance Criteria

1. THE Banner SHALL show the `outcome` of the Run_Record as text, and SHALL show the `outcomeReason` of the Run_Record.
2. THE Banner SHALL show a one-sentence explanation of the Outcome. THE explanation for `SKIPPED` SHALL say that additional Evidence was not required, THE explanation for `UNSUPPORTED` SHALL say that Evidence was required and the available capabilities were insufficient, THE explanation for `EVIDENCED` SHALL say that runtime Evidence was collected, and THE explanation for `ERROR` SHALL say that CE did not complete (SPEC section 7.1).
3. THE Banner SHALL distinguish `SKIPPED` from `UNSUPPORTED` by text and by color, so that "not needed" and "not possible" are never shown alike.
4. WHEN the Outcome is `EVIDENCED`, THE Banner SHALL show `finalState` (`reached` or `not_reached`) and, WHEN `runtime` is present, the `stopReason`.
5. WHEN the Outcome is `UNSUPPORTED`, THE Banner SHALL show the Assessment `surface` that no available capability supports.
6. WHEN the Outcome is `ERROR`, THE Banner SHALL show `error.stage`, `error.reason` and `error.causeName`, and WHEN `error.fields` is not empty, THE Banner SHALL list the failing field paths.
7. THE Banner SHALL show the Change title (or the text "No title" when the Run_Record has none), the Subject URL (or "No subject observed"), the run start time and the run duration from `timings`, and the `ceVersion`.
8. THE Banner SHALL NOT use the color or the text of the Outcome as the only carrier of its meaning: the Outcome text SHALL appear in the document text regardless of color.
9. THE Report_Generator SHALL take the Outcome, the reason and the final state from the Run_Record and SHALL NOT compute them from any other field.
10. THE Banner SHALL be one card whose whole surface carries the Outcome_Tone: a background tint, a border on all four sides in the Outcome_Tone, and secondary text (the reason and the Meta_Row labels) tinted from the same hue. THE Banner SHALL carry its Outcome on an element attribute (for example `data-outcome`) so that a test selects the tone by Outcome.
11. THE Banner SHALL define four Outcome_Tones, one per Outcome, and the tone of `SKIPPED` and the tone of `UNSUPPORTED` SHALL differ in hue by at least 30 degrees on the HSL hue circle, so that they are distinguishable at a glance (criterion 3 still requires the text difference).
12. THE Banner SHALL show an Outcome_Icon next to the Outcome word. THE Outcome_Icon SHALL be an inline SVG drawn with a distinct shape for each Outcome, SHALL NOT be a Unicode glyph or emoji, SHALL be hidden from assistive technology (`aria-hidden="true"`) because the Outcome word carries the meaning, and SHALL use the Outcome_Tone as its stroke or fill.
13. THE Banner SHALL contain no eyebrow, kicker or label element above the Outcome word. THE Banner SHALL carry a heading element of level 2 for the document outline that is visually hidden and remains available to assistive technology.
14. THE Banner SHALL present its content in this order in the document: the Outcome word (with the Outcome_Icon), the one-sentence explanation of criterion 2, the `outcomeReason`, the Lead_Facts, the Meta_Row.
15. THE Banner SHALL render the Outcome word at the largest font size of the Report_File, the `outcomeReason` in a muted color with a line length limit of 65 characters or less (`max-width` of 60ch), the Lead_Facts at a font size larger than the Meta_Row, and the Meta_Row at the smallest font size of the Banner.
16. THE Contrast_Ratio requirements of Requirement 10 criterion 3 SHALL apply to every text and non-text color pair of the tinted Banner, measured against the tinted Banner background (the tint composed over the page background) and not against the page background. FOR ALL four Outcome_Tones, the Outcome word, the Outcome_Icon and the Banner border SHALL have a Contrast_Ratio of at least 3:1, and the explanation, the reason, the Lead_Facts and the Meta_Row text SHALL have a Contrast_Ratio of at least 4.5:1.
17. THE Banner SHALL use no one-sided border, side stripe or bar as an accent (decision D8).
18. THE Banner SHALL show the Lead_Facts as a labelled list (term and value) and the Meta_Row as a labelled list, using description-list semantics, so that each value has a visible label. THE Lead_Facts and Meta_Row values SHALL wrap long values (for example a long URL) inside the card without horizontal overflow.

### Requirement 4: Claims with provenance chips

**User Story:** As a reviewer, I want to see each Claim and where CE found it, so that I can judge whether CE verified the right thing.

#### Acceptance Criteria

1. THE Claim_Section SHALL list each Claim of `claims` with its id, its text and its Provenance_Chip.
2. THE Provenance_Chip SHALL show the `provider` of the Claim provenance, and SHALL show `ref` and `location` WHEN they are present.
3. WHEN a Claim has a `probability`, THE Claim_Section SHALL show it as a Signal (Requirement 11). WHEN the `probability` is `null`, THE Claim_Section SHALL state that the Claim was declared and carries no classifier Signal.
4. WHEN `assessment.claimStatus` is `not_identified`, THE Claim_Section SHALL state "No claim identified" and SHALL NOT show a fabricated Claim (SPEC section 7.2).
5. WHEN `context.candidates` is not empty, THE Claim_Section SHALL list the candidates that did not become a Claim in a collapsed block, each with its text and Provenance_Chip, and SHALL label them as candidates and not as Claims.
6. THE Claim_Section SHALL list the changed files of `context.change.files` with path and status, and SHALL list the `context.checks` with name and status, so that the reader sees which existing Checks were considered. THE Claim_Section SHALL NOT show patch text or commit messages, which the Run_Record does not contain.
7. WHERE `context.truncated` or `context.redactions` is not empty, THE Claim_Section SHALL state how many files were truncated, dropped or redacted, so that the reader knows the classifier saw reduced input.
8. WHEN `context` is `null`, THE Claim_Section SHALL state that the context stage did not complete.

### Requirement 5: Assessment with probability bars and the question asked

**User Story:** As a reviewer, I want to see what CE asked the classifier and what it answered, so that I can judge the Assessment without reading source code.

#### Acceptance Criteria

1. THE Assessment_Section SHALL show `required`, `decidedBy`, `surface` and `claimStatus` of the Assessment.
2. WHEN `decidedBy` is `policy`, THE Assessment_Section SHALL state that a configured policy and not a classifier decided the Assessment.
3. THE Assessment_Section SHALL show each entry of `assessment.questions` as one block with the question text, the `idVersion`, the subject (the Claim or candidate text found by `subjectId`, or the `subjectId` alone when no text matches), and the answer.
4. THE Report_Generator SHALL take the question text from the Question_Catalog entry whose `idVersion` equals the entry `idVersion`, and SHALL NOT define question text in `evidence/report/`. IF no Question_Catalog entry has that `idVersion`, THEN THE Assessment_Section SHALL show the `idVersion` and the text "question text unavailable for this version", and SHALL NOT fail.
5. WHEN a question has a `probability`, THE Assessment_Section SHALL show one Probability_Bar for it. WHEN a question has `probabilities` (a choice question), THE Assessment_Section SHALL show one Probability_Bar for each label, in descending order of probability.
6. THE Probability_Bar SHALL show the probability as text with two decimals in addition to the bar length, so that the value is available without seeing the bar.
7. THE Probability_Bar SHALL expose its value to assistive technology (for example as `role="meter"` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow` and an accessible name), and SHALL clamp the drawn length to the range 0 to 100 percent.
8. WHEN a question has `probability` `null` and `probabilities` `null`, THE Assessment_Section SHALL state that the question returned no answer.
9. THE Assessment_Section SHALL show the `perClaimProbabilities` (`runtimeObservable`, `checksAdequate`) for each Claim, and SHALL show the `settings` thresholds (`claimThreshold`, `observableThreshold`, `adequateThreshold`), the `uncertaintyBand` and `onUncertain`, so that the reader sees the line that each Signal was compared with.
10. WHEN `assessment` is `null`, THE Assessment_Section SHALL state that the assessment stage did not complete.
11. THE Assessment_Section SHALL show the question text of criterion 3 in a block set apart by a background and a border on all four sides, and SHALL use no one-sided border, side stripe or bar on the question block (decision D8).

### Requirement 6: Step timeline

**User Story:** As a reviewer, I want to see each step the runtime took, with the screenshot, the action and what else CE considered, so that I can follow the run like a recording.

#### Acceptance Criteria

1. THE Timeline_Section SHALL list the `steps` of the Run_Record in ascending order of `step`.
2. THE Timeline_Section SHALL show for each step the step number, the page `title` and `url`, the screenshot, the action `kind` and `description`, and whether the action was executed.
3. WHEN `executed` is `false`, THE Timeline_Section SHALL state that the action was not executed, and WHEN a `refusal` event with the same step number exists in `eventLog`, THE Timeline_Section SHALL show that refusal beside the step.
4. THE Timeline_Section SHALL show for each step the Alternatives that the classifier considered, each with its description and its probability as a Probability_Bar labelled as a Signal, in descending order of probability, and SHALL mark the Alternative that corresponds to the action taken.
5. WHEN a step carries no Alternatives (a step restored from an `EvidenceSummary` or a partial trace), THE Timeline_Section SHALL state "no alternatives recorded" for that step.
6. THE Timeline_Section SHALL display each screenshot at a reduced size and SHALL let the reader open the full-size image by following a link to the same relative path, with the link reachable by keyboard.
7. WHILE a step list is longer than 12 steps, THE Timeline_Section SHALL keep every step in the document and SHALL collapse the Alternatives of each step into a disclosure element that is closed by default.
8. WHEN `steps` is empty, THE Timeline_Section SHALL state why (Requirement 2 criterion 2).

### Requirement 7: Final screenshot with Box highlight

**User Story:** As a reviewer, I want to see the last screen with the subject marked, so that I can check what CE saw at the end against the Claim.

#### Acceptance Criteria

1. WHEN `finalImage.screenshot` is not `null`, THE Final_Section SHALL show that screenshot.
2. WHEN `finalImage.box` is not `null` and `finalImage.screenshot` is not `null`, THE Final_Section SHALL draw the Box_Highlight over the screenshot, positioned and sized in percent of the displayed image from the fractions `x`, `y`, `width` and `height`, so that the highlight stays aligned at every display size.
3. THE Final_Section SHALL state the Box coordinates as text (for example "x 0.25, y 0.25, width 0.50, height 0.50 of the screenshot"), and SHALL label the Box as a classifier Signal (Requirement 11).
4. THE Box_Highlight SHALL be drawn with a border that has a Contrast_Ratio of at least 3:1 against the dark page background and SHALL NOT hide the screenshot beneath it (no opaque fill).
5. IF `finalImage.error` is not `null`, THEN THE Final_Section SHALL show the screenshot without Box_Highlight and SHALL state that the final image request failed with that reason and that the Outcome was resolved from text Signals. THE Report_File SHALL NOT be omitted or marked as failed because of that error (decision `jev-gateway-decision`).
6. IF `finalImage` is `null`, or `finalImage.screenshot` is `null`, THEN THE Final_Section SHALL state that no final screenshot exists and SHALL show the screenshot of the last step instead WHEN `steps` is not empty.
7. WHEN `finalImage.box` is `null` and `finalImage.error` is `null` and a final screenshot exists, THE Final_Section SHALL state that the classifier returned no Box.
8. WHEN `finalImage.signals.stateReached` or `finalImage.signals.stateReachedDom` is not `null`, THE Final_Section SHALL show each as a Probability_Bar labelled as a Signal, with the question text taken as in Requirement 5 criterion 4.
9. THE Final_Section SHALL show `finalImage.model` (the dated Returned_Model_Id) WHEN it is not `null`.
10. IF a `box` value is outside the range 0 to 1, THEN THE Report_Generator SHALL clamp it to that range for drawing and SHALL still show the recorded value in the text of criterion 3.

### Requirement 8: Logs

**User Story:** As a reviewer, I want the runtime events and the log files listed, so that I can see dialogs, popups and refusals that a screenshot does not show.

#### Acceptance Criteria

1. THE Logs_Section SHALL list the `eventLog` entries in order, each with its step number, `kind` and `detail`.
2. WHEN `runtime` is present, THE Logs_Section SHALL show `stopReason` with a one-sentence meaning of that reason, for example that `max-steps` means the step budget ended the loop before the state was reached.
3. THE Logs_Section SHALL list every artifact of kind `log` and `jev-calls` with its relative path as a link, and SHALL state that `jev-calls.jsonl` holds the per-call Jev log with state hashes and no state text.
4. WHEN `timings` has stage durations, THE Logs_Section SHALL show the duration of each stage that has one, and "not started" for a stage with `null`.
5. WHEN `jevModels` is not empty, THE Logs_Section SHALL list each Returned_Model_Id, and WHEN it is empty, THE Logs_Section SHALL state that no Jev call returned a model id.
6. WHEN `eventLog` is empty, THE Logs_Section SHALL state "No runtime events".

### Requirement 9: Raw run.json

**User Story:** As a developer, I want the exact record at the end of the page, so that I can copy or compare the machine-readable data without leaving the report.

#### Acceptance Criteria

1. THE Raw_Section SHALL show the complete Run_Record as pretty-printed JSON with the same serialization as `run.json`.
2. THE Raw_Section SHALL be a disclosure element that is closed by default, and the relative link to `run.json` SHALL be present in the section text.
3. FOR ALL Run_Records, extracting the text of the Raw_Section from the Report_File, decoding the HTML escapes and parsing it as JSON SHALL produce a value deep-equal to the Run_Record (round-trip property).
4. THE Report_Generator SHALL escape the Raw_Section text so that no sequence in the Run_Record, including `</script>`, `<!--` and `-->`, ends or alters the element that holds it.

### Requirement 10: Dark theme, keyboard navigation and contrast

**User Story:** As a reviewer who uses a keyboard or a screen reader, or who reads in a dark room, I want a dark, high-contrast page that I can operate without a mouse, so that the report is usable by anyone on the team.

#### Acceptance Criteria

1. THE Report_File SHALL apply the dark theme by default and SHALL NOT depend on `prefers-color-scheme` or on any script to apply it (D3).
2. THE Report_File SHALL define its colors as CSS custom properties in one palette, so that the contrast check of criterion 3 reads them from one place.
3. FOR ALL pairs of a text color and the background color on which it is used in the palette, THE Contrast_Ratio SHALL be at least 4.5:1, and FOR ALL pairs of a non-text UI color (Probability_Bar fill, Box_Highlight border, focus indicator, Banner status color) and the adjacent background, THE Contrast_Ratio SHALL be at least 3:1 (D4).
4. WHILE an element is focused by keyboard, THE Report_File SHALL show a focus indicator of at least 2 CSS pixels that satisfies criterion 3, and SHALL NOT remove the default outline without replacing it.
5. THE Report_File SHALL make every interactive element (navigation links, disclosure elements, screenshot links, artifact links) reachable with the Tab key in document order and operable with Enter or Space, using native HTML elements (`a`, `details`, `summary`, `button`) and no element that has a click handler without a keyboard handler.
6. THE Report_File SHALL provide a "Skip to content" link as the first focusable element, and SHALL use landmark elements (`header`, `nav`, `main`) so that screen reader users can jump between regions.
7. THE Report_File SHALL NOT use `tabindex` with a value greater than 0.
8. THE Report_File SHALL carry the meaning of every status (Outcome, executed or not, chosen Alternative, Box) in text or an accessible name in addition to color.
9. WHERE the viewer sets `prefers-reduced-motion: reduce`, THE Report_File SHALL show no animation or transition.
10. THE Report_File SHALL remain readable at a viewport width of 360 CSS pixels without horizontal scrolling of the page body, except inside the Raw_Section text.
11. WHEN the Report_File contains JavaScript, THE JavaScript SHALL only enhance (for example a "copy JSON" button in the Raw_Section) and SHALL NOT be required to read any content (Requirement 1 criterion 6).
12. THE Report_File SHALL define a Type_Scale in which the font size of the document title (level 1) is at least 1.25 times the font size of a level 2 heading, and the font size of a level 2 heading is at least 1.25 times the font size of a level 3 heading. WHERE the 1.25 ratio between two adjacent levels is not practical, the level SHALL still differ from the next level in font size by a step of at least 1.1 times and SHALL differ in font weight, and the exception SHALL be listed in the test that checks this criterion.
13. THE Report_File SHALL render a level 3 heading at a font size larger than the body text and at a font weight of at least 600, so that level 3 headings, body text and the Banner Outcome word form distinct steps. THE body text size SHALL be at least 16 CSS pixels.
14. THE Report_File SHALL use no one-sided colored border, side stripe or bar as an accent on any card, block, question block, claim block or alert (decision D8). A border on all four sides, a background tint, or a bottom hairline that separates list rows in a table or timeline is allowed.

### Requirement 11: Classifier output is a signal, not a verdict

**User Story:** As a reviewer, I want every classifier number labelled as a signal, so that I never read a probability as a statement that the software is correct or broken (SPEC section 3.5).

#### Acceptance Criteria

1. THE Report_File SHALL label every classifier-derived value (Claim probability, assessment probabilities, Alternative probabilities, `state_reached` Signals, Box) with the word "signal" in the visible text of the element or its heading.
2. THE Report_File SHALL contain one explanatory note near the top (after the Banner) that states that classifier values are signals about the classifier's reading of the input and are not a verdict on the correctness of the software, and that the Assessment decides whether runtime Evidence is needed and not whether the Change is correct.
3. THE Report_File SHALL NOT use the words "verdict", "correct", "incorrect", "pass", "fail", "proves" or "verified" to describe a classifier-derived value. The note of criterion 2 SHALL be the only place that uses "verdict" or "correct", to say that the values are not one.
4. THE Report_File SHALL NOT show a field or a label that states a verdict on the correctness of the software.
5. THE Report_File SHALL show the Check status values `passed`, `failed` and `skipped` only as the status of an existing Check, labelled "check status" and attributed to the provider that reported it, and not as a classifier result.
6. THE Report_File SHALL contain no text generated by Jev. Every sentence of the Report_File SHALL come from the fixed templates of the Report_Generator, the Question_Catalog text, or values of the Run_Record (design rule "Jev never generates text").

### Requirement 12: Run_Record data that the report needs

**User Story:** As a reviewer, I want the report to show alternatives, the Box and the final image Signals, so that the data behind the page exists in `run.json` and not only in memory.

#### Acceptance Criteria

1. THE runtime loop SHALL keep, for each step, the Alternatives it sent to the `runtime.next_action` question: the key (Option index as a string, `done` or `give_up`), the description and the returned probability.
2. THE `StepRecord` SHALL gain an `alternatives` list in which each member holds `key`, `description` and `probability`. For a step restored from an `EvidenceSummary` or a partial trace the list SHALL be empty.
3. THE `RuntimeTrace` and `FinalImageRecord` SHALL carry the subject Box of `LoopResult.subjectBox` as `finalImage.box` with `x`, `y`, `width` and `height` (fractions in the range 0 to 1), or `null` WHEN no Box was returned.
4. THE `FinalImageRecord` SHALL carry `finalSignals` as `finalImage.signals` with `stateReachedDom` and `stateReached`, each a probability or `null`.
5. THE Run_Schema SHALL define `alternatives` (probability in the range 0 to 1), `finalImage.box` (each member in the range 0 to 1) and `finalImage.signals` as strict members, and SHALL change the `schemaVersion` literal and regenerate `schemas/run.schema.json` (Requirement 3 criterion 3 of `evidence-bundle`, I1).
6. THE Alternative `description` SHALL be the same sanitized text that the runtime already uses for the Option, and the Run_Record redaction (`redactRunRecord`) SHALL apply to it as to every string of the record.
7. THE Run_Record SHALL NOT gain a field for the screenshot bytes, the state text or a question instruction, so that the existing exclusion of state contents (steering and Requirement 9 of `evidence-bundle`) holds.
8. FOR ALL Run_Records produced by the Bundle_Writer, a standard JSON Schema validator given `schemas/run.schema.json` SHALL report no error, and the zod round-trip of `evidence-bundle` Requirement 3 criterion 8 SHALL hold for the extended shape.
9. THE added fields SHALL NOT change the Outcome, the exit code or the `jev-calls.jsonl` content of any run.

### Requirement 13: A reviewer understands the run without run.json

**User Story:** As a reviewer, I want every fact of the SPEC 7.2 minimum in the visible report, so that I never need to open `run.json` to understand a run.

#### Acceptance Criteria

1. FOR ALL Run_Records of Outcome `EVIDENCED`, THE Report_File text outside the Raw_Section SHALL contain the Change (title, base, head or file list), each Claim or "No claim identified", the Subject URL, each performed action (`kind` and `description`), each observation (a screenshot reference for every step), and the path of the Report_File's Run_Dir artifacts (SPEC section 7.2, where the Evidence can be inspected).
2. FOR ALL Run_Records of Outcome `SKIPPED`, THE Report_File text outside the Raw_Section SHALL contain the Assessment `required` value, the Signals that led to it, the thresholds they were compared with, and `outcomeReason`.
3. FOR ALL Run_Records of Outcome `UNSUPPORTED`, THE Report_File text outside the Raw_Section SHALL contain the `surface` and the statement that Evidence was required.
4. FOR ALL Run_Records of Outcome `ERROR`, including a Minimal_Record and the Validation_Failure shape, THE Report_File text outside the Raw_Section SHALL contain `error.stage`, `error.reason`, and every non-null stage content that the record carries.
5. THE Report_Generator SHALL render every Run_Record that `RunRecordSchema` accepts without throwing, including a Minimal_Record, a record whose strings are empty, and a record that has the maximum number of steps.
6. THE Report_File text outside the Raw_Section SHALL NOT omit a non-null top-level field of the Run_Record except `schemaVersion`, `artifacts` (shown in the Logs_Section as a list) and the raw `config` (shown only in the Raw_Section, with the effective Jev provider and model alias in the Logs_Section).

### Requirement 14: Generation, placement and failure handling

**User Story:** As a maintainer, I want the report written at a predictable place with predictable failure behavior, so that CI, the Terminal_Summary and the Action find it and a report problem never breaks a run.

#### Acceptance Criteria

1. WHEN the Bundle_Writer has written `run.json` successfully, THE Run_Pipeline SHALL write the Report_File to `<Run_Dir>/report.html` from the validated, redacted Run_Record, for every Outcome and for the Minimal_Bundle.
2. THE Report_Generator SHALL write the Report_File to a temporary name in the Run_Dir and rename it to `report.html`, so that a reader never finds a partial Report_File.
3. THE Report_File SHALL NOT be listed in `artifacts` of the Run_Record (I2).
4. IF the Report_Generator throws or the write of the Report_File fails, THEN THE Run_Pipeline SHALL leave the Outcome, the exit code and `run.json` unchanged, SHALL write a one-line description to stderr that holds the constructor name of the cause and no message text, and SHALL NOT call the Outcome_Resolver again (D5). THE Terminal_Summary SHALL then print the path of `run.json` as the Report_Path.
5. WHEN the Report_File was written, THE Terminal_Summary SHALL print the path of `report.html` as the Report_Path, so that the existing `Report:` line of `evidence-bundle` Requirement 8 points to an existing file.
6. WHEN the Bundle_Writer wrote no `run.json` (a failed write or the `no_bundle` summary), THE Run_Pipeline SHALL NOT write a Report_File.
7. THE Report_Generator SHALL write only inside the Run_Dir.
8. THE header comment of `evidence/bundle.ts` and the statement that the Run_Pipeline writes no `report.html` (F1) SHALL be updated to state that the Report_Generator writes `report.html` after the Bundle_Writer.
9. THE Report_Generator SHALL import no Jev gateway, SDK or `fetch`, and SHALL import from `jev/` only the read-only question text lookup of the Question_Catalog (Requirement 5 criterion 4).

### Requirement 15: Safety of the rendered page

**User Story:** As a maintainer, I want the report to be safe to open even when the Change or the page under test contains hostile text, and free of secrets, so that sharing a CI artifact does not leak credentials or run attacker script.

#### Acceptance Criteria

1. THE Report_Generator SHALL HTML-escape every Untrusted_Text value (`&`, `<`, `>`, `"`, `'`) before it enters an element text or an attribute value.
2. THE Report_Generator SHALL build a screenshot or artifact URL only from a Bundle_Relative_Path, SHALL percent-encode each path segment, and SHALL NOT emit a `javascript:` URL. THE Report_Generator SHALL emit a `data:` URL only for the Logo_Image, built from the Logo_Asset and never from a Run_Record value.
3. FOR ALL Run_Records whose strings contain `<script>`, `</script>`, `<img onerror=...>`, a `javascript:` URL, an attribute-breaking quote or an HTML comment opener, THE Report_File SHALL contain none of those sequences unescaped outside the inline script and style that the Report_Generator itself emits.
4. THE Report_File SHALL contain no Secret_Value. FOR ALL Run_Records that `redactRunRecord` produced for a generated secret, THE Report_File text SHALL NOT contain the secret.
5. THE Report_Generator SHALL read no environment variable and SHALL embed no API key, header or credential.
6. THE Report_File SHALL embed no screenshot bytes, so that the Report_File size grows with the text of the record and not with the images. The Logo_Image is the only embedded image and adds a constant size (Requirement 17 criterion 2, decision D9).

### Requirement 16: Determinism and verification without an API key

**User Story:** As a maintainer, I want the report to be reproducible and testable in CI without a key, so that regressions are caught cheaply.

#### Acceptance Criteria

1. THE Report_Generator SHALL be a pure function of the Run_Record: FOR ALL Run_Records, generating the Report_File twice SHALL produce byte-identical text, and the text SHALL contain no time or random value that is not in the Run_Record.
2. THE Report_Generator SHALL decide no Outcome, and the architecture test of `outcome/architecture.test.ts` (rule (d)) SHALL keep passing for the files under `evidence/report/`.
3. THE test suite SHALL include property tests (fast-check) for: section order and presence for every Outcome (Requirements 2, 13), escaping of hostile text (Requirement 15), no secret in the output (Requirement 15 criterion 4), the Raw_Section round-trip (Requirement 9 criterion 3), determinism (criterion 1), and the absence of external URLs (Requirement 1 criterion 2).
4. THE test suite SHALL include unit tests that read the palette and assert the Contrast_Ratio thresholds of Requirement 10 criterion 3, and that assert the focusable-element and landmark rules of Requirement 10 criteria 5 to 7 on the generated document.
5. THE test suite SHALL include a test that every classifier-derived value of a sample record is labelled "signal" and that the forbidden words of Requirement 11 criterion 3 do not appear outside the explanatory note.
6. THE test suite SHALL include an end-to-end test that runs `run()` with the Fake_Gateway (`jev/fake.ts` and `GatewayTestSupport`), a temporary Run_Dir and no API key, for an `EVIDENCED` run with a Box answer, and asserts that `report.html` exists, that the Terminal_Summary names it, and that the Box_Highlight is present.
7. THE test suite SHALL include a case in which the Fake_Gateway raises `JevImageError` for the final image request (the multipart 400 case of the steering), and asserts that the run stays `EVIDENCED`, that `finalImage.error` is set, and that the Report_File shows the screenshot with no Box_Highlight and states the failure (Requirement 7 criterion 5).
8. THE test suite SHALL include a case in which the write of `report.html` fails, and asserts Requirement 14 criterion 4.
9. THE test suite SHALL include one rendered `report.html` per Outcome as a committed fixture or snapshot of the document structure, so that a reviewer of the implementation pull request can open it in a browser. A manual check of the dark theme and of keyboard navigation on the `examples/demo-app` run SHALL be listed in the pull request checklist.
10. THE implementation pull request SHALL reference issue #14 so that merging it closes the issue, and SHALL map each checklist item of the issue to the tests of this requirement.
11. THE test suite SHALL include a test of the Logo_Asset: the file decodes as an image of the declared format, its encoded size is at most 40960 bytes, its pixel dimensions equal the `width` and `height` of the Logo_Image, the Report_File contains it as exactly one `data:` URI, and the no-network check of Requirement 1 criterion 2 and the CSP check of Requirement 1 criterion 4 still pass on the generated document.
12. THE test suite SHALL include a Banner test that, FOR ALL four Outcomes, asserts the structure of Requirement 3 criteria 10 to 18 (tone attribute, distinct SVG icon with `aria-hidden`, no eyebrow element, hidden level 2 heading, content order, no one-sided border on the Banner) and computes the Contrast_Ratio of Requirement 3 criterion 16 from the palette, including the tint composition, for all four tones.
13. THE test suite SHALL include a test that reads the Type_Scale and asserts Requirement 10 criteria 12 and 13, and a test that asserts Requirement 10 criterion 14 over the document style (no `border-left`, `border-right`, `border-top` or `border-bottom` declaration with a colored accent on a card or block selector, and no `::before` or `::after` bar used as a side stripe).

### Requirement 17: Brand logo in the header

**User Story:** As a reviewer, I want the report to carry the CE logo, so that I recognize the report as CE output, while the report stays one small offline file.

#### Acceptance Criteria

1. THE Report_Generator SHALL obtain the logo from the Logo_Asset, a committed raster file under `packages/ce/src/evidence/report/` that is cropped to the content box of `docs/img/logo-transparent.png` and downscaled to a width of at most 400 CSS pixels, and SHALL NOT reference, read or link `docs/img/logo-transparent.png` or any file under `docs/` (decision D7, F13).
2. THE encoded size of the Logo_Asset SHALL be at most 40960 bytes (40 KB). THE Logo_Asset SHALL use a format that the supported browsers decode natively (WebP or PNG) and SHALL keep a transparent background.
3. THE Report_Generator SHALL embed the Logo_Asset in the Report_File inline as a base64 `data:` URI in the `src` of exactly one Logo_Image in the page `header`, so that the Report_File stays one offline file (Requirement 1).
4. THE Logo_Image SHALL carry the `alt` text "CE, continuous evidence", and SHALL carry explicit `width` and `height` attributes that equal the pixel dimensions of the Logo_Asset, so that the page does not shift layout when the image decodes.
5. THE Logo_Image SHALL be decorative branding. THE Logo_Image SHALL carry no run information: the Outcome, Claim text, URLs and probabilities SHALL NOT appear in the image, in its `alt` text or in a `data-` attribute of the image, and the `alt` text SHALL be the same for every run and every Outcome.
6. IF the Logo_Image fails to load or decode, THEN THE Report_File SHALL remain fully readable and operable: every section of Requirements 3 to 9 SHALL render, the layout SHALL not overflow, and the `alt` text SHALL show in place of the image. THE Report_File SHALL NOT depend on the Logo_Image for any content, navigation or script.
7. THE Logo_Image SHALL have a Contrast_Ratio of at least 3:1 between the dominant logo color (about `#7490b8`) and the page background color of the palette (Requirement 10 criterion 2). THE test of Requirement 16 criterion 11 SHALL compute this ratio from the palette and the declared dominant logo color, and SHALL fail when the ratio is below 3:1.
8. THE Logo_Asset SHALL be available to the Report_Generator at run time in the built package (`npm run build`) and in the committed Action bundle (`action/dist/`), so that the Report_File contains the Logo_Image when generated from either (F14). IF the Logo_Asset cannot be loaded, THEN THE Report_Generator SHALL still produce the Report_File without the Logo_Image and SHALL NOT throw, and the Run_Pipeline SHALL leave the Outcome and the exit code unchanged.
9. THE Logo_Asset SHALL be the same bytes for every run, so that Requirement 16 criterion 1 (byte-identical output for the same Run_Record) holds with the Logo_Image included.
10. THE Logo_Image SHALL NOT be a fixed decorative size that crowds the heading at a viewport width of 360 CSS pixels: the header SHALL wrap the logo and the document title without horizontal scrolling (Requirement 10 criterion 10).
