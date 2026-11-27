# Requirements Document

## Introduction

This feature implements GitHub issue #12 in rfxlamia/ce, "[M3] GitHub Action + PR comment" (milestone M3, label `dx`). It covers R10 criteria 1 to 4 of `docs/journal/v0.0/requirements.md` and section 8 of `docs/journal/v0.0/design.md`. `SPEC.md` is normative (sections 3.5, 4.2, 4.3, 7.1 and 7.2) and wins on any conflict with this document or the journal. The issue states its Done condition as: a PR on this repo gets a CE comment from the Action. Requirement 14 turns that condition into a testable criterion.

Today a maintainer can run `ce run` only from a shell. `ce run` writes the Evidence_Bundle (`run.json`, screenshots, logs, `jev-calls.jsonl`) under `.ce/runs/<id>/` and prints a four-line Terminal_Summary. No `action.yml` exists, no step caches the Playwright Chromium download, no step uploads the bundle, and nothing posts a result to a pull request. This feature adds a GitHub Action, `uses: rfxlamia/ce@v0`, that runs the CE CLI in a workflow, uploads the bundle as a workflow artifact, and upserts one pull request comment that carries the hidden marker `<!-- ce:report -->`.

The issue text and the journal say `node20`. The issue was updated on 25 Nov 2026 ("GitHub Action runtime is node24"), and the `tech` steering rule records the same expectation. This document therefore requires `node24`. The journal is not edited.

The Action is a presentation and transport layer. It decides no Outcome. The Outcome comes from `run.json`, which the CLI wrote after the Outcome_Resolver decided it (steering "Placement rules"). The Action never calls Jev. Jev question text stays in `jev/catalog.ts`. Tests use `FakeJevGateway` and the GitHub API test doubles of this feature, and need no API key, no network and no browser.

### Issue checklist traceability

| Issue checklist item | Requirements |
| --- | --- |
| `action.yml` (node24) with inputs mirroring `ce.yml`; caches Playwright Chromium | 1, 2, 3, 4 |
| Reads PR context from `GITHUB_EVENT_PATH`; uploads the bundle as an artifact | 5, 6, 7 |
| Upserts one comment marked `<!-- ce:report -->` with outcome, claims, one-line rationale, artifact link (and why, when SKIPPED) | 8, 9, 10, 11 |
| No pushes unless `publish: branch` | 12 (the Action pushes nothing in this release; `publish: branch` fails fast as "not implemented", see "Out of scope and follow-ups") |
| Example workflow in README | 13 |
| Done when: a PR on this repo gets a CE comment from the Action | 14 |
| Steering rules (secrets in env only, fake Jev in CI, outcome placement, SPEC 3.5 wording) | 3, 9, 10, 15 |

### Facts verified in the code

- F1. `packages/ce/package.json` has `bin.ce = ./dist/cli.js`, and `dist/` is listed in `.gitignore` (line 2, unanchored). A consumer that writes `uses: rfxlamia/ce@v0` receives a checkout of the repository at that ref, with no `dist/` and no `node_modules/`. The Action therefore needs a committed, runnable build (Requirement 2). The unanchored pattern `dist/` also matches `action/dist/`: `git check-ignore -v action/dist/index.js` reports `.gitignore:2:dist/`, so a bundle written there is ignored and cannot be committed without a negation rule (Requirement 2).
- F2. `ce run` accepts only `--config <file>`, `--base <ref>` and `--claim <text>` (repeatable) (`run/command.ts`, `parseRunArgs`). `parseRunArgs` returns a usage error (`null`) for an empty value and for any value that starts with `--`, in both the `--claim <text>` and the `--claim=<text>` forms (for example `--claim=--x`, or a claim line `--fix login`). Every other `ce.yml` key reaches the loader through `CE_*` environment variables. `config/env.ts` derives the variable name from the dotted key with `envNameForPath` (`runtime.max-steps` becomes `CE_RUNTIME_MAX_STEPS`). List values are split at `,` and trimmed. Number values are coerced. `runtime.fixtures` has no environment variable (`FIXTURES_ENV_PREFIX` names are ignored).
- F3. `ConfigSchema` (`config/schema.ts`) is strict and holds these leaf keys: `version`, `target.url`, `target.start`, `target.ready.path`, `target.ready.timeout`, `target.routes`, `context.base`, `context.include`, `context.exclude`, `context.redact`, `context.checks`, `assessment.thresholds.claim`, `assessment.thresholds.observable`, `assessment.thresholds.adequate`, `assessment.uncertainty-band`, `assessment.on-uncertain`, `runtime.max-steps`, `runtime.timeout`, `runtime.viewport.width`, `runtime.viewport.height`, `runtime.fixtures`, `jev.provider`, `jev.model`, `output.dir`, `output.fail-on`. A key that matches `api-?key|secret|token|password` is rejected with "secrets belong in environment variables, not in ce.yml".
- F4. `resolveContext` reads `options.env.GITHUB_EVENT_PATH` and passes it to `resolveGithubEvent` (`context/resolve.ts` line 232). `resolveGithubEvent` (`context/providers/github-event.ts`) reads the file through an injected `readFile`, extracts `pull_request.title`, `body`, `base.sha`, `base.ref` and `head.sha`, or `before` for a push payload, and returns `unavailable` with reason `source-absent` for a missing, unparsable or unrecognised payload. It never reads `process.env`.
- F5. `run()` writes the Run_Dir at `path.resolve(o.cwd, config.output?.dir ?? '.ce/runs', runDirName(o.now()))` (`run/pipeline.ts` line 341). The directory comes from the effective `output.dir` of the loaded config (file, then `CE_OUTPUT_DIR`, per the loader precedence), so `ce.yml` can move it away from `.ce/runs`. The helper `defaultRunDir` (line 167) hardcodes `.ce/runs` and is a fallback only. `run()` returns `runDir`, `reportPath`, `bundleWritten` and `claimTexts` in a `ResolvedRunWithBundle` (`run/pipeline.ts`). The CLI does not print `runDir`. It prints `Report: <path>` or `Report: no bundle was written`.
- F6. `exitCodeFor` (`outcome/exit-code.ts`) returns 1 for `ERROR`, 2 for `UNSUPPORTED` and 3 for `EVIDENCED` with `finalState` `not_reached`, each only when the `output.fail-on` list contains the matching entry (`error`, `unsupported`, `evidenced-not-reached`). Otherwise it returns 0.
- F7. `evidence/summary.ts` exports `buildSummary(input)`, a pure function that returns at most four lines (`Outcome:`, `Claim:`, `Why:`, `Report:`), each at most 200 code points. Its `rationaleLine` and the helpers `oneLine`, `fit` and `clamp` are module-private. The `Why:` text per Outcome is: SKIPPED "evidence was not required (decided by <decidedBy>)", UNSUPPORTED "evidence was required, but the surface <surface> has no capability", EVIDENCED "final state <finalState> after <n> steps", ERROR "failed at stage <stage>: <reason>".
- F8. `RunRecordSchema` (`evidence/schema.ts`) is a strict discriminated union on `outcome`. A parsed record exposes `outcome`, `outcomeReason`, `claims[].text`, `claims[].probability`, `assessment.{required, decidedBy, surface, claimStatus}`, `finalState`, `steps`, `finalImage`, `error.{stage, reason}`, `artifacts[].{path, kind}` and `timings`. `schemas/run.schema.json` is generated from it. `run.json` holds no diff text and no commit messages.
- F9. `config/secrets.ts` exports `collectSecretValues(env)` and `redactSecretValues(text, secrets)`, which replace secret values with `[REDACTED]`.
- F10. `.github/workflows/ci.yml` installs Chromium with `npx playwright install --with-deps chromium`, pins every third-party action to a commit SHA, and sets `permissions: contents: read`. The repository has no `action.yml`, no `action/` directory and no workflow that runs CE.
- F11. The root `README.md` has "Development" and "CI requirements" sections. The "CI requirements" section documents `fetch-depth: 0` for `actions/checkout`, the `pull_request_target` head checkout, and the `context.checks` path rule. It has no Action usage section.
- F12. `ce.yml` has no key for evidence publishing, and `ConfigSchema` is strict. The `publish` setting is therefore an Action input and not a `ce.yml` key (D4).
- F13. On a pull request from a fork, GitHub gives the `pull_request` event a read-only `GITHUB_TOKEN` and withholds repository secrets. A comment write then fails with HTTP 403 and `OPENROUTER_API_KEY` is empty.
- F14. A node-runtime Action (`runs.using: node24`) cannot call `uses:` steps such as `actions/cache` or `actions/upload-artifact`. It reaches the same functions through the npm packages `@actions/cache` and `@actions/artifact`.
- F15. A GitHub issue comment body is limited to 65536 characters.
- F16. `target.start` builds the Subject's environment by copying the caller's env and removing only the names in `CE_SECRET_NAMES`, which holds `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` (`runtime/target.ts` line 222; the filter at lines 687 to 691). Every other variable reaches the Subject. A child process of the Action therefore passes `INPUT_GITHUB-TOKEN`, `GITHUB_TOKEN` and `ACTIONS_RUNTIME_TOKEN` on to the Subject, and `ACTIONS_RUNTIME_TOKEN` with `ACTIONS_CACHE_URL` allows writes to the repository's Actions cache (cache poisoning).
- F17. Playwright reads its own package files at runtime (`playwright-core` resolves its `package.json`, `browsers.json` and installer from its package directory), so bundling it into one file is unproven. The Chromium installer (Requirement 4 criterion 4) must also be reachable from the packaged Action. Neither has been verified in this repository.

### Design implications

- I1. `F1` and `F14` together mean the Action ships as a committed bundle under `action/` with a root `action.yml` that points at it. The `tech` steering file says "No build orchestration framework", so the bundling step is a plain npm script.
- I2. `F2` and `F3` mean the Action maps each input to a `CE_*` variable, with `--config`, `--base` and `--claim` as the only flags. That reuses the config loader and its validation, and adds no second parser of `ce.yml` keys.
- I3. `F5` hides the Run_Dir from the CLI output, and the real parent directory depends on the effective `output.dir`. The Action needs the Run_Dir to upload it, so it obtains the effective `output.dir` from the bundled config loader and finds the directory this invocation created (Requirement 6).
- I6. `F16` means the Action must strip `INPUT_*`, `ACTIONS_*` and the GitHub token from the CE_CLI child environment itself, because `target.start` will not (Requirement 5).
- I7. `F1` and `F17` mean the packaging form is an open technical question. The requirements allow a single-file bundle or a pruned production `node_modules`, and require a verification before other work depends on either (Requirement 2, D9).
- I4. `F7` keeps the Terminal_Summary wording private. The PR comment must use the same Outcome, claim and rationale wording, so the shared wording moves to one exported function and both renderers call it (Requirement 9, D2).
- I5. `F13` means a missing token permission or a missing secret is a normal situation for fork PRs. The comment step degrades to a warning and a job summary (Requirement 11).

### Decisions taken in this document

- D1. The Action is a node24 JavaScript Action with a root `action.yml` (required by `uses: rfxlamia/ce@v0`) whose `runs.main` points at a committed build under `action/dist/`. The `action/` directory holds the entry source and its tests. The root `action.yml` differs from `.kiro/steering/structure.md`, which says `action/` holds `action.yml` (see "Steering follow-up").
- D2. The comment renderer is a pure function `renderPrComment` in `packages/ce/src/evidence/comment.ts`, next to `summary.ts`. The wording of the outcome, claim and rationale lines is exported from `summary.ts` and shared (I4). The GitHub transport code (artifact upload, cache, comment upsert) lives in `action/` and imports the renderer.
- D3. The Action runs the CE CLI as a child process, so exit codes, the Terminal_Summary and the Outcome decision are exactly those of `ce run`. The Action reads `run.json` and does not parse the Terminal_Summary.
- D4. `publish` is an Action input with the values `none` (default) and `branch`. It is not a `ce.yml` key (F12). In this release only `none` works. `branch` fails fast with a "not implemented in this release" error (D8).
- D5. The Action never fails a run because the comment step failed. The step fails only when the CLI exit code is non-zero (D6).
- D6. The step exit code equals the CLI exit code. `output.fail-on` therefore controls whether the step fails, and the Action adds no gate of its own (`SPEC.md` 4.3, journal "Non-goals for v0": no merge gate or deploy gate by default).
- D7. The comment is updated in place. The Action finds its comment by the marker among comments whose author login equals the `comment-author` input (default `github-actions[bot]`), and never edits a comment written by any other author. A workflow that posts with a personal access token sets `comment-author` to that account's login.
- D8. Publishing screenshots to an orphan branch (`publish: branch`) is split into a follow-up issue. Raw URLs of a branch file need authentication in private repositories, so inline images would not render for reviewers there. This release keeps only the `publish` input, its default `none`, its value validation, and the guarantee that nothing is pushed.
- D9. The packaging form of the Action_Bundle (single file, or a pruned production `node_modules` committed under `action/dist/`) is chosen by a verification, not by assumption. The verification proves that the packaged Action runs `playwright install chromium` and launches Chromium (Requirement 2 criteria 10 and 11). It is the first piece of work of the implementation plan, and the rest depends on its result.
- D10. The artifact name is unique per invocation (Requirement 7), so a second Action step in one job or a matrix leg does not collide.
- D11. The child environment of the CE_CLI is sanitized by the Action (Requirement 5 criterion 10), because the Subject inherits what the CE_CLI receives (F16).

### Out of scope and follow-ups

- Publishing screenshots to an orphan Git branch (`publish: branch`), pushing to that branch, and showing screenshots inline in the PR_Comment are out of scope (D8). Reason: raw URLs of files on a branch need authentication in private repositories, so the images would not render there. A separate follow-up issue (to be filed) tracks the feature. This release shows no image in the PR_Comment, and screenshots stay in the Artifact.
- Changing `parseRunArgs` to accept claim values that start with `--` is out of scope. Requirement 3 criterion 5 states the handling rule instead.

### Steering follow-up

`.kiro/steering/structure.md` says `action/` holds `action.yml`. D1 places `action.yml` at the repository root, as `uses: rfxlamia/ce@v0` requires, and keeps the entry source, bundle and tests under `action/`. The steering file needs updating. The orchestrator edits it. This spec does not.

## Glossary

- **Action**: The GitHub Action defined by the root `action.yml`, used as `uses: rfxlamia/ce@v0`.
- **Action_Manifest**: The root file `action.yml` that declares the Action's name, inputs, outputs and runtime.
- **Action_Entry**: The TypeScript source under `action/` that the Action_Bundle is built from.
- **Action_Bundle**: The committed build output under `action/dist/` that `runs.main` of the Action_Manifest names. It is either a single-file bundle or a file plus a pruned production `node_modules` directory under `action/dist/`. It contains the Action_Entry and the CE CLI with every dependency except the browser binaries.
- **CE_CLI**: The `ce` command of `packages/ce/` (`ce run`).
- **Input_Map**: The table in Requirement 3 that maps each Action input to one `CE_*` environment variable or one CE_CLI flag.
- **Run_Record**: The file `run.json` in the Run_Dir (see the evidence-bundle spec).
- **Run_Dir**: The directory `<output.dir>/<run-id>/` that one `ce run` created.
- **Evidence_Bundle**: The Run_Dir and every file in it.
- **Artifact**: A GitHub workflow artifact that holds the Evidence_Bundle of one Action invocation.
- **Artifact_Link**: The URL of the Artifact on the workflow run page.
- **PR_Comment**: The pull request comment that the Action creates or updates. Its body is produced by `renderPrComment`.
- **Comment_Marker**: The literal text `<!-- ce:report -->`.
- **Comment_Renderer**: The pure function `renderPrComment` in `packages/ce/src/evidence/comment.ts`.
- **Comment_Upserter**: The Action_Entry code that finds the PR_Comment by the Comment_Marker and creates or updates it.
- **Browser_Cache**: The GitHub Actions cache entry that holds the Playwright Chromium download.
- **Browsers_Path**: The directory that holds the Playwright browser downloads. It is the value of `PLAYWRIGHT_BROWSERS_PATH` when set, and `~/.cache/ms-playwright` otherwise on Linux (`~/Library/Caches/ms-playwright` on macOS, `%USERPROFILE%\AppData\Local\ms-playwright` on Windows).
- **Cache_Key**: The key of the Browser_Cache. It is built from the runner operating system, the runner architecture and the installed `playwright` package version.
- **Event_Payload**: The JSON file at the path in `GITHUB_EVENT_PATH`.
- **Publish_Mode**: The value of the `publish` input, `none` or `branch`. Only `none` is implemented in this release.
- **Comment_Author**: The author login that the Comment_Upserter matches. It is the value of the `comment-author` input, default `github-actions[bot]`.
- **Effective_Output_Dir**: The `output.dir` value that the config loader of the CE_CLI returns after it applies `ce.yml`, the `CE_*` variables and the Action inputs, or `.ce/runs` when no source sets it.
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC section 7.1).
- **Claim**: A statement about the behavior expected from the Change (SPEC section 3.2).
- **Change**: The software change that is the reason verification is performed (SPEC section 3.2).
- **Signal**: A classifier probability. SPEC section 3.5 says it is not a verdict on correctness.
- **Rationale_Line**: The one-line explanation of the Outcome, taken from the shared wording of F7.
- **Run_Token**: The `github-token` input, default `${{ github.token }}`. It authenticates GitHub API calls.
- **Same_Repo_PR**: A pull request whose head repository is the repository that runs the workflow.
- **Secret_Value**: A value that `collectSecretValues` returns for the Action environment.

## Requirements

### Requirement 1: Action manifest and runtime

**User Story:** As a maintainer, I want to add CE with one `uses:` step, so that I do not write install and wiring steps myself.

#### Acceptance Criteria

1. THE repository SHALL contain an Action_Manifest at the repository root, named `action.yml`.
2. THE Action_Manifest SHALL declare `runs.using` as `node24`.
3. THE Action_Manifest SHALL declare `runs.main` as a path to a file inside the Action_Bundle, and that file SHALL exist in the repository.
4. THE Action_Manifest SHALL declare a `name`, a `description` and `branding`.
5. THE Action_Manifest SHALL declare the outputs `outcome`, `run-dir`, `artifact-url`, `comment-url` and `exit-code`.
6. WHEN the Action finishes, THE Action SHALL set the output `outcome` to the `outcome` of the Run_Record, `run-dir` to the absolute Run_Dir, `artifact-url` to the Artifact_Link, `comment-url` to the URL of the PR_Comment, and `exit-code` to the CE_CLI exit code. THE Action SHALL set an output to the empty string WHEN its value does not exist.
7. THE Action_Manifest SHALL parse as valid YAML, and a test SHALL check each criterion 1 to 5 against the parsed file.
8. FOR ALL values that the Action_Manifest declares as an input `default`, THE Action SHALL treat an input that the workflow does not set as having that default.

### Requirement 2: Action bundle

**User Story:** As a maintainer, I want the Action to run without a build step in my workflow, so that `uses: rfxlamia/ce@v0` works from a plain checkout of the Action's repository.

#### Acceptance Criteria

1. THE repository SHALL contain the Action_Bundle at a committed path under `action/dist/`.
2. THE Action_Bundle MAY be a single-file bundle, or a file together with a pruned production `node_modules` directory committed under `action/dist/`. A single-file bundle is not mandatory.
3. THE Action_Bundle SHALL contain the Action_Entry and the CE_CLI with their npm dependencies, except the Playwright browser binaries, including every `playwright` and `playwright-core` package file that Playwright reads at runtime and the Chromium installer of Requirement 4 criterion 4.
4. THE repository SHALL provide an npm script at the repository root that rebuilds the Action_Bundle from the sources, using a plain npm script and no build orchestration framework.
5. WHEN the committed Action_Bundle differs from the output of the rebuild script, THE test suite SHALL fail.
6. WHEN the Action runs on a runner that has Node.js 24 and no `node_modules/` directory in the Action's repository checkout, THE Action SHALL start and run the CE_CLI without an `npm install` step in the consumer workflow.
7. THE Action_Bundle SHALL contain no value of a Secret_Value, and a test SHALL scan the bundle text for the values of `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` set in the test environment.
8. THE `.gitignore` file SHALL contain the negation `!action/dist/` (or an equivalent rule) after the `dist/` rule, so that the Action_Bundle is not ignored (F1). WHERE the Action_Bundle includes a `node_modules` directory, THE `.gitignore` file SHALL also re-include `action/dist/node_modules/`.
9. THE test suite SHALL run `git check-ignore` on the `runs.main` file of the Action_Manifest, and on one file inside `action/dist/node_modules/` WHERE that directory exists, and SHALL fail WHEN `git check-ignore` reports either path as ignored.
10. BEFORE any other requirement of this document depends on the Action_Bundle, THE implementation SHALL verify the chosen packaging form: the packaged Action SHALL run `playwright install chromium` and SHALL launch Chromium headless and load a page, on a Linux runner with no `node_modules/` in the Action's checkout (F17).
11. THE implementation SHALL record the packaging form chosen and the verification result in the description of the pull request that implements this spec, and in the decisions list of the design document (D9).

### Requirement 3: Inputs mirror ce.yml

**User Story:** As a maintainer, I want the Action inputs to carry the same names as the `ce.yml` keys, so that I can move a setting between `ce.yml` and the workflow without learning a second vocabulary.

#### Acceptance Criteria

1. THE Action_Manifest SHALL declare one input for each leaf key of `ConfigSchema` that has a `CE_*` environment variable (F2, F3), named as the dotted key with `.` replaced by `-` (for example `target-url`, `target-ready-path`, `runtime-max-steps`, `runtime-viewport-width`, `jev-provider`, `output-fail-on`). The key `version` and the key `runtime.fixtures` have no input, because neither has a `CE_*` variable.
2. THE Action_Manifest SHALL declare the inputs `config` (path to a Config_File), `base` (Git base ref), `claim` (one Claim per line), `working-directory`, `github-token`, `comment`, `comment-author` (default `github-actions[bot]`), `artifact-name` (default empty) and `publish` (default `none`).
3. WHEN a mirror input has a non-empty value, THE Action SHALL pass that value to the CE_CLI child process in the `CE_*` variable that `envNameForPath` returns for the dotted key.
4. WHEN a mirror input is empty or unset, THE Action SHALL leave the matching `CE_*` variable out of the child environment, so that the value from `ce.yml` or the default applies.
5. WHEN the `config` input is non-empty, THE Action SHALL pass `--config <value>` to the CE_CLI. WHEN the `base` input is non-empty, THE Action SHALL pass `--base <value>`. THE Action SHALL pass one `--claim <text>` for each non-empty line of the `claim` input, after trimming the line. IF a trimmed line starts with `--`, THEN THE Action SHALL skip that line, SHALL write a warning that names the line number and not the text, and SHALL run the CE_CLI with the remaining lines, because `parseRunArgs` answers such a value with a usage error (F2) and this feature does not change the parser.
6. THE Action SHALL run the CE_CLI with the `working-directory` input as its working directory, defaulting to the workspace root `GITHUB_WORKSPACE`.
7. THE Action SHALL leave `ce.yml` unmodified, and the precedence between input, `ce.yml` and default SHALL be the precedence that the config loader already applies to `CE_*` variables.
8. FOR ALL leaf keys of `ConfigSchema` that have an entry in `ENV_KEY_MAP`, THE Action_Manifest SHALL declare an input whose name maps back to that key, and a test SHALL fail when `ConfigSchema` gains a key without a matching input (staleness check).
9. THE Action_Manifest SHALL declare no input that carries a credential. The Jev credential SHALL reach the CE_CLI only through the environment variable `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` that the consumer workflow sets with `env:` (steering "Jev provider and secrets").
10. WHEN both the `base` input and the `context-base` input are non-empty, THE Action SHALL pass both, and the `--base` flag SHALL win over `CE_CONTEXT_BASE`, as the config loader already applies the precedence flag, then environment, then `ce.yml`. THE README SHALL document that `base` wins (Requirement 13 criterion 4).
11. WHEN an input value is invalid for the key, THE Action SHALL let the CE_CLI config loader report the error, and the Action SHALL NOT add its own validation of mirror input values.
12. THE Action SHALL treat every input value as data and SHALL pass it to the child process as an argument vector entry or an environment value, never through a shell command line.

### Requirement 4: Playwright Chromium cache

**User Story:** As a maintainer, I want the Chromium download cached, so that CE does not download the browser on every pull request run.

#### Acceptance Criteria

1. BEFORE the Action runs the CE_CLI, THE Action SHALL restore the Browser_Cache with the Cache_Key.
2. THE Action SHALL build the Cache_Key from the runner operating system, the runner architecture and the version of the `playwright` package inside the Action_Bundle.
3. WHEN the Browser_Cache is restored, THE Action SHALL skip the Chromium download.
4. WHEN the Browser_Cache is not restored, THE Action SHALL install Chromium with the Playwright installer and SHALL save the Browser_Cache after the install succeeds.
5. WHILE the runner operating system is Linux, THE Action SHALL install the operating system packages that Chromium needs, in both the restored and the not-restored case, because those packages are not part of the cached directory.
6. IF the cache restore or the cache save fails, THEN THE Action SHALL write a warning, SHALL install Chromium without the cache, and SHALL continue the run.
7. IF the Chromium install fails, THEN THE Action SHALL fail the step with a message that names the install step and SHALL NOT run the CE_CLI.
8. THE Action SHALL install Chromium only, and no other Playwright browser.
9. FOR ALL pairs of Cache_Keys built from different `playwright` versions, THE Action SHALL produce different keys.
10. THE Action SHALL cache the Browsers_Path directory, and SHALL set `PLAYWRIGHT_BROWSERS_PATH` to that resolved path in the environment of the installer and of the CE_CLI child process, so that the cache, the installer and the CE_CLI use one directory. WHILE the runner operating system is Linux and `PLAYWRIGHT_BROWSERS_PATH` is unset, the Browsers_Path SHALL be `~/.cache/ms-playwright`. A test SHALL check the resolved path and the child environment value for both the set and the unset case.

### Requirement 5: Run CE with PR context

**User Story:** As a maintainer, I want CE to read the pull request context from the workflow event, so that the Change and its Claims come from the PR that triggered the run.

#### Acceptance Criteria

1. THE Action SHALL run the CE_CLI as `ce run` in a child process, with the child environment holding the runner environment minus the variables that criterion 10 removes, the `CE_*` variables of Requirement 3, and `GITHUB_EVENT_PATH` unchanged.
2. WHEN the workflow event is `pull_request` or `pull_request_target`, THE CE_CLI SHALL read the title, body, base and head from the Event_Payload through the existing GitHub event provider, and the Action SHALL add no second reader of the Event_Payload for those fields.
3. IF `GITHUB_EVENT_PATH` is unset or names an unreadable file, THEN THE Action SHALL run the CE_CLI anyway, and the Run_Record SHALL record the GitHub provider as `unavailable`.
4. THE Action SHALL read from the Event_Payload only the pull request number and the head repository full name, both needed to post the PR_Comment (Requirement 11), and SHALL NOT log the Event_Payload.
5. WHEN the workflow event is not a pull request event, THE Action SHALL run the CE_CLI, SHALL upload the Artifact, SHALL NOT post a PR_Comment, and SHALL write the rendered comment body to the job summary (Requirement 10 criterion 5).
6. THE Action SHALL stream the CE_CLI stdout and stderr to the workflow log.
7. THE Action SHALL NOT write to the repository under test, to the Git history or to the Git configuration (Requirement 12).
8. WHEN the CE_CLI process ends, THE Action SHALL record its exit code as the `exit-code` output and SHALL end the step with the same exit code (D6).
9. IF the CE_CLI process cannot be started, or ends by a signal, THEN THE Action SHALL fail the step, SHALL write the failure to the workflow log without any Secret_Value, and SHALL still attempt the Artifact upload of any Run_Dir that exists.
10. THE Action SHALL remove from the CE_CLI child environment every variable whose name starts with `INPUT_` or `ACTIONS_`, the variables `GITHUB_TOKEN` and `GH_TOKEN`, and every variable whose value equals the Run_Token, because the Subject inherits that environment (F16). THE Action SHALL keep the `CE_*` variables, `GITHUB_EVENT_PATH` and the other `GITHUB_*` variables, and SHALL keep its own `ACTIONS_*` variables in its own process for the cache and artifact calls.
11. A test with a fake child process SHALL set `INPUT_GITHUB-TOKEN`, `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_CACHE_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `GITHUB_TOKEN` and `GH_TOKEN` in the Action environment, and SHALL assert that the child environment contains none of them and still contains `CE_*` and `GITHUB_EVENT_PATH`.

### Requirement 6: Locate the Run_Dir

**User Story:** As a maintainer, I want the Action to upload exactly the bundle of this run, so that a stale directory from an earlier run is never attached to the comment.

#### Acceptance Criteria

1. THE Action SHALL use the config loader of the Action_Bundle, with the same Config_File, `CE_*` variables and flags that it gives the CE_CLI, to obtain the Effective_Output_Dir (after file, environment and input precedence, F5), and SHALL resolve it against the working directory. THE Action SHALL NOT derive the directory from the `output-dir` input alone and SHALL NOT assume `.ce/runs`.
2. BEFORE running the CE_CLI, THE Action SHALL list the entries of the Effective_Output_Dir, and AFTER the CE_CLI ends THE Action SHALL select as the Run_Dir the entry that did not exist before the run. IF the config loader reports an error, THEN THE Action SHALL still run the CE_CLI, which reports the same error, and SHALL treat the run as having no Evidence_Bundle (criterion 4).
3. IF more than one new entry exists, THEN THE Action SHALL select the entry with the most recent modification time.
4. IF no new entry exists, THEN THE Action SHALL treat the run as having no Evidence_Bundle, SHALL skip the Artifact upload, and SHALL render the PR_Comment from the CE_CLI exit code alone (Requirement 8 criterion 8).
5. WHEN a Run_Dir is selected, THE Action SHALL read `run.json` from it and SHALL validate the content against `RunRecordSchema`.
6. IF `run.json` is absent, unparsable or invalid, THEN THE Action SHALL treat the Run_Record as unavailable, SHALL still upload the Run_Dir, and SHALL render the PR_Comment as in criterion 4.
7. THE Action SHALL read only files inside the Run_Dir, and SHALL ignore any `artifacts[].path` of the Run_Record that is not a Bundle_Relative_Path.

### Requirement 7: Upload the bundle as an artifact

**User Story:** As a reviewer, I want the whole Evidence_Bundle attached to the workflow run, so that I can open the screenshots and logs behind the comment.

#### Acceptance Criteria

1. WHEN a Run_Dir exists after the CE_CLI ends, THE Action SHALL upload the complete Run_Dir as one Artifact, whatever the Outcome and the exit code are.
2. WHEN the `artifact-name` input is empty, THE Action SHALL name the Artifact `ce-evidence-<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>-<GITHUB_JOB>-<run-dir-name>`, where `<run-dir-name>` is the directory name of the Run_Dir (`run-<iso>`), so that a re-run, a second Action step in one job and a matrix leg each get a distinct name. THE Action SHALL replace each character that GitHub forbids in an artifact name (`"`, `:`, `<`, `>`, `|`, `*`, `?`, `\`, `/`, CR, LF) with `-` in each part of the name. WHEN the `artifact-name` input is non-empty, THE Action SHALL use its value, with the same replacement, as the Artifact name, and the workflow author is responsible for its uniqueness.
3. THE Action SHALL keep the files at their paths relative to the Run_Dir inside the Artifact, so that every `artifacts[].path` of the Run_Record resolves inside the Artifact.
4. THE Action SHALL build the Artifact_Link from the server URL, the repository, the run id and the artifact id that the upload returns.
5. WHEN the upload returns no artifact id, THE Action SHALL set the Artifact_Link to the workflow run URL.
6. IF the upload fails, THEN THE Action SHALL write a warning, SHALL set the Artifact_Link to the empty string, SHALL render the PR_Comment with the statement that the artifact is unavailable (Requirement 8 criterion 7), and SHALL continue the run.
7. THE Action SHALL upload no file from outside the Run_Dir, and SHALL NOT upload `.env` files or the Event_Payload.
8. THE Action SHALL accept an upload of an empty or partial Run_Dir without failing the step, because an `ERROR` run keeps the completed stages (evidence-bundle Requirement 5).

### Requirement 8: PR comment content

**User Story:** As a reviewer, I want the comment to state the outcome, the claims, why, and where the evidence is, so that I can judge the run without opening the artifact.

#### Acceptance Criteria

1. THE Comment_Renderer SHALL be a pure function of a Run_Record (or an unavailable-record marker that carries the CE_CLI exit code), an Artifact_Link and a `secrets` parameter that holds the Secret_Values to redact, and SHALL perform no I/O and read no `process.env`.
2. THE PR_Comment body SHALL contain the Comment_Marker exactly once, on its first line.
3. THE PR_Comment body SHALL show the Outcome before any other content, on the line after the Comment_Marker.
4. THE PR_Comment body SHALL list the Claims of the Run_Record, each with its text. WHEN a Claim has a probability, THE PR_Comment SHALL label it a signal. WHEN the Run_Record lists no Claim, THE PR_Comment SHALL state that no claim was identified and SHALL list no Claim text.
5. THE PR_Comment body SHALL contain one Rationale_Line that uses the shared wording of F7 for the Outcome, in one line of at most 200 code points.
6. WHEN the Outcome is `SKIPPED`, THE PR_Comment SHALL state why evidence was not required, using the `decidedBy` value of the assessment and the `outcomeReason` of the Run_Record.
7. THE PR_Comment body SHALL contain the Artifact_Link when it is non-empty. WHEN the Artifact_Link is empty, THE PR_Comment body SHALL state that the artifact is unavailable.
8. WHEN the Run_Record is unavailable (Requirement 6 criteria 4 and 6), THE PR_Comment SHALL show the line `Outcome: unknown (no run record)`, SHALL show the CE_CLI exit code, and SHALL list no Claim. THE PR_Comment SHALL NOT state `ERROR` or any other Outcome for that case, because the Action decides no Outcome (D3) and the Run_Record can be absent also WHEN the CE_CLI resolved `EVIDENCED` or `SKIPPED` and failed to write the bundle.
9. WHEN the Outcome is `UNSUPPORTED`, THE PR_Comment SHALL state the surface for which no capability exists, taken from the Run_Record.
10. WHEN the Outcome is `ERROR`, THE PR_Comment SHALL state the failed stage and the `outcomeReason`, and SHALL NOT include the message or stack of any underlying error.
11. WHEN the Outcome is `EVIDENCED`, THE PR_Comment SHALL state the `finalState` and the number of steps, and SHALL state that the evidence is for inspection and is not a verdict on correctness (SPEC section 3.5).
12. THE PR_Comment SHALL use the word "signal" for classifier output, and SHALL NOT use the words "passed", "failed", "verified" or "correct" to describe the Change (SPEC section 3.5).
13. THE PR_Comment body SHALL be at most 60000 characters. WHEN the full body would be longer, THE Comment_Renderer SHALL list fewer Claims, SHALL end the list with a line of the form `(+N more claims)`, and SHALL keep the Comment_Marker, the Outcome line, the Rationale_Line and the Artifact_Link.
14. THE Comment_Renderer SHALL list at most 10 Claims, each cut to at most 200 code points with `…` at the cut.
15. THE PR_Comment body SHALL contain no diff text, no commit message, no file content and no `patch` text, because the Run_Record contains none (F8).
16. FOR ALL Run_Records that `RunRecordSchema` accepts, THE Comment_Renderer SHALL return a body that satisfies criteria 2, 3, 5, 12 and 13 (property test with fast-check).
17. FOR ALL Run_Records, THE Comment_Renderer SHALL return the same body when called twice with the same arguments (determinism).

### Requirement 9: Shared wording with the Terminal_Summary

**User Story:** As a developer of CE, I want the terminal and the PR comment to describe one run in the same words, so that two renderers never drift apart.

#### Acceptance Criteria

1. THE `evidence/summary.ts` module SHALL export the function that produces the Rationale_Line text for an Outcome and its facts.
2. THE Comment_Renderer SHALL obtain the Rationale_Line text from that exported function and SHALL NOT define a second copy of the per-Outcome wording.
3. THE `buildSummary` output SHALL remain byte-identical for every input after the extraction, and the existing `summary.*.property.test.ts` tests SHALL pass unchanged.
4. THE Comment_Renderer SHALL decide no Outcome. It SHALL read `outcome` from the Run_Record and SHALL NOT assign, return or cast an Outcome literal, so that `outcome/architecture.test.ts` rule (d) continues to pass.

### Requirement 10: Comment safety

**User Story:** As a maintainer, I want text from the pull request to be unable to break or hijack the comment, so that a hostile PR description cannot forge a result or ping people.

#### Acceptance Criteria

1. THE Comment_Renderer SHALL treat every Claim text and every Run_Record string as untrusted data.
2. THE Comment_Renderer SHALL escape Markdown and HTML control characters in untrusted text, so that the text renders as plain text and creates no heading, link, image, HTML tag or HTML comment.
3. THE Comment_Renderer SHALL remove every occurrence of the Comment_Marker, and every `<!--` sequence, from untrusted text before it appears in the body, so that the body contains the Comment_Marker only once (Requirement 8 criterion 2).
4. THE Comment_Renderer SHALL neutralise `@` mentions and `#` issue references in untrusted text, so that the comment notifies no user and links no issue.
5. THE Comment_Renderer SHALL strip every value in its `secrets` parameter from the body, replacing each with `[REDACTED]` through `redactSecretValues`, and the Action SHALL pass `collectSecretValues` of its environment as that parameter and SHALL apply `redactSecretValues` again to the final body before any write.
6. WHEN the Action cannot post a PR_Comment (Requirement 11 criteria 5 and 6, and Requirement 5 criterion 5), THE Action SHALL write the same body to the file named by `GITHUB_STEP_SUMMARY`, with the Comment_Marker line removed.
7. FOR ALL generated Claim texts that contain `<!-- ce:report -->`, `@user`, `#12`, `[x](http://e)`, `<script>` or a Secret_Value, THE PR_Comment body SHALL contain the Comment_Marker exactly once and SHALL contain none of the other generated strings in an active form (property test with fast-check).

### Requirement 11: Upsert one comment

**User Story:** As a reviewer, I want one CE comment per pull request that updates on each push, so that the conversation does not fill with one comment per run.

#### Acceptance Criteria

1. WHEN the workflow event is a pull request event and `comment` is not `false`, THE Comment_Upserter SHALL list the comments of the pull request and SHALL select the comments whose body contains the Comment_Marker.
2. WHERE the selected comments include a comment whose author login equals the Comment_Author, THE Comment_Upserter SHALL update the oldest such comment with the new body. THE Comment_Author SHALL default to `github-actions[bot]` and SHALL be the value of the `comment-author` input WHEN that input is non-empty.
3. IF no comment authored by the Comment_Author contains the Comment_Marker, THEN THE Comment_Upserter SHALL create one comment with the new body.
4. THE Comment_Upserter SHALL NOT edit or delete a comment that another author wrote, even when its body contains the Comment_Marker, including a comment of another bot account.
5. IF the head repository differs from the base repository (a fork pull request, F13), THEN THE Comment_Upserter SHALL post no comment, SHALL write a warning that names the fork condition, and SHALL write the body to the job summary (Requirement 10 criterion 6).
6. IF a GitHub API call of the Comment_Upserter fails, including a response with HTTP status 403 because the Run_Token lacks `pull-requests: write` (a condition that cannot be detected before the call), THEN THE Action SHALL write a warning that holds the HTTP status, names the likely missing permission for status 403, and holds no token, SHALL write the body to the job summary, and SHALL NOT fail the step because of that failure (D5).
7. WHEN the Comment_Upserter creates or updates the PR_Comment, THE Action SHALL set the output `comment-url` to the URL of that comment.
8. WHEN the `comment` input is `false`, THE Action SHALL make no comment API call and SHALL write the body to the job summary.
9. FOR ALL sequences of N runs on one pull request with N at least 1, THE pull request SHALL hold exactly one comment that contains the Comment_Marker and whose author is the Comment_Author (idempotence), and a test with a fake GitHub API SHALL check this for at least three sequential runs, once with the default Comment_Author and once with a `comment-author` value that names a human account (a personal access token).
10. WHEN the comment list is paginated, THE Comment_Upserter SHALL read every page before it decides to create a comment.
11. THE Comment_Upserter SHALL send the Run_Token only in the `Authorization` header of requests to the GitHub API host named by `GITHUB_API_URL`, and SHALL NOT write it to any log, output or file.
12. THE Action SHALL document the permissions it needs (`contents: read` and `pull-requests: write`) in the README example (Requirement 13).

### Requirement 12: No pushes unless publish: branch

**User Story:** As a maintainer, I want the Action to leave my Git history alone by default, so that adding CE to a workflow cannot add commits or branches.

#### Acceptance Criteria

1. WHILE Publish_Mode is `none`, THE Action SHALL run no `git push`, no `git commit`, no `git branch` and no `git config`, and SHALL call no GitHub API route that creates a ref, a commit, a tree or a blob.
2. THE Action SHALL treat an unset `publish` input as Publish_Mode `none`.
3. IF the `publish` input holds a value other than `none` or `branch`, THEN THE Action SHALL fail the step before it runs the CE_CLI, with a message that lists the two allowed values.
4. IF the `publish` input holds `branch`, THEN THE Action SHALL fail the step before it runs the CE_CLI, before the Browser_Cache restore and before any Git or GitHub API write, with the message `publish: branch is not implemented in this release` and a pointer to the follow-up issue (D8), and SHALL push nothing.
5. THE PR_Comment SHALL contain no image reference, and the screenshots SHALL stay in the Artifact only.
6. FOR ALL runs, a test that records every Git command and every GitHub API request of the Action SHALL find no write operation other than the artifact upload, the cache save and the comment create or update, and SHALL find the same for the `publish: branch` failure of criterion 4 (no write operation at all).

### Requirement 13: README example workflow

**User Story:** As a maintainer, I want a copy-paste workflow in the README, so that I can adopt CE in a few minutes.

#### Acceptance Criteria

1. THE root `README.md` SHALL contain a section that shows an example workflow using `uses: rfxlamia/ce@v0`.
2. THE example SHALL trigger on `pull_request`, check out the repository with `fetch-depth: 0`, start the Subject through `target-start` or `target-url`, and pass `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}` through `env:`.
3. THE example SHALL declare `permissions` with `contents: read` and `pull-requests: write`.
4. THE README section SHALL list every input of the Action_Manifest with its default, the outputs, and the permissions of Requirement 11 criterion 12.
5. THE README section SHALL state that the comment step degrades to a warning and a job summary on fork pull requests, that the Action pushes nothing, and that `publish: branch` is not implemented in this release and fails the step.
6. THE README section SHALL state that `context.redact` patterns that contain a comma cannot pass through the `context-redact` input (the list is split at `,`, F2) and shall be set in `ce.yml`.
7. THE README section SHALL link to the "CI requirements" section for the `pull_request_target` checkout rule (F11).
8. THE example workflow SHALL be valid YAML, and a test SHALL parse the fenced `yaml` block of the example and check that every key under `with:` is an input that the Action_Manifest declares.
9. THE README SHALL NOT contain a Jev key or any credential value, and the example SHALL reference secrets only through `${{ secrets.* }}`.
10. THE README section SHALL state that the PR_Comment is matched by the author `github-actions[bot]`, and that a workflow that posts with a personal access token sets `comment-author` to that account's login. THE README section SHALL state that `base` wins over `context-base`, and that `artifact-name` must be unique per step when set.

### Requirement 14: Dogfooding on this repository

**User Story:** As the maintainer of CE, I want a pull request on this repository to receive a CE comment from the Action, so that issue #12 can be closed with evidence.

#### Acceptance Criteria

1. THE repository SHALL contain a workflow file `.github/workflows/ce.yml` that runs on `pull_request` and uses the Action from the checkout with `uses: ./`.
2. THE workflow SHALL start `examples/demo-app` as the Subject and SHALL pass `OPENROUTER_API_KEY` through `env:` from `secrets.OPENROUTER_API_KEY`.
3. THE workflow SHALL run the Action only WHEN the pull request is a Same_Repo_PR, because a fork pull request has no access to the secret (F13).
4. THE workflow SHALL declare `permissions` of `contents: read` and `pull-requests: write` and no broader permission.
5. THE workflow SHALL pin every third-party action to a commit SHA, as `ci.yml` does (F10).
6. THE workflow SHALL use a `concurrency` group per pull request, so that a newer push supersedes a running CE run and the PR_Comment holds the newest result.
7. WHEN a Same_Repo_PR runs the workflow with the secret set, THE pull request SHALL carry exactly one comment that begins with the Comment_Marker and states the Outcome (manual acceptance check recorded in the pull request description that implements this spec).
8. THE Action SHALL NOT make the CE workflow a required check, and the workflow SHALL NOT change the `ci.yml` jobs.

### Requirement 15: Tests and verification

**User Story:** As a maintainer, I want every part of the Action tested without network, key or browser, so that CI stays keyless and fast.

#### Acceptance Criteria

1. THE tests of this feature SHALL use `FakeJevGateway` wherever a Jev call could occur, and SHALL set no `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` for a call to a real provider.
2. THE tests of the Action_Entry SHALL use a fake of the GitHub API (comments, artifact, cache, refs) and a fake child process, and SHALL make no network call.
3. THE tests SHALL cover the input mapping of Requirement 3 with a property test over generated input sets, checking that each non-empty input appears in exactly one `CE_*` variable or flag, and each empty input appears in none.
4. THE tests SHALL cover the Cache_Key of Requirement 4 criterion 9 with a property test.
5. THE tests SHALL cover the Run_Dir selection of Requirement 6 with examples for zero, one and several new entries, for a pre-existing stale entry, and for an `output.dir` set only in `ce.yml` (not in an input).
6. THE tests SHALL cover the upsert idempotence of Requirement 11 criterion 9, the non-bot comment case of criterion 4, and the pagination case of criterion 10.
7. THE tests SHALL cover the fork, HTTP 403 and other API-failure degradation of Requirement 11 criteria 5, 6 and 8, and the unique artifact names of Requirement 7 criterion 2 for two invocations in one job.
8. THE tests SHALL include the no-write check of Requirement 12 criterion 6, the invalid `publish` value of criterion 3 and the `publish: branch` fail-fast of criterion 4.
9. THE tests SHALL cover the renderer cases of Requirements 8 and 10, with one example per Outcome (`SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR`) and the unavailable-Run_Record case.
10. THE Comment_Renderer, the input mapper, the Cache_Key builder and the Run_Dir selector SHALL import nothing from `jev/` and SHALL call no Jev gateway, and an architecture test SHALL check the import rule.
11. WHEN `npm run typecheck`, `npm test` and `npm run build` run from the repository root, THE three commands SHALL exit with code 0 after this feature is implemented.
12. THE Action_Entry SHALL NOT import the Jev SDK and SHALL NOT call `fetch` for Jev (`jev-gateway-decision`: only `jev/` knows the transports).
