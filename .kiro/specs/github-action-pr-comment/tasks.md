# Implementation Plan: GitHub Action and PR Comment

## Overview

This plan implements issue rfxlamia/ce#12, "[M3] GitHub Action + PR comment". The language is TypeScript (Node.js 22.12 or later, ESM, vitest, fast-check, zod), as in `design.md`. Order of work:

1. The packaging spike (Requirement 2.10, 2.11, D9). Nothing else depends on the Action_Bundle until the spike passes.
2. The pure Comment_Renderer in `packages/ce/src/evidence/` and the shared wording in `summary.ts`.
3. The pure Action modules under `action/src/` (inputs, child env, cache key, artifact name, Run_Dir selection, publish check, comment upsert).
4. The Action_Manifest `action.yml`.
5. The GitHub adapters and the entry point that wires the modules together.
6. The committed bundle, its tests, and the architecture test.
7. The README example workflow and the `.github/workflows/ce.yml` dogfooding workflow.

Rules that apply to every task:

- The outcome is decided only in `outcome/resolve.ts`. Nothing under `action/src/` and nothing in `evidence/comment.ts` assigns, returns or casts an Outcome literal (Requirement 9.4).
- Nothing under `action/src/` and nothing in `evidence/comment.ts` imports `jev/`, imports the Jev SDK, or calls `fetch` for Jev (Requirements 15.10, 15.12).
- All tests use `FakeJevGateway` wherever a Jev call could occur, fakes of the GitHub API, cache and artifact services, and a fake child process. They need no API key, no network and no browser (Requirements 15.1, 15.2). The one exception is the packaging verification of task 1.2, which runs the real Chromium installer once on a Linux machine.
- Input values and Claim text are data. Pass them as argument vector entries or environment values and never through a shell command line (Requirement 3.12).
- Property tests use fast-check with at least 100 runs and the tag `Feature: github-action-pr-comment, Property N: <text>`.
- Run commands from the repository root. Do not edit `.kiro/steering/structure.md` (the orchestrator does that, see "Steering follow-up" in `requirements.md`).

## Tasks

- [x] 1. Packaging spike (Requirement 2.10, 2.11, D9)
  - [x] 1.1 Scaffold the `action/` workspace, the rebuild script and the candidate bundle
    - Add `action` to `workspaces` in the root `package.json`. Create `action/package.json`, `action/tsconfig.json` and a minimal `action/src/index.ts` for the spike. The spike entry runs `playwright install chromium` through the Playwright installer, launches Chromium headless, loads `about:blank`, and exits 0.
    - Add the root npm script `build:action` that builds `action/dist/` with a plain npm script and no build orchestration framework. Implement the first candidate: a single-file bundle (esbuild) with `playwright` and `playwright-core` external and shipped as a pruned `action/dist/node_modules/` tree. Implement the second candidate (compiled output plus pruned production `node_modules`) behind the same script, selected by an environment variable or flag, so the spike can compare both.
    - Add the `.gitignore` negations `!action/dist/` and, when `node_modules` is part of the chosen form, `!action/dist/node_modules/`, placed after the `dist/` rule (F1).
    - Make sure the vitest configuration and the root `typecheck` and `build` scripts include the `action` workspace.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.8_

  - [x] 1.2 Verify the packaging form and record the result
    - Create `scripts/verify-action-bundle.mjs`. It copies the repository tree into a temporary directory without any `node_modules/`, runs the packaged `action/dist` entry with Node 24, and asserts that the Chromium install succeeds and that Chromium launches headless and loads a page. Run it on a Linux machine or container.
    - Run the script for each candidate form from task 1.1. Choose the form by bundle size and diff noise, since both keep Playwright's package files on disk.
    - Fill in the "Packaging spike result" section of `.kiro/specs/github-action-pr-comment/design.md` and the decisions list (D9) with the chosen form, the commands, and the result. Save the same text for the pull request description (Requirement 2.11).
    - If both forms fail, record the failure mode and stop. Report it to the user before any later task starts.
    - _Requirements: 2.2, 2.3, 2.6, 2.10, 2.11_

- [x] 2. Shared wording and Comment_Renderer
  - [x] 2.1 Expose the existing APIs that `action/` needs from `packages/ce/src/index.ts`
    - Re-export `ENV_KEY_MAP`, `envNameForPath`, `loadConfig`, `RunRecordSchema`, the `RunRecord` type, `collectSecretValues` and `redactSecretValues`. Re-export only what exists today. The renderer exports come in task 2.11.
    - _Requirements: 3.1, 3.8, 6.1, 6.5, 10.5_

  - [x] 2.2 Export the shared wording from `evidence/summary.ts`
    - Export `rationaleLine`, `oneLine`, `fit`, `clamp` and the `Facts` type. Make `buildSummary` call the exported functions. Change no wording and add no parameter.
    - Run the existing `summary.*.property.test.ts` files unchanged to confirm that `buildSummary` output is byte-identical.
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 2.3 Implement `renderPrComment` and the test arbitraries
    - Create `packages/ce/src/evidence/comment.ts` with `COMMENT_MARKER`, `UnavailableRecord`, `CommentInput`, `renderPrComment` and `stripCommentMarker`, as in the design. Body order: marker line, Outcome line, Claims (at most 10, each at most 200 code points ending in `…`), Rationale_Line from the exported `rationaleLine`, Outcome-specific detail, Artifact_Link or the "artifact unavailable" statement.
    - Escape Markdown and HTML control characters in every untrusted string. Remove every `<!--` sequence. Put `@name` and `#123` in inline code. Apply `redactSecretValues` to the assembled body. Enforce the 60000 character limit by dropping trailing Claims and adding `(+N more claims)`.
    - Handle `UnavailableRecord` with the line `Outcome: unknown (no run record)`, the CE_CLI exit code and no Claim. Read `record.outcome` as data only and use no Outcome literal.
    - Create `packages/ce/src/evidence/comment.arbitraries.ts`: hostile Claim text, `RunRecord` values (reuse the existing evidence arbitraries), `UnavailableRecord` and secret lists.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 9.2, 9.4, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 2.4 Write property test for the marker
    - **Property 1: The Comment_Marker appears exactly once, on the first line**
    - File: `packages/ce/src/evidence/comment.marker.property.test.ts`
    - **Validates: Requirements 8.2, 8.16, 10.3**

  - [x] 2.5 Write property test for hostile Claim text
    - **Property 2: Hostile Claim text cannot forge a marker, a mention, an issue link, or a second active HTML or Markdown construct**
    - File: `packages/ce/src/evidence/comment.hostile-input.property.test.ts`
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.7**

  - [x] 2.6 Write property test for secret redaction
    - **Property 3: Every Secret_Value is absent from the rendered and the written body**
    - File: `packages/ce/src/evidence/comment.secrets.property.test.ts`
    - **Validates: Requirements 10.5, 15.1**

  - [x] 2.7 Write property test for wording and Outcome handling
    - **Property 4: The rendered body never uses a verdict word, and never states an Outcome the input did not carry**
    - File: `packages/ce/src/evidence/comment.wording.property.test.ts`
    - **Validates: Requirements 8.3, 8.8, 8.12, 8.16, 9.4**

  - [x] 2.8 Write property test for length and Claim ceilings
    - **Property 5: The body respects the length and Claim-count ceilings without losing the required lines**
    - File: `packages/ce/src/evidence/comment.length.property.test.ts`
    - **Validates: Requirements 8.13, 8.14, 8.16**

  - [x] 2.9 Write property test for determinism
    - **Property 6: Rendering is deterministic**
    - File: `packages/ce/src/evidence/comment.determinism.property.test.ts`
    - **Validates: Requirements 8.17**

  - [x] 2.10 Write unit tests for the renderer examples
    - File: `packages/ce/src/evidence/comment.test.ts`. One example per Outcome (`SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR`) and the unavailable-record case, each asserting the prose of Requirements 8.6, 8.9, 8.10, 8.11 and 8.8. Add cases for no Claims, the `(+N more claims)` line, an empty Artifact_Link, and `stripCommentMarker`. Assert that the rationale text equals the text `buildSummary` produces for the same record.
    - _Requirements: 8.4, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.13, 9.2, 10.6, 15.9_

  - [x] 2.11 Export the renderer from `packages/ce/src/index.ts`
    - Re-export `renderPrComment`, `stripCommentMarker`, `COMMENT_MARKER`, `CommentInput` and `UnavailableRecord`.
    - _Requirements: 8.1, 9.2_

- [x] 3. Pure Action modules
  - [x] 3.1 Implement the Input_Map in `action/src/inputs.ts`
    - Implement `buildMirrorEntries` from `ENV_KEY_MAP` and `envNameForPath`, and `buildChildInvocation(inputs)` returning `{ env, argv, warnings }`. Non-empty mirror inputs go to one `CE_*` variable. Empty inputs set nothing. `config` and `base` become `--config` and `--base` flags. Each non-empty trimmed `claim` line becomes `--claim <line>`. A line that starts with `--` is skipped and produces a warning that names the 1-based line number and not the text.
    - Do not validate mirror values. Do not build a shell command line.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10, 3.11, 3.12_

  - [x] 3.2 Write property test for the Input_Map
    - **Property 8: The Input_Map sends each non-empty input to exactly one destination, and each empty input to none**
    - File: `action/src/inputs.property.test.ts`. Include `claim` values with lines that start with `--`.
    - **Validates: Requirements 3.3, 3.4, 3.5, 15.3**

  - [x] 3.3 Implement child environment sanitizing in `action/src/env.ts`
    - Implement `sanitizeChildEnv(env, runToken, mirrorEnv)` as in the design. Remove names that start with `INPUT_` or `ACTIONS_`, remove `GITHUB_TOKEN` and `GH_TOKEN`, remove every variable whose value equals a non-empty Run_Token. Keep `CE_*`, `GITHUB_EVENT_PATH` and other `GITHUB_*` variables. Return a new object and do not mutate the input.
    - _Requirements: 5.1, 5.10_

  - [x] 3.4 Write property test for child environment sanitizing
    - **Property 7: Child-environment sanitizing removes every forbidden variable and preserves every other one, under any name collision**
    - File: `action/src/env.property.test.ts`. Add an example test with the six variables of Requirement 5.11 (`INPUT_GITHUB-TOKEN`, `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_CACHE_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`) in `action/src/env.test.ts`.
    - **Validates: Requirements 5.10, 5.11**

  - [x] 3.5 Implement the Cache_Key and Browsers_Path in `action/src/cache.ts`
    - Implement `buildCacheKey(os, arch, playwrightVersion)` and `resolveBrowsersPath(env, platform, home)`. The default path on Linux is `~/.cache/ms-playwright`, on macOS `~/Library/Caches/ms-playwright`, on Windows `%USERPROFILE%\AppData\Local\ms-playwright`. `PLAYWRIGHT_BROWSERS_PATH` wins when set.
    - Add a helper that reads the installed `playwright` version from the bundle.
    - _Requirements: 4.2, 4.9, 4.10_

  - [x] 3.6 Write property test for the Cache_Key
    - **Property 9: The Cache_Key is a pure function that distinguishes every input dimension**
    - File: `action/src/cache.property.test.ts`. Add example tests for `resolveBrowsersPath` in the set and unset cases in `action/src/cache.test.ts`.
    - **Validates: Requirements 4.2, 4.9, 4.10, 15.4**

  - [x] 3.7 Implement artifact naming in `action/src/artifact.ts`
    - Implement `sanitizeArtifactNamePart` (replace each of `"`, `:`, `<`, `>`, `|`, `*`, `?`, `\`, `/`, CR, LF with `-`, same length) and `buildArtifactName`. The default name is `ce-evidence-<runId>-<runAttempt>-<job>-<runDirName>`, each part sanitized before joining. A non-empty `artifact-name` input is used, sanitized, as the whole name.
    - Add `buildArtifactLink` that returns the artifact URL when an id exists, the run URL when it does not, and `''` for a failed upload.
    - _Requirements: 7.2, 7.4, 7.5, 7.6_

  - [x] 3.8 Write property test for artifact names
    - **Property 10: Artifact name sanitizing is total and position-preserving**
    - File: `action/src/artifact.property.test.ts`. Add examples in `action/src/artifact.test.ts` for two invocations in one job that get distinct names, and for the link fallbacks.
    - **Validates: Requirements 7.2, 7.4, 7.5, 15.7**

  - [x] 3.9 Implement Run_Dir location in `action/src/run-dir.ts`
    - Implement `resolveEffectiveOutputDir({ cwd, flags, env })` with `loadConfig`, returning `undefined` on a config error. Implement `listEntries(dir)` (empty list when the directory is absent) and `pickNewRunDir(dir, before, after)` (the one new entry, the newest by modification time among several, or `undefined`).
    - Implement `readRunRecord(runDir)`, which reads `run.json` inside the Run_Dir only, validates it with `RunRecordSchema.safeParse`, and returns `undefined` for an absent, unparsable or invalid file. Ignore any `artifacts[].path` that is not a Bundle_Relative_Path.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 3.10 Write property test for Run_Dir selection
    - **Property 11: Run_Dir selection picks the one new entry, or the newest of several, or none**
    - File: `action/src/run-dir.property.test.ts`. Add examples in `action/src/run-dir.test.ts` for zero, one and several new entries, a stale pre-existing entry, an `output.dir` set only in `ce.yml`, an invalid `run.json`, and a config error.
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 15.5**

  - [x] 3.11 Implement the `publish` check in `action/src/publish.ts`
    - Implement `validatePublishMode(raw)`. An empty value maps to `none`. The value `branch` throws `publish: branch is not implemented in this release` with a pointer to the follow-up issue. Any other value throws a message that lists `none` and `branch`.
    - _Requirements: 12.2, 12.3, 12.4_

  - [x] 3.12 Write unit tests for the `publish` check
    - File: `action/src/publish.test.ts`. Cover the empty value, `none`, `branch` and an invalid value, and check the messages.
    - _Requirements: 12.2, 12.3, 12.4, 15.8_

  - [x] 3.13 Implement the Comment_Upserter in `action/src/upsert.ts`
    - Implement the `CommentApi` interface and `upsertComment(api, pr, commentAuthor, body)`. Read every page of comments. Select comments whose author login equals `commentAuthor` and whose body contains `COMMENT_MARKER`. Update the oldest such comment, or create one when none exists. Never update or delete a comment by another author.
    - Add `describeApiFailure(error)` that returns a warning with the HTTP status, names the missing `pull-requests: write` permission for status 403, and contains no token.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 11.9, 11.10_

  - [x] 3.14 Write unit tests for the Comment_Upserter
    - File: `action/src/upsert.test.ts` with a fake `CommentApi`. Cover idempotence over at least three sequential runs, once with the default author and once with a human login, a marker-bearing comment from another author (including another bot) left untouched, two-page pagination, and the 403 and other failure messages without a token.
    - _Requirements: 11.2, 11.3, 11.4, 11.6, 11.9, 11.10, 15.6_

- [x] 4. Action_Manifest
  - [x] 4.1 Write `action.yml` at the repository root
    - Declare `name`, `description`, `branding`, `runs.using: node24`, `runs.main` pointing at the file of the chosen packaging form under `action/dist/`, the five outputs, the mirror inputs (one per `ConfigSchema` leaf that has a `CE_*` variable, with `.` replaced by `-`; none for `version` and `runtime.fixtures`; none for a credential), and the inputs `config`, `base`, `claim`, `working-directory`, `github-token` (default `${{ github.token }}`), `comment` (default `true`), `comment-author` (default `github-actions[bot]`), `artifact-name` and `publish` (default `none`).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8, 3.1, 3.2, 3.9_

  - [x] 4.2 Write tests for the manifest
    - File: `action/action-yml.test.ts`. Parse `action.yml` with `yaml`. Check Requirement 1 criteria 1 to 5, that `runs.main` exists, that no input carries a credential, and the staleness check: every `ENV_KEY_MAP` key has an input whose name maps back to it, so a new `ConfigSchema` key without an input fails the test.
    - _Requirements: 1.7, 3.1, 3.8, 3.9_

- [x] 5. Adapters and entry point
  - [x] 5.1 Implement the GitHub adapters in `action/src/github.ts`
    - Add `@actions/core`, `@actions/cache`, `@actions/artifact` and an HTTP client for the REST comment routes to `action/package.json`. Implement thin adapters: restore and save cache, install Chromium and Linux packages through the Playwright installer, upload a Run_Dir with files at Run_Dir-relative paths, a `CommentApi` implementation that sends the Run_Token only in the `Authorization` header to the host in `GITHUB_API_URL`, `GITHUB_STEP_SUMMARY` append, and output setting.
    - Define interfaces for each adapter so tests can substitute fakes. Never log the Run_Token.
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 7.1, 7.3, 7.7, 7.8, 11.11_

  - [x] 5.2 Implement the Action entry in `action/src/index.ts`
    - Replace the spike entry. Order: read inputs, `validatePublishMode` (fail before any other side effect), build the child invocation and env, restore the Browser_Cache and install Chromium (fail without running the CLI on install failure), resolve the Effective_Output_Dir and list its entries, spawn `ce run` with the sanitized env and `working-directory` as cwd (arguments as a vector, output streamed), save the cache on a miss, list entries again and pick the Run_Dir, read `run.json`, upload the Artifact, render the comment with `collectSecretValues(process.env)`, apply `redactSecretValues` again to the final body, then upsert or write the job summary.
    - Read only the pull request number and the head and base repository names from the Event_Payload. Skip the comment API for a fork, for `comment: false` and for a non-pull-request event, and write the body without the marker line to `GITHUB_STEP_SUMMARY`. Treat any API failure as a warning, not as a step failure.
    - Set the outputs `outcome`, `run-dir`, `artifact-url`, `comment-url` and `exit-code` (empty string when absent). End the step with the CE_CLI exit code. Fail the step when the process cannot start or ends by a signal, and still try the Artifact upload.
    - _Requirements: 1.6, 3.6, 3.7, 4.1, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.2, 6.4, 6.6, 7.1, 7.6, 10.5, 10.6, 11.5, 11.6, 11.7, 11.8, 12.1, 12.4_

  - [x] 5.3 Write integration tests for the entry with fakes
    - File: `action/src/index.test.ts`, with a fake child process, fake GitHub API, cache and artifact doubles, and `FakeJevGateway` wherever a Jev call could occur. Cover: all five outputs; the child env and argv (Requirement 5.11); a non-pull-request event; a fork pull request; `comment: false`; HTTP 403 and another API failure each leaving the step exit code equal to the CLI exit code; spawn failure and signal exit; an upload failure; a cache restore failure; an install failure that stops before the CLI; a missing Run_Dir; and the `publish: branch` and invalid-value fail-fast paths.
    - Add the no-write check: record every Git command and every GitHub API request. Assert that only the artifact upload, the cache save and the comment create or update appear, and that `publish: branch` produces no write of any kind.
    - _Requirements: 4.6, 4.7, 5.3, 5.5, 5.8, 5.9, 6.4, 7.6, 11.5, 11.6, 11.8, 12.1, 12.3, 12.4, 12.6, 15.2, 15.7, 15.8_

- [x] 6. Committed bundle and architecture test
  - [x] 6.1 Build and commit the Action_Bundle
    - Run `npm run build:action` with the form chosen in task 1.2 and commit the output under `action/dist/` (and `action/dist/node_modules/` when that form is used). Confirm that `git check-ignore` reports neither the `runs.main` file nor a file in `action/dist/node_modules/` as ignored.
    - Re-run `scripts/verify-action-bundle.mjs` against the final bundle.
    - _Requirements: 2.1, 2.3, 2.6, 2.8, 2.9_

  - [x] 6.2 Write tests for the committed bundle
    - File: `action/bundle.test.ts`. Rebuild into a temporary directory and fail when it differs from the committed `action/dist/`. Scan the bundle text for the fixture values of `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY`. Run `git check-ignore` on the `runs.main` file and on a file in `action/dist/node_modules/` when that directory exists.
    - _Requirements: 2.5, 2.7, 2.9_

  - [x] 6.3 Write the architecture test
    - File: `action/architecture.test.ts`, in the style of `outcome/architecture.test.ts`. Check that files under `action/src/` and `packages/ce/src/evidence/comment.ts` import nothing from `jev/`, import no Jev SDK, call no `fetch` for Jev, and contain no assignment, return or cast of an Outcome literal. Check that `inputs.ts`, `cache.ts`, `run-dir.ts` and `comment.ts` import nothing from `jev/`. Widen the existing `evidence/*.ts` boundary glob to include `comment.ts` if it does not already.
    - _Requirements: 9.4, 15.10, 15.12_

- [x] 7. Checkpoint - Ensure all tests pass
  - Run `npm run typecheck`, `npm test` and `npm run build` from the repository root. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 15.11_

- [x] 8. README example workflow
  - [x] 8.1 Add the Action section to `README.md`
    - Add a section with an example workflow that uses `rfxlamia/ce@v0`, triggers on `pull_request`, checks out with `fetch-depth: 0`, starts the Subject with `target-start` or `target-url`, passes `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}` through `env:`, and declares `contents: read` and `pull-requests: write`.
    - List every input with its default, the outputs, and the permissions. State that the comment degrades to a warning and a job summary on fork pull requests, that the Action pushes nothing, that `publish: branch` is not implemented and fails the step, that `context.redact` patterns with a comma belong in `ce.yml`, that `base` wins over `context-base`, that the comment is matched by the author `github-actions[bot]` and `comment-author` handles a personal access token, and that `artifact-name` must be unique per step. Link to the "CI requirements" section for the `pull_request_target` checkout rule. Include no credential value.
    - _Requirements: 11.12, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.9, 13.10, 3.10_

  - [x] 8.2 Write the README test
    - File: `action/readme.test.ts`. Parse the fenced `yaml` block of the example. Check that every key under `with:` is an input declared in `action.yml`, that the permissions are present, and that the README contains no key-like credential value and references secrets only through `${{ secrets.* }}`.
    - _Requirements: 13.8, 13.9_

- [x] 9. Dogfooding workflow
  - [x] 9.1 Add `.github/workflows/ce.yml`
    - Create a workflow separate from `ci.yml` that runs on `pull_request`, declares `permissions` of `contents: read` and `pull-requests: write` only, uses a `concurrency` group per pull request with `cancel-in-progress: true`, and runs the job only when the head repository equals the base repository. Check out with `fetch-depth: 0`, start `examples/demo-app` through `target-start` and `target-url` (confirm the real command and readiness path against `examples/demo-app/package.json`), run the Action with `uses: ./`, and pass `OPENROUTER_API_KEY` from `secrets.OPENROUTER_API_KEY` through `env:`. Pin every third-party action to a commit SHA as `ci.yml` does. Leave `ci.yml` unchanged.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.8_

  - [x] 9.2 Write the workflow test
    - File: `action/workflow.test.ts`. Parse `.github/workflows/ce.yml` and check the trigger, the permissions, the concurrency group, the same-repository condition, `uses: ./`, the secret passed through `env:`, and that each third-party `uses:` is pinned to a 40-character SHA. Check that `ci.yml` has no CE job.
    - _Requirements: 14.1, 14.3, 14.4, 14.5, 14.6, 14.8_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise. Remind the user that Requirement 14.7 (one CE comment on a same-repository pull request with the secret set) is a manual acceptance check to record in the pull request description, together with the packaging result of task 1.2.
  - _Requirements: 14.7, 15.11_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Each task references specific requirements for traceability.
- Task 1 is the packaging spike. No later task starts until task 1.2 records a passing form (D9).
- Issue #12 checklist coverage: `action.yml` and Chromium cache (tasks 1, 3.5, 4, 5); PR context and artifact upload (3.3, 3.7, 5); one marked comment (2, 3.13, 5.2); no pushes unless `publish: branch` (3.11, 5.3); README example (8); Done condition (9, 10).
- Property tests validate universal correctness properties. Unit tests validate fixed protocols and examples.
- The follow-up issue for `publish: branch` (D8) is filed by the user. Reference its number in the `publish: branch` message once it exists.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3", "3.1", "3.3", "3.5", "3.7", "3.9", "3.11", "3.13", "4.1"] },
    { "id": 4, "tasks": ["2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.11", "3.2", "3.4", "3.6", "3.8", "3.10", "3.12", "3.14", "4.2"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2"] },
    { "id": 7, "tasks": ["5.3", "6.1", "6.3"] },
    { "id": 8, "tasks": ["6.2"] },
    { "id": 9, "tasks": ["7"] },
    { "id": 10, "tasks": ["8.1", "9.1"] },
    { "id": 11, "tasks": ["8.2", "9.2"] },
    { "id": 12, "tasks": ["10"] }
  ]
}
```
