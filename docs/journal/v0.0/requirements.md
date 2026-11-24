# Requirements — Continuous Evidence v0

> Journal v0.0 — broad requirements covering all milestones (core → polish).
> Kiro specs under `.kiro/` are derived from this per issue.

Source of truth: [`SPEC.md`](../../../SPEC.md) v0.1. This document turns the
SPEC into testable requirements for the reference implementation. Where the two
disagree, SPEC.md wins and this file must be corrected.

Acceptance criteria use EARS notation. "CE" means the `continuous-evidence`
CLI/core. "Jev" means TypeSafe's hosted System One classifier.

## Introduction

CE closes the gap between "the change passed its checks" and "we have seen the
change behave at runtime". It decides, per change, whether extra runtime
evidence is warranted; when it is, it drives a browser with bounded,
classifier-made decisions and packages what it observed into an inspectable
evidence bundle. CE v0 is browser-first and invocation-agnostic (CLI, CI,
skill, plugin).

Non-goals for v0: compliance-grade evidence, non-browser capabilities, a
keyless/alternative classifier, acting as a merge or deploy gate by default,
writing to the target app or to Git.

---

## R1 — Invocation and zero-config start

**User story:** As a developer, I want to run `ce run` in my repo with no setup
beyond a Jev key and a URL, so that trying CE costs me under two minutes.

1. WHEN the user runs `ce run` with a Jev credential set and a target URL
   available (flag, config, or env) THEN CE SHALL execute the full pipeline
   without requiring a config file.
2. WHEN no Jev credential is available (`OPENROUTER_API_KEY` for the default
   `openrouter` provider, or `TYPESAFE_API_KEY` for the `typesafe` provider)
   THEN CE SHALL resolve to `ERROR` with a message naming the variable and how
   to obtain a key.
3. WHEN the user runs `ce init` THEN CE SHALL write a commented `ce.yml` with
   detected defaults (dev script, port, framework hints) and SHALL NOT
   overwrite an existing file without `--force`.
4. CE SHALL expose the same pipeline programmatically (`run(options)`) so that
   CLI, GitHub Action, skills and plugins share one code path.

## R2 — Configuration (`ce.yml`)

**User story:** As a maintainer, I want to customize CE in one small YAML file,
the way I configure CI, so that behaviour is reviewable in a PR.

1. CE SHALL load `ce.yml` (or `.ce.yml`) from the working directory when
   present, and validate it against a published JSON Schema.
2. WHEN validation fails THEN CE SHALL resolve to `ERROR` and print the field
   path, the offending value and the expected shape.
3. CE SHALL apply precedence: CLI flags > environment > `ce.yml` > defaults.
4. CE SHALL allow configuring: target (url, optional start command, readiness),
   context filters and redaction patterns, assessment thresholds and
   uncertainty policy, runtime limits (max steps, timeouts, viewport), the
   pinned Jev model, output directory, and which outcomes fail the process.
5. CE SHALL record the effective (merged) configuration in the evidence
   bundle, with secrets removed.

## R3 — Context resolution

**User story:** As a developer, I want CE to use what already describes my
change (PR, commits, diff, test results) so that I never write special
metadata. *(SPEC §3.6 "Context over ceremony")*

1. CE SHALL collect context from every available provider: Git diff against a
   base ref, commit messages, GitHub event payload (PR title/body), CLI
   arguments (`--claim`, `--base`), and test/check reports (JUnit XML or a
   summary passed by flag).
2. WHEN a provider is unavailable THEN CE SHALL continue with the others and
   record which providers contributed. CE SHALL NOT require Git or a PR.
3. CE SHALL record provenance (provider and location) for every Change,
   Claim and Check it resolves. *(SPEC §3.5)*
4. BEFORE any context is sent to Jev, CE SHALL apply redaction (built-in
   secret patterns plus configured patterns) and SHALL NOT send `.env*`
   contents or values of known secret variables.
5. CE SHALL fit the state sent per Jev request within the model's state
   budget (32k tokens) by prioritising user-facing files and truncating
   deterministically, and SHALL record what was truncated.

## R4 — Claim identification without fabrication

**User story:** As a reviewer, I want each piece of evidence tied to a claim
that really came from the change, so that I can trust what it is evidence of.

1. CE SHALL derive claim candidates only by extracting existing text (sentences
   or list items) from the resolved context; CE SHALL NOT generate claim text.
2. CE SHALL classify each candidate with Jev and keep those whose probability
   meets the configured claim threshold.
3. WHEN no candidate meets the threshold THEN CE SHALL mark the claim as
   "not identified" and carry that status into the evidence. *(SPEC §7.2)*
4. WHEN the user passes `--claim "<text>"` THEN CE SHALL use it as a claim with
   provenance `cli`.

## R5 — Assessment

**User story:** As a developer, I want CE to skip changes my tests already
cover, so that it adds evidence, not noise. *(SPEC §3.6, §6.1)*

1. CE SHALL determine, per claim, whether existing checks already provide
   adequate evidence and whether the behaviour is observable at runtime.
2. CE SHALL determine the runtime surface the evidence would need
   (`browser_ui`, `http_api`, `cli`, `backend_internal`, `native_app`,
   `non_runtime`).
3. WHEN evidence is not warranted for any claim THEN CE SHALL resolve to
   `SKIPPED` and SHALL NOT start or contact the target runtime.
4. WHEN evidence is warranted but the surface is not supported by the v0
   capability catalog THEN CE SHALL resolve to `UNSUPPORTED`. *(SPEC §4.4)*
5. WHEN a decision probability falls inside the configured uncertainty band
   THEN CE SHALL apply the configured policy (`evidence` by default) and
   record that the policy, not the classifier, decided.
6. CE SHALL record every assessment input question, model version and returned
   probability, so the decision is inspectable. The Assessment SHALL NOT be
   presented as a verdict on correctness. *(SPEC §3.5)*

## R6 — Runtime access

**User story:** As a CI author, I want CE to use the app my workflow already
started, so that CE stays non-invasive. *(SPEC §5.4)*

1. CE SHALL attach to an already running target URL.
2. WHERE a start command is configured, CE SHALL start it, wait for readiness
   (HTTP 2xx/3xx on the ready path within timeout), capture its stdout/stderr,
   and stop it at the end of the run.
3. WHEN the target is unreachable after the readiness timeout THEN CE SHALL
   resolve to `ERROR` with the URL and last observed status.
4. CE SHALL NOT modify the target application's source, configuration or data
   stores.

## R7 — Bounded verification loop

**User story:** As a developer, I want CE to reach the changed state by itself,
without me writing a test script, while never doing something unpredictable.
*(SPEC §4.2 Observe → Decide → Execute, §6.2)*

1. CE SHALL observe the page as a list of actionable elements (role,
   accessible name, stable locator, visibility) plus page metadata.
2. CE SHALL choose each next action only from options built from that
   observation (interact with an observed element, navigate to an observed
   link or configured route, declare the claimed state reached, or give up).
   CE SHALL NOT act on a locator that was not observed.
3. CE SHALL stop after the configured maximum steps or time budget.
4. WHEN the loop gives up or exhausts its budget before the claimed state is
   reached AND at least one observation was captured THEN CE SHALL package the
   observations and resolve to `EVIDENCED` with `finalState: not_reached`.
   WHEN no observation could be captured THEN CE SHALL resolve to `ERROR`.
5. CE SHALL capture a screenshot after every state-changing action and at the
   final state.

## R8 — Execution outcome contract

1. Every run SHALL resolve to exactly one of `SKIPPED`, `EVIDENCED`,
   `UNSUPPORTED`, `ERROR`. *(SPEC §7.1)*
2. CE SHALL never report `SKIPPED` when the assessment required evidence, and
   never report `UNSUPPORTED` when it did not.
3. Any uncaught failure SHALL resolve to `ERROR` and still write a minimal
   bundle containing the error and the stage it occurred in.
4. CE SHALL exit 0 unless the outcome is listed in `output.fail-on` (default:
   `[error]`).

## R9 — Evidence bundle and report

**User story:** As a reviewer, I want to open one page and understand what was
claimed, what CE did, and what it saw, without re-running anything.

1. WHEN a run completes THEN CE SHALL write a bundle under
   `<output.dir>/<run-id>/` containing `run.json`, screenshots, logs and a
   self-contained `report.html`.
2. `run.json` SHALL let a reader determine: the change and the claim the
   evidence relates to (or "not identified"), the subject/runtime observed, the
   actions performed, the observations obtained, and where artifacts live.
   *(SPEC §7.2)*
3. `run.json` SHALL conform to a versioned JSON Schema shipped with CE.
4. `report.html` SHALL work offline, show the outcome first, then
   claim → assessment rationale → step timeline with screenshots → logs, and
   SHALL clearly label classifier signals as signals, not verdicts.
5. CE SHALL print a short terminal summary with the outcome and the path to
   `report.html`.

## R10 — GitHub integration

**User story:** As a maintainer, I want to add CE to my workflow with one
`uses:` step and get the evidence on my PR.

1. The repository SHALL publish a GitHub Action (`uses: rfxlamia/ce@v0`)
   whose inputs mirror the `ce.yml` keys.
2. The Action SHALL install the required browser, run CE, upload the bundle as
   a workflow artifact, and create or update a single PR comment identified by
   a hidden marker.
3. The PR comment SHALL state the outcome, claims, a one-line rationale, and a
   link to the artifact; WHEN outcome is `SKIPPED` THEN the comment SHALL say
   why, briefly.
4. The Action SHALL NOT push commits or branches unless an explicit opt-in
   input enables evidence publishing.

## R11 — Jev usage

1. CE SHALL pin the Jev model version (default `typesafe/jev-1.14` on
   OpenRouter) and record the exact model id the API returned.
6. CE SHALL support two providers behind one gateway: `openrouter` (default;
   TypeSafe SDK with base URL `https://openrouter.ai/api`) and `typesafe`
   (direct). Switching provider SHALL require only config/env changes.
7. CE SHALL send image state only where the question needs it (final-state
   questions), because image requests run in Jev's slower long-context mode.
2. CE SHALL group all questions about the same state into one request.
3. CE SHALL respect rate limits by honouring `retry-after` and by bounded
   concurrency; WHEN retries are exhausted THEN the run SHALL resolve to
   `ERROR` naming the failed stage.
4. CE SHALL log each Jev call (question ids, model, probabilities, latency,
   token usage, hash of the state) to `jev-calls.jsonl`, and SHALL NOT log the
   state contents.
5. All question texts SHALL live in one versioned catalog in the codebase.

## R12 — Quality and evaluation

1. CE SHALL ship an evaluation set of labelled change fixtures and a `ce eval`
   command that reports agreement of assessment decisions with labels.
2. Core invariants (R8, R3.4, R4.1, R7.2) SHALL be covered by property-based
   tests.
3. An end-to-end test SHALL run CE against `examples/demo-app` for at least
   one `SKIPPED`, one `EVIDENCED` and one `UNSUPPORTED` scenario, with Jev
   replaced by a recorded fake.

## R13 — Dogfooding

**User story:** As the CE maintainer, I want CE to verify changes to CE's own
landing page in this repository, so that the project shows it works on a real
app it did not write tests for.

1. The repository SHALL contain a React landing page under `apps/site/` that
   is unaware of CE, deployed to a public URL.
2. The repository's own workflow SHALL run CE through the local Action
   (`uses: ./`) on pull requests that touch `apps/site/`.
3. WHEN a pull request comes from a fork (no secrets available) THEN the
   workflow SHALL report that CE could not run and SHALL NOT expose secrets
   (`pull_request`, never `pull_request_target`).
4. The landing page SHALL link to the latest CE report produced for it.
