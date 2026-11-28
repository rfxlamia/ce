# Implementation Plan: report.html evidence page

## Overview

This plan implements GitHub issue #14, "[M4] report.html — the evidence page". Language: TypeScript (Node 22, npm workspaces, vitest, fast-check), as in `design.md`. The implementation pull request must reference `Closes #14` and must satisfy all three issue checklist items:

1. One offline file with sections in order: banner, claims with provenance chips, assessment probability bars with the question asked, step timeline (screenshot, action, alternatives with probabilities), final screenshot with Box highlight, logs, raw `run.json`.
2. Dark theme by default, keyboard navigable, good contrast.
3. Classifier output always labelled as a signal, not a verdict.

Done when a reviewer understands the run without opening `run.json`.

Order of work: extend the Run_Record so the data exists (task 1), add the catalog lookup (task 2), build the pure rendering primitives (task 3), the seven sections (task 5), the document shell and `render` (task 7), then the writer, the pipeline wiring with the non-fatal failure path and the stale-comment updates (task 8). Task 9 is the final gate. All new files live under `packages/ce/src/evidence/report/` unless stated. Tests use `jev/fake.ts` and need no API key. No new npm dependency is added.

## Tasks

- [x] 1. Extend the Run_Record with alternatives, final Box and final signals
  - [x] 1.1 Extend `evidence/schema.ts`
    - Bump `SCHEMA_VERSION` from `'1'` to `'2'`
    - Add `alternatives` (`key`, `description`, `probability` 0 to 1, strict) to `StepRecord`
    - Add `FractionBox` and `finalImage.box` (nullable) and `finalImage.signals` (`stateReachedDom`, `stateReached`, each nullable 0 to 1) to `FinalImage`
    - _Requirements: 12.2, 12.3, 12.4, 12.5_

  - [x] 1.2 Carry the new facts from the runtime loop into the record
    - In `runtime/loop.ts`, keep for each step the Alternatives sent to `runtime.next_action` (key, `Option.description`, probability) on `StepLogEntry`
    - In `evidence/trace.ts`, add `alternatives` to `RuntimeTraceStep` and optional `finalBox` and `finalSignals` to `RuntimeTrace`
    - In `runtime/capability.ts` (`mapLoopResultToRuntimeResult`), copy `LoopResult.subjectBox` and `LoopResult.finalSignals` into the trace
    - In `evidence/build.ts`, copy them in `fromTrace`; set `alternatives: []` in `fromEvidenceSummary` and `fromPartial`; always write `finalImage.signals` as an object with nullable members
    - Confirm the Alternative description carries the fixture key only, never a fixture value, and passes through `redactRunRecord`
    - Confirm Outcome, exit code and `jev-calls.jsonl` content are unchanged
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.9_

  - [x] 1.3 Update arbitraries, regenerate `schemas/run.schema.json`, repair existing tests
    - Extend `evidence/arbitraries.ts` generators with `alternatives`, `finalImage.box` and `finalImage.signals`
    - Run `npm run generate:run-schema` and commit the regenerated `schemas/run.schema.json`
    - Update existing tests and fixtures that hold `schemaVersion: '1'` or build `StepRecord` / `FinalImage` by hand, so `json-schema.staleness.test.ts`, the round-trip test and the ajv agreement test pass
    - Check `action/src/run-dir.ts` still treats a non-matching old record as "no record" without throwing
    - _Requirements: 12.5, 12.8_

  - [x] 1.4 Write property test for the extended schema
    - **Property 13: The extended Run_Record shape round-trips and agrees with its JSON Schema**
    - Extend `schema.roundtrip.property.test.ts` and `schema.ajv-agreement.property.test.ts` so generated records include the new fields
    - **Validates: Requirements 12.5, 12.8**

  - [x] 1.5 Write unit tests for `build.ts` carry-through
    - Cases: `fromTrace` copies alternatives, box and signals; `fromEvidenceSummary` and `fromPartial` give `alternatives: []`; `finalImage.signals` is never `null`
    - _Requirements: 12.2, 12.3, 12.4_

- [x] 2. Add the read-only question text lookup to the catalog
  - [x] 2.1 Add `questionTextFor(idVersion)` to `jev/catalog.ts`
    - Build an `idVersion -> instructions` map from `CATALOG`; call `build([])` for `runtime.next_action` only
    - Return `undefined` for an unknown `idVersion`
    - Define no question text anywhere else
    - _Requirements: 5.4, 14.9_

  - [x] 2.2 Write unit tests for `questionTextFor`
    - Cases: every catalog entry resolves to non-empty text; an unknown or retired `idVersion` returns `undefined`
    - _Requirements: 5.4_

- [x] 3. Build the pure rendering primitives
  - [x] 3.1 Create `evidence/report/escape.ts`
    - Export `escapeHtml`, `escapeAttr`, `hrefFor` (percent-encode each path segment, return a safe placeholder for a `javascript:`-looking input, never throw) and `rawJsonScriptSafe` (HTML-escape, then `</` to `<\/`)
    - Add a test-only inverse used by the round-trip test
    - _Requirements: 9.4, 15.1, 15.2, 15.3_

  - [x] 3.2 Create `evidence/report/palette.ts` and `evidence/report/signal.ts`
    - `PALETTE` with the dark tokens, four distinct `outcomeTones`, `bar`, `barTrack`, `box`, `focus` and `logoDominant`
    - `signalBar` (clamp drawn length and `aria-valuenow` to 0 to 100 percent, two-decimal text, `role="meter"` with accessible name, "no answer" text for `null`) and `signalLabel` (the word "signal")
    - _Requirements: 3.11, 5.6, 5.7, 5.8, 10.2, 10.3, 11.1_

  - [x] 3.3 Add the Logo_Asset
    - Commit `evidence/report/logo.webp`: cropped to the content box of `docs/img/logo-transparent.png`, at most 400 px wide, transparent, at most 40960 bytes (made once by hand with `sips` and `cwebp`, no new dependency)
    - Create `evidence/report/logo.ts` exporting `LOGO_DATA_URI`, `LOGO_WIDTH`, `LOGO_HEIGHT` and `LOGO_ALT` (`'CE, continuous evidence'`) as committed source constants
    - Never read or link anything under `docs/`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.8, 17.9_

  - [x] 3.4 Write unit tests for `escape.ts`
    - Cases: each of `& < > " '` is escaped; `hrefFor` percent-encodes segments and rejects `javascript:`; `rawJsonScriptSafe` neutralises `</script>`, `<!--`, `-->`
    - _Requirements: 9.4, 15.1, 15.2, 15.3_

  - [x] 3.5 Write `report.palette.test.ts`
    - Compute WCAG contrast from `PALETTE`: text pairs at least 4.5:1, non-text pairs at least 3:1, `SKIPPED` vs `UNSUPPORTED` hue distance at least 30 degrees
    - Compute the tinted Banner backgrounds with the same blend `document.ts` uses, for all four tones (Outcome word, icon and border at least 3:1; explanation, reason, Lead_Facts and Meta_Row text at least 4.5:1)
    - Assert `logoDominant` vs `bg` at least 3:1
    - _Requirements: 3.16, 10.3, 17.7, 16.4, 16.12_

  - [x] 3.6 Write `report.logo.test.ts`
    - Decode `logo.webp`; assert format, size at most 40960 bytes, pixel dimensions equal `LOGO_WIDTH` and `LOGO_HEIGHT`, and `LOGO_DATA_URI` decodes to the same bytes as the file
    - _Requirements: 17.2, 17.4, 16.11_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the seven sections
  - [x] 5.1 Create `sections/banner.ts`
    - One card with `data-outcome`, tinted whole surface, four-sided border, drawn `aria-hidden` SVG icon per Outcome, visually hidden level 2 heading, no eyebrow
    - Content order: Outcome word, one-sentence explanation, `outcomeReason`, Lead_Facts, Meta_Row, both as description lists; `max-width` 60ch on the reason; long values wrap
    - Outcome-specific facts: `finalState` and `stopReason` (EVIDENCED), `surface` (UNSUPPORTED), `error.stage`, `reason`, `causeName` and `fields` (ERROR); "No title" and "No subject observed" fallbacks
    - Read the Outcome from the record; assign no Outcome literal
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.12, 3.13, 3.14, 3.15, 3.17, 3.18_

  - [x] 5.2 Write `report.banner.test.ts`
    - For all four Outcomes assert tone attribute, distinct `aria-hidden` icon, no eyebrow, hidden level 2 heading, content order, no one-sided border
    - Assert `SKIPPED` and `UNSUPPORTED` differ in text and tone
    - _Requirements: 3.3, 3.10, 3.12, 3.13, 3.14, 3.17, 16.12_

  - [x] 5.3 Create `sections/claims.ts`
    - Claim list with id, text, Provenance_Chip (`provider`, `ref`, `location`); Claim probability as a signal or "declared, no classifier signal"
    - "No claim identified" branch; collapsed candidate list labelled as candidates; changed files and checks tables with "check status" wording; truncation and redaction counts; `context` null message
    - Show no patch text or commit message
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 11.5_

  - [x] 5.4 Write property test for the Claim_Section
    - **Property 9: Claims and candidates are shown without fabrication or leaked patch text**
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 4.6, 4.8**

  - [x] 5.5 Create `sections/assessment.ts`
    - `required`, `decidedBy` (policy statement), `surface`, `claimStatus`; one block per question with question text from the injected lookup, `idVersion`, subject text and answer
    - Fallback "question text unavailable for this version" for an unknown `idVersion`; one bar per probability or per label in descending order; "returned no answer" branch
    - `perClaimProbabilities`, `settings` thresholds, `uncertaintyBand`, `onUncertain`; `assessment` null message
    - Question block uses a background and a four-sided border
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_

  - [x] 5.6 Write property test for question text resolution
    - **Property 6: Question text is always resolved or safely defaulted**
    - **Validates: Requirements 5.3, 5.4, 7.8**

  - [x] 5.7 Write property test for probability display
    - **Property 7: Probability values are always shown within range**
    - **Validates: Requirements 5.6, 5.7, 5.8, 6.4, 6.5**

  - [x] 5.8 Create `sections/timeline.ts`
    - Steps in ascending `step` order with number, title, URL, screenshot (reduced size, link to full size), action kind and description, `executed`
    - "Not executed" text paired with the matching `refusal` event; Alternatives in descending probability with the taken one marked; "no alternatives recorded" branch; Alternatives collapsed when over 12 steps; empty-steps message
    - Alt text names the screenshot path and step number
    - _Requirements: 1.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 5.9 Write property test for the timeline
    - **Property 10: The step timeline always orders steps correctly and marks the taken alternative**
    - **Validates: Requirements 6.1, 6.2, 6.4, 6.5**

  - [x] 5.10 Create `sections/final.ts`
    - Final screenshot, Box_Highlight positioned in percent with values clamped to 0 to 1, no opaque fill, border at least 3:1
    - Box coordinates as text with the recorded unclamped values, labelled as a signal; `finalImage.error` branch (no highlight, failure reason, Outcome resolved from text signals); no-Box message; last-step screenshot fallback; `stateReached` and `stateReachedDom` bars with catalog question text; `model` display
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_

  - [x] 5.11 Write property test for the Box_Highlight
    - **Property 8: The Box_Highlight is always clamped but the recorded value is always shown verbatim**
    - **Validates: Requirements 7.10, 7.3**

  - [x] 5.12 Create `sections/logs.ts`
    - Event table (step, kind, detail) or "No runtime events"; `stopReason` with a one-sentence meaning
    - Links for artifacts of kind `log` and `jev-calls` with the no-state-text statement; stage durations or "not started"; `jevModels` list or the no-model message; effective Jev provider and model alias from `config`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 13.6_

  - [x] 5.13 Write unit tests for the Logs_Section
    - Cases: each `stopReason` sentence, empty event log, `null` stage timing, empty `jevModels`
    - _Requirements: 8.2, 8.4, 8.5, 8.6_

  - [x] 5.14 Create `sections/raw.ts`
    - A closed `<details>` with a `<pre id="rawjson">` holding `JSON.stringify(record, null, 2)` through `rawJsonScriptSafe`, a relative link to `run.json`, and a "Copy JSON" button that reads `textContent`
    - _Requirements: 9.1, 9.2, 9.4, 10.11_

  - [x] 5.15 Write property test for the Raw_Section
    - **Property 4: The Raw_Section round-trips the record**
    - **Validates: Requirements 9.1, 9.3, 9.4**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Assemble the document and the pure `render` function
  - [x] 7.1 Create `evidence/report/document.ts`
    - Page shell: `lang="en"`, UTF-8, `<title>` with Outcome and start time, the exact CSP meta (`default-src 'none'`, inline style and script, `img-src 'self' data:`), `:root` custom properties rendered from `PALETTE`, dark theme with no `prefers-color-scheme` dependency
    - Skip link as the first focusable element, `header` with the one Logo_Image (`alt`, `width`, `height` from the constants, wraps at 360 px), `nav` with the seven in-page links, `main`, level 1 title, one explanatory signal note after the Banner
    - Type scale (level 1 over level 2 over level 3 over body, body at least 16 px, level 3 weight at least 600), visible focus outline of at least 2 px, `prefers-reduced-motion` handling, no `tabindex` above 0, no one-sided colored border or `::before` / `::after` side stripe
    - One inline `<script>` for the "Copy JSON" button only
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7, 2.3, 2.4, 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14, 11.2, 17.3, 17.4, 17.6, 17.10_

  - [x] 7.2 Create `evidence/report/render.ts` and `evidence/report/index.ts`
    - `render(record, deps = { questionText: questionTextFor })` calls the seven sections in order inside the shell, shows the "empty because" line for each section without data, and is total and pure (no env, clock, random, I/O, SDK or `fetch`)
    - Import nothing from `jev/` except `questionTextFor`, and nothing by value from `runtime/`
    - Re-export `render`, `writeReportFile` and the types the pipeline needs
    - _Requirements: 2.1, 2.2, 13.1, 13.2, 13.3, 13.4, 13.5, 14.9, 15.5, 16.1, 16.2_

  - [x] 7.3 Write property test for section presence and order
    - **Property 1: The document never omits a required section**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 13.5**

  - [x] 7.4 Write property test for offline output
    - **Property 2: No network URL ever appears**
    - Use hostile-string generators; assert exactly one `data:` URI and the CSP `img-src` sources
    - **Validates: Requirements 1.2, 1.4, 15.2**

  - [x] 7.5 Write property test for escaping
    - **Property 3: Hostile text is always escaped**
    - **Validates: Requirements 15.1, 15.3**

  - [x] 7.6 Write property test for determinism
    - **Property 5: Rendering is deterministic**
    - **Validates: Requirements 16.1, 17.9**

  - [x] 7.7 Write property test for signal wording
    - **Property 11: Classifier values are always labelled "signal" and the forbidden words never leak**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

  - [x] 7.8 Write property test for totality
    - **Property 12: `render` never throws on any schema-accepted record**
    - Include a Minimal_Record, all-empty strings and the maximum step count
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6**

  - [x] 7.9 Write property test for secrets in the output
    - Generate secret values, run `redactRunRecord`, render, and assert the secret never appears in the document
    - Reuse the arbitraries of `redact.no-secrets.property.test.ts`
    - _Requirements: 15.4, 16.3_

  - [x] 7.10 Write `report.keyboard.test.ts`
    - With `happy-dom`: skip link is the first focusable element, only native `a`, `details`, `summary` and `button` are interactive, no `tabindex` above 0, `header`, `nav` and `main` landmarks exist, level 1 appears once with no skipped heading level
    - _Requirements: 2.4, 10.5, 10.6, 10.7, 16.4_

  - [x] 7.11 Write `report.style.test.ts`
    - Read the emitted `<style>`: type scale ratios (with the listed exceptions), body size and level 3 weight, no `border-left`, `border-right`, `border-top` or `border-bottom` accent on card or block selectors, no `::before` or `::after` side stripe, no `prefers-color-scheme`, a `prefers-reduced-motion` rule, and `:root` tokens equal to `PALETTE`
    - _Requirements: 10.1, 10.9, 10.12, 10.13, 10.14, 16.13_

  - [x] 7.12 Write `report.signal-words.test.ts`
    - One hand-written record with every classifier field populated: each value is labelled "signal", forbidden words appear only in the explanatory note, check statuses are labelled "check status", and the note is present after the Banner
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 16.5_

  - [x] 7.13 Write `report.document.test.ts`
    - Assert exactly one Logo_Image with the fixed `alt`, `width` and `height` in `header`, the same bytes for every Outcome, exactly one `data:` URI, the exact CSP string, `lang`, charset, and a `<title>` holding Outcome and start time
    - _Requirements: 1.4, 1.7, 17.3, 17.4, 17.5, 17.9, 16.11_

- [x] 8. Write the file, wire the pipeline, update the stale statements
  - [x] 8.1 Create `evidence/report/write.ts`
    - `writeReportFile(runDir, text, fs)` writes `report.html.tmp` then renames it to `report.html`; `ReportFs` is a subset of `BundleFs`; the path is always `path.join(runDir, REPORT_HTML_FILE)`
    - _Requirements: 14.2, 14.7_

  - [x] 8.2 Return the validated record from the bundle writer and fix its header comment
    - Add `record: RunRecord` to the `ok: true` branch of `WriteBundleResult` in `evidence/bundle.ts` (both `writeBundle` and `writeMinimalBundle`); leave `persist()` detection logic unchanged
    - Replace the header statement that the Bundle_Writer "writes no `report.html`" with one saying the Report_Generator writes `report.html` after the Bundle_Writer
    - Keep `report.html` out of `artifacts`
    - _Requirements: 14.3, 14.8_

  - [x] 8.3 Wire the Report_Generator into `run/pipeline.ts`
    - In `finishRunWithBundle`, `configFailureWithBundle` and `recover`, after `written.ok` and before `withBundle`, call `render(written.record)` and `writeReportFile` in a try/catch
    - On success set the Report_Path to `report.html`; on a throw write one stderr line holding only the cause constructor name (via `causeNameOf`), leave the Outcome, exit code and `run.json` untouched, never call `resolveOutcome` again, and keep the `run.json` Report_Path
    - Skip the report step entirely when `written.ok` is `false`
    - Confirm the Terminal_Summary prints the existing `Report:` line with the right path
    - _Requirements: 14.1, 14.4, 14.5, 14.6_

  - [x] 8.4 Update the stale statements in the `run-vertical-slice` spec
    - In `.kiro/specs/run-vertical-slice/requirements.md`, reword Requirement 11 criterion 4 so it says the Run_Pipeline writes `report.html` through the Report_Generator after `run.json` (reference `report-html-evidence-page`)
    - Make the matching wording changes in `.kiro/specs/run-vertical-slice/design.md` (the line saying the call log writes no `run.json` or `report.html`) and in the matching `tasks.md` bullet
    - _Requirements: 14.8_

  - [x] 8.5 Write `report.write.test.ts`
    - Cases: tmp name then rename; no partial `report.html` on failure; one injected `rename` rejection; writes only inside `runDir`
    - _Requirements: 14.2, 14.7, 16.8_

  - [x] 8.6 Write `pipeline.report.integration.test.ts`
    - Use `FakeJevGateway` and `GatewayTestSupport`, a temp Run_Dir and no API key
    - EVIDENCED run with a Box answer: `report.html` exists, the summary names it, the Box_Highlight is present
    - `JevImageError` on the final image (multipart 400 case): run stays EVIDENCED, `finalImage.error` set, report shows the screenshot with no Box_Highlight and states the failure
    - Injected `fs.rename` failure: Outcome, exit code and `run.json` unchanged, one stderr line, summary falls back to the `run.json` path
    - Failed `run.json` write: no `report.html` written
    - `report.html` absent from `artifacts`
    - _Requirements: 7.5, 14.1, 14.3, 14.4, 14.5, 14.6, 16.6, 16.7, 16.8, 12.9_

  - [x] 8.7 Add per-Outcome fixtures and the PR checklist
    - Add a small script that renders four representative records (one per Outcome) into committed fixture `report.html` files under a `fixtures/` directory next to the tests, plus a structure snapshot test over them
    - Create `.ce/pr-checklist-issue-14.md` in the format of the existing `.ce/pr-checklist-issue-*.md`: `Closes #14`, the manual dark-theme and keyboard check against `examples/demo-app`, and a table mapping each issue checklist item to its tests
    - _Requirements: 16.9, 16.10_

- [x] 9. Final checkpoint - build, typecheck, test, and confirm each issue checklist item
  - Run `npm run build`, `npm run typecheck` and `npm test` from the repository root; confirm `outcome/architecture.test.ts` passes for the new `evidence/report/` files and `json-schema.staleness.test.ts` passes with the regenerated `schemas/run.schema.json`
  - Confirm `action/dist/` still builds with the logo constant bundled (`scripts/build-action.mjs`), and that `report.html` contains the Logo_Image when generated from the Action bundle
  - Confirm each issue #14 checklist item against a named test and record the mapping in `.ce/pr-checklist-issue-14.md`:
    - One offline file, section order and content: `report.write.test.ts`, `pipeline.report.integration.test.ts`, Property 1 (7.3), Property 2 (7.4), Property 4 (5.15), Property 12 (7.8), `report.document.test.ts`, section tests 5.2, 5.4, 5.6, 5.9, 5.11, 5.13
    - Dark theme, keyboard navigation, contrast: `report.palette.test.ts`, `report.keyboard.test.ts`, `report.style.test.ts`, `report.logo.test.ts`
    - Signal, not verdict: Property 11 (7.7), `report.signal-words.test.ts`, Property 7 (5.7)
    - Done when a reviewer understands the run without `run.json`: Property 12 (7.8), Property 1 (7.3), the four per-Outcome fixtures of 8.7
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP. Because the issue's "done" check relies on them, skipping them means the final checkpoint mapping cannot be completed.
- Each task cites the requirement criteria it covers for traceability.
- The mockup `.kiro/specs/report-html-evidence-page/mockup/report.sample.html` is a visual reference only. Its data is fictional.
- `SPEC.md` wins over this plan on any conflict. The Outcome is decided only in `outcome/resolve.ts`; no report file assigns, returns or casts an Outcome literal.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "3.2", "3.3"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "3.4", "3.5", "3.6"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["5.1", "5.3", "5.5", "5.8", "5.10", "5.12", "5.14", "8.1", "8.2"] },
    { "id": 5, "tasks": ["5.2", "5.4", "5.6", "5.7", "5.9", "5.11", "5.13", "5.15", "8.4", "8.5"] },
    { "id": 6, "tasks": ["6"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["7.2"] },
    { "id": 9, "tasks": ["7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "7.9", "7.10", "7.11", "7.12", "7.13", "8.3"] },
    { "id": 10, "tasks": ["8.6", "8.7"] },
    { "id": 11, "tasks": ["9"] }
  ]
}
```
