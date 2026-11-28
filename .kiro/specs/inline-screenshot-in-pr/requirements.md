# Requirements Document

## Introduction

This feature implements GitHub issue #47 in rfxlamia/ce, "[M4] Inline screenshots in the PR comment (publish: branch)". It builds on issue #12 (`.kiro/specs/github-action-pr-comment/`), and covers R10.4 of `docs/journal/v0.0/requirements.md` and section 8 of `docs/journal/v0.0/design.md` (`publish: branch`). `SPEC.md` is normative (sections 3.5, 4.3, 4.4, 5.4, 7.1 and 7.2) and wins on any conflict with this document or the journal.

Today the PR_Comment links the workflow Artifact and shows no image. With `publish: branch`, the Action copies selected screenshots of the Evidence_Bundle to an orphan Git branch named `ce-evidence`, commits and pushes them, and builds immutable image URLs from the evidence commit SHA. The PR_Comment then shows the final screenshot inline and the step thumbnails in a `<details>` block. The default (`publish: none`) is unchanged: no write to Git, no image in the comment.

The Action stays a presentation and transport layer. It decides no Outcome: the Outcome comes from `run.json`, which the CE_CLI wrote after `outcome/resolve.ts` decided it. Jev generates no text, and the Action never calls Jev. Tests use `FakeJevGateway`, a fake GitHub API and a bare Git repository as a fake remote, and need no API key and no network. The Action runtime is `node24`.

### Relationship to the github-action-pr-comment spec

The github-action-pr-comment spec deferred this feature (its D8) and fixed three behaviors that this spec replaces. Those spec documents are not edited here. The implementation PR for issue #47 updates the affected tests and README text in the same change.

| Earlier rule (github-action-pr-comment) | Effect of this spec |
| --- | --- |
| D4, F12: `publish` is an Action input only and not a `ce.yml` key | Requirement 1: `publish` is also a `ce.yml` key. |
| D8, Requirement 12.4: `publish: branch` fails the step as "not implemented" | Requirement 2: `publish: branch` is implemented. |
| Requirement 12.1 and 12.6: while Publish_Mode is `none`, no Git write | Unchanged. Requirement 3 states it again. |
| Requirement 12.5: the PR_Comment holds no image reference | Applies only while Publish_Mode is `none`, or the Publish_Result is `fallback` or `not-attempted` (Requirement 9). |
| Requirement 14.4: dogfood workflow permissions are `contents: read` and `pull-requests: write` | Requirement 13: the dogfood workflow adds `contents: write`. |
| Requirement 13.5, 13.9: README says `publish: branch` is not implemented | Requirement 14 replaces that text. |
| Input `github-token` (Requirement 3.2), default `${{ github.token }}` | Requirement 1: input `token` is added, `github-token` stays as an alias, and the default of both inputs becomes the empty string so that the alias can take effect. The `github.token` fallback moves to the internal input `default-token`. |

### Issue checklist traceability

| Issue item | Requirements |
| --- | --- |
| Input `publish: none \| branch`, effective default `none` (empty input), mirrored in `ce.yml` | 1 |
| Copy final screenshot and steps referenced by claims to orphan branch `ce-evidence` at `pr-<n>/<run-id>/`, commit, push | 3, 4, 5, 8 |
| Image URLs from the evidence commit SHA, immutable (private-repo render check: DEFERRED to a tracked follow-up, D13) | 6, 15 |
| Upsert `<!-- ce:report -->` with the final screenshot inline and step thumbnails in `<details>` | 9 |
| Input `token` (effective default `github.token`, carried by the internal input `default-token`, D7) for push and comment, a GitHub App token can be passed in | 1, 5, 7 |
| Edge case: fork PR, skip publish, artifact link plus note `publish skipped: fork PR`, never fail the job | 10 |
| Edge case: concurrent runs, rejected push, fetch and rebase, retry up to 3 times | 5, 16 |
| Edge case: push blocked by branch protection or ruleset, catch, fall back, say why | 11 |
| Edge case: size cap, max N images per run (default 6), skip the rest with a count | 4, 8 |
| Edge case: CE never runs on `ce-evidence` (guard on `GITHUB_REF`) | 12 |
| Tests, unit: URL builder, image selection, fallback reasons | 6, 11, 16 |
| Tests, integration with a fake Git remote (bare repo): orphan create, append, rebase-retry | 16 |
| Workflow permissions `contents: write`, `pull-requests: write` | 13, 14 |
| Done when: a PR on this repo shows the final screenshot inline in the CE comment | 13, 17 |
| Done when: a fork PR degrades to the artifact link without failing (evidence from the integration test only, Requirement 17.3) | 10, 16, 17 |
| Refs: R10.4, Design section 8 | 2 to 9, 14 |
| Steering rules (outcome placement, no Jev text, secrets in env or token inputs, fake Jev in tests, node24) | 2, 7, 16 |
| Review hardening: `comment: false` handling, `not-attempted` result, confirmed commit SHA | 2, 9 |
| Review hardening: per-image byte limit, shallow single-branch fetch, system `git` binary | 5, 8 |
| Review hardening: README warnings on clone weight, permanence and sensitive screenshots | 14 |

### Facts carried over from the earlier spec

- F1. The Action is a node24 JavaScript Action: root `action.yml`, entry source and tests under `action/`, committed bundle under `action/dist/`. The Git implementation is the system `git` binary (D9), so the bundle contains no Git library.
- F2. `RunRecordSchema` (`evidence/schema.ts`) exposes `steps[].screenshot` (a Bundle_Relative_Path, `executed` flag), `finalImage.screenshot` (a Bundle_Relative_Path or `null`), `finalImage.error`, and `artifacts[].{path, kind}` with kind `screenshot`, `log` or `jev-calls`. A step carries no Claim id.
- F3. `ConfigSchema` is strict and rejects keys that match `api-?key|secret|token|password`. A `token` key therefore cannot exist in `ce.yml`.
- F4. `config/env.ts` derives a `CE_*` variable from a dotted key with `envNameForPath`, and the Action input name is the dotted key with `.` replaced by `-`. The staleness test (earlier Requirement 3.8) fails when a `ConfigSchema` leaf has no matching input.
- F5. On a fork pull request GitHub gives the `pull_request` event a read-only token and withholds secrets.
- F6. The comment body limit is 65536 characters, and the Comment_Renderer caps the body at 60000.
- F7. The Comment_Renderer treats every Run_Record string as untrusted and escapes it. Its image output is the one new kind of active Markdown content, so this spec constrains it.
- F8. The Action removes `INPUT_*`, `ACTIONS_*`, `GITHUB_TOKEN`, `GH_TOKEN` and any variable equal to the Run_Token from the CE_CLI child environment. The publish step runs in the Action process, after the CE_CLI ended.

### Decisions and assumptions taken in this document

- D1. `publish` becomes a top-level optional `ce.yml` key with values `none` and `branch`, and the Action input `publish` mirrors it through `CE_PUBLISH`. The Action reads its effective value through the config loader, so the precedence is Action input and environment, then `ce.yml`, then default `none` (`ce run` has no flag for this key). This answers the issue text "mirrored in `ce.yml`". The key shape is an assumption to confirm in design review.
- D2. The issue names the input `token`. The earlier spec shipped `github-token`. This spec adds `token` and keeps `github-token` as an alias; both default to the empty string and the Run_Token is resolved as in D7. The alias avoids a breaking change for workflows written against issue #12.
- D3. The issue says "steps referenced by claims". A Step in the Run_Record has no Claim id (F2), and one run has one loop. The Selected_Images are therefore the final screenshot followed by every executed Step screenshot in Step order, deduplicated. When the Image_Cap or the Image_Byte_Cap removes images, the final screenshot is kept first and the Steps kept are the LAST ones (those closest to the result, which are the most informative), not the first ones. With the default cap of 6 the published set is the final screenshot and the last 5 executed Steps. If design review wants a narrower rule, Requirements 4 and 8 change and nothing else does.
- D4. The `<run-id>` of the branch path is the directory name of the Run_Dir (`run-<iso>`), the same value the artifact name uses. The `<n>` is the pull request number from the Event_Payload.
- D5. The CE guard on `ce-evidence` (Requirement 12) checks `GITHUB_REF`, as the issue says, and also `GITHUB_HEAD_REF` and `GITHUB_BASE_REF`, because for a `pull_request` event `GITHUB_REF` is `refs/pull/<n>/merge` and does not name the branch.
- D6. The publish step never changes the Outcome, the exit code of the CE_CLI or the Run_Record. Every publish failure degrades to the artifact link and never fails the step (same rule as the earlier D5).
- D7. The default of `token` and of `github-token` is the empty string. The Run_Token resolution order is `token`, then `github-token`, then the internal input `default-token` (default `${{ github.token }}`). A JavaScript Action cannot read the `github.token` context directly, so the internal input carries it. A non-empty default on `token` would make the alias unreachable.
- D8. The Git credential is passed to `git` only through environment variables (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`), never through the argument vector, because an argument vector is visible in `/proc/*/cmdline` and in command logs.
- D9. The Publisher uses the system `git` binary through `execFile` with an argument vector. It uses no Git library (no `isomorphic-git` or similar) and no shell. GitHub-hosted runners provide `git`.
- D10. The Publisher runs `git` through an injectable Git_Runner. This is the test seam that lets a test move the Fake_Remote tip between the fetch and the push to produce a real non-fast-forward rejection, and it records every invocation. The Publisher sets `LC_ALL=C` in the `git` environment so that error classification does not depend on the runner locale.
- D11. WHILE `comment` is false and Publish_Mode is `branch`, the Publisher is not called: nothing would show the images, and pushing images that no one sees only adds permanent content to the branch.
- D12. The Publisher is called only when the Outcome read from `run.json` is `EVIDENCED` or `ERROR` (or the Run_Record is unavailable). For `SKIPPED` and `UNSUPPORTED` no runtime ran, so no screenshot can exist (`outcome/resolve.ts` decides `UNSUPPORTED` before the runtime starts), and the Publish_Result is `not-attempted`.
- D13. The Private_Render_Check (Requirement 15) is DEFERRED to a tracked follow-up issue. It does not block merging the implementing pull request or closing issue #47. Until it is done, the README states that inline rendering in a private repository is unverified and that users can fall back to `publish: none`. The "Done when" conditions of issue #47 are the Same_Repo_PR dogfood run showing the inline screenshot and the fork PR degrading without failing. No verification result is recorded or assumed before the check is actually performed.

## Glossary

- **Action**: The GitHub Action defined by the root `action.yml`, used as `uses: rfxlamia/ce@v0`.
- **CE_CLI**: The `ce` command of `packages/ce/` (`ce run`).
- **Run_Record**: The file `run.json` in the Run_Dir.
- **Run_Dir**: The directory `<output.dir>/<run-id>/` that one `ce run` created. Its directory name is the Run_Id.
- **Run_Id**: The directory name of the Run_Dir, for example `run-2026-11-26T09-47-54-277Z`.
- **Evidence_Bundle**: The Run_Dir and every file in it.
- **Artifact**: The workflow artifact that holds the Evidence_Bundle.
- **Artifact_Link**: The URL of the Artifact on the workflow run page.
- **PR_Comment**: The pull request comment that carries the Comment_Marker.
- **Comment_Marker**: The literal text `<!-- ce:report -->`.
- **Comment_Renderer**: The pure function `renderPrComment` in `packages/ce/src/evidence/comment.ts`.
- **Comment_Upserter**: The Action code that finds the PR_Comment by the Comment_Marker and creates or updates it.
- **Publish_Mode**: The effective value of `publish`: `none` or `branch`.
- **Publisher**: The Action module that selects images, writes them to the Evidence_Branch, and returns a Publish_Result. It lives under `action/src/`.
- **Evidence_Branch**: The orphan Git branch `ce-evidence` of the repository that runs the workflow.
- **Evidence_Path**: The directory `pr-<n>/<run-id>/` on the Evidence_Branch, where `<n>` is the pull request number and `<run-id>` is the Run_Id.
- **Evidence_Commit**: The commit on the Evidence_Branch that added the files of one publish, identified by its full 40-character SHA.
- **Selected_Images**: The PNG files chosen for publishing under Requirement 4, in order, before the caps of Requirement 8 apply.
- **Image_Cap**: The maximum number of published images per run. The default is 6.
- **Image_Byte_Cap**: The maximum size in bytes of one published image. The default is 5242880 (5 MiB).
- **Git_Runner**: The Publisher's injectable function that runs the system `git` binary through `execFile` and records each invocation (D9, D10).
- **Confirmed_SHA**: The SHA of an Evidence_Commit that the Publisher has read back from the remote Evidence_Branch after the push (Requirement 5 criterion 12).
- **Image_URL**: `https://github.com/<owner>/<repo>/raw/<sha>/pr-<n>/<run-id>/<file>.png`, built from the Evidence_Commit SHA.
- **Publish_Result**: One of `published` (with the Confirmed_SHA, the Image_URLs and the count of skipped images), `fallback` (with a Fallback_Reason) or `not-attempted` (the Publisher was not called, D11 and D12, and no note is shown).
- **Fallback_Reason**: One value of the closed set `fork-pr`, `no-pr-number`, `no-images`, `token-lacks-write`, `push-blocked`, `push-conflict-exhausted`, `ref-guard`, `git-error`. Each value has one fixed human-readable note (Requirement 10 and 11).
- **Run_Token**: The effective token resolved in the order `token`, `github-token`, `default-token` (D7). It authenticates the push and the comment API calls. The cache and the Artifact calls use the runtime token `ACTIONS_RUNTIME_TOKEN` of the runner and not the Run_Token.
- **Same_Repo_PR**: A pull request whose head repository is the repository that runs the workflow.
- **Private_Render_Check**: The one-time verification of Requirement 15. Its status is DEFERRED to a tracked follow-up (D13); it is not a merge or close precondition for issue #47.
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC section 7.1).
- **Claim**, **Change**, **Check**, **Subject**, **Assessment**, **Evidence**: As defined in SPEC section 3.2.
- **Signal**: A classifier probability. SPEC section 3.5 says it is not a verdict on correctness.
- **Fake_Remote**: A bare Git repository created in a temporary directory, used as the `origin` of the Publisher tests.
- **Comment_Input**: The parameter object of the Comment_Renderer.

## Requirements

### Requirement 1: Publish and token inputs

**User Story:** As a maintainer, I want to switch screenshot publishing on with one input or one `ce.yml` key, and to pass the token I choose, so that I control where images go and who pushes them.

#### Acceptance Criteria

1. THE Action_Manifest SHALL declare the input `publish` with an empty default (the effective default is `none`, so `ce.yml` can enable `branch`), accepting `none` and `branch`.
2. THE ConfigSchema SHALL accept an optional top-level key `publish` with the values `none` and `branch`, THE Action SHALL map the input `publish` to `CE_PUBLISH`, and THE Action SHALL read the effective Publish_Mode through the config loader with the precedence input and environment, then `ce.yml`, then `none` (no flag exists for this key).
3. THE Action_Manifest SHALL declare the input `token` with the default empty string, SHALL declare the input `github-token` with the default empty string, and SHALL declare the internal input `default-token` with the default `${{ github.token }}` (D7).
4. THE Action SHALL resolve the Run_Token in this order: the input `token` WHEN it is non-empty, otherwise the input `github-token` WHEN it is non-empty, otherwise the input `default-token`. A workflow that sets only `github-token: ${{ secrets.APP_TOKEN }}` SHALL therefore use that value.
5. THE Action SHALL use the Run_Token for the Git push (Requirement 5), for the comment calls (Requirement 9) and for no other purpose, SHALL use `ACTIONS_RUNTIME_TOKEN` and not the Run_Token for the cache and Artifact calls, and SHALL accept a GitHub App installation token as the Run_Token.
6. IF the effective Publish_Mode is a value other than `none` or `branch`, THEN THE Action SHALL fail the step before it runs the CE_CLI, with a message that lists the two allowed values.
7. THE ConfigSchema SHALL NOT gain a `token` key, and THE Action SHALL NOT read the Run_Token from `ce.yml` (F3).
8. THE staleness test of the Input_Map SHALL pass with the new `publish` key (the internal input `default-token` is not a ConfigSchema key and is listed as an explicit exemption), and a test SHALL fail WHEN the `ConfigSchema` key `publish` has no input of the same name in the Action_Manifest.
9. WHEN the generated JSON Schema `schemas/ce.schema.json` is rebuilt, THE JSON Schema SHALL contain the `publish` key with its two values.

### Requirement 2: Enabling publish

**User Story:** As a maintainer, I want `publish: branch` to work, so that the screenshots render inline in the PR comment.

#### Acceptance Criteria

1. THE Action SHALL no longer fail the step for the value `branch`, and THE message `publish: branch is not implemented in this release` SHALL be removed from the Action.
2. WHILE Publish_Mode is `branch`, THE Action SHALL run the Publisher after the CE_CLI ended and after the Artifact upload attempt, and before it renders the PR_Comment.
3. WHILE Publish_Mode is `branch` AND the workflow event is not a pull request event, THE Action SHALL skip the Publisher with the Fallback_Reason `no-pr-number`, at the position fixed by criterion 10.
   (The Publisher call conditions of criteria 8 and 9 are checked first.)
4. THE Publisher SHALL run in the Action process and SHALL NOT run in the CE_CLI child process, so that the Run_Token never reaches the Subject (F8).
5. THE Publisher SHALL read only files inside the Run_Dir and SHALL ignore any path that is not a Bundle_Relative_Path.
6. THE Publisher SHALL decide no Outcome, SHALL NOT modify the Run_Record, and SHALL NOT change the CE_CLI exit code that the Action returns.
7. THE Action source under `action/src/` SHALL import nothing from `jev/`, SHALL NOT import the Jev SDK and SHALL NOT call `fetch` for Jev, and the architecture test of the earlier spec SHALL cover the new Publisher files.
8. WHILE the input `comment` is false AND Publish_Mode is `branch`, THE Action SHALL NOT call the Publisher, SHALL return the Publish_Result `not-attempted` (check 1 of criterion 10), and SHALL write one notice to the workflow log that says images are not published because the comment is disabled (D11).
9. WHEN the Outcome in the Run_Record is `SKIPPED` or `UNSUPPORTED`, THE Action SHALL NOT call the Publisher and SHALL return the Publish_Result `not-attempted` (check 2 of criterion 10, D12). WHEN the Outcome is `EVIDENCED` or `ERROR`, or the Run_Record is unavailable, THE Action SHALL continue with the checks that follow in criterion 10.
10. WHILE Publish_Mode is `branch`, THE Action SHALL run these pre-Publisher checks in this order and SHALL stop at the first check that applies, with the stated result:
    1. `comment` is false: Publish_Result `not-attempted` (criterion 8).
    2. The Outcome is `SKIPPED` or `UNSUPPORTED`: Publish_Result `not-attempted` (criterion 9).
    3. The event is not a pull request event: `fallback` with `no-pr-number` (criterion 3).
    4. The pull request is a fork pull request (Requirement 10 criteria 1 and 6): `fallback` with `fork-pr`.
    5. The pull request head or base ref is the Evidence_Branch (Requirement 12 criterion 5): `fallback` with `ref-guard`.
    6. Only when none of checks 1 to 5 applied, THE Action SHALL call the Publisher.
    THE Publisher SHALL still return `no-images` when its own selection is empty (Requirement 4 criterion 6).

### Requirement 3: No write while Publish_Mode is none

**User Story:** As a maintainer, I want the default behavior to stay read-only for Git, so that adding or updating CE changes nothing in my repository history.

#### Acceptance Criteria

1. WHILE Publish_Mode is `none`, THE Action SHALL run no `git push`, `git commit`, `git branch`, `git checkout`, `git fetch` and `git config`, and SHALL call no GitHub API route that creates a ref, a commit, a tree or a blob.
2. WHILE Publish_Mode is `none`, THE PR_Comment SHALL contain no image reference and no `<details>` block of images.
3. WHILE Publish_Mode is `none`, THE Action SHALL behave byte-identically to the behavior defined by the github-action-pr-comment spec, apart from the new inputs, and the existing no-write test SHALL pass.
4. THE Action SHALL NOT write to the working tree of the repository under test, to the current branch, to the remote refs other than the Evidence_Branch, or to the Git configuration of the repository (local, global or system).

### Requirement 4: Image selection

**User Story:** As a reviewer, I want the final screenshot first and the steps that led to it after it, so that the comment shows the result before the path.

#### Acceptance Criteria

1. THE Publisher SHALL select the Selected_Images from the Run_Record in this order: first `finalImage.screenshot` WHEN it is non-null, then the `screenshot` of every Step whose `executed` field is true, in Step order (D3). The caps of Requirement 8 are applied after this selection and keep the final screenshot and the last Steps.
2. THE Publisher SHALL remove duplicate paths from the Selected_Images and SHALL keep the first occurrence.
3. THE Publisher SHALL select only files that meet all of these conditions: the path is a Bundle_Relative_Path, the path ends in `.png` (case-insensitive), the file exists inside the Run_Dir after symbolic links are resolved, and the file is a regular file.
4. THE Publisher SHALL select no `log` and no `jev-calls` Artifact entry, no `run.json`, no `report.html` and no other non-PNG file.
5. WHEN the Run_Record is unavailable, THE Publisher SHALL select nothing and SHALL return the Fallback_Reason `no-images`.
6. WHEN the Publisher was called (Requirement 2 criterion 9) AND the Selected_Images list is empty after criteria 1 to 4, THE Publisher SHALL make no Git call, SHALL write nothing, and SHALL return the Fallback_Reason `no-images`.
7. IF a candidate path resolves outside the Run_Dir, THEN THE Publisher SHALL skip that path and SHALL write a warning that names the Step number and not the path text.
8. THE Selected_Images selection SHALL be a pure function of the Run_Record and a directory listing (file sizes come from the listing), and FOR ALL Run_Records the function SHALL return a list without duplicates, in which the first element is the final screenshot WHEN the final screenshot exists and the remaining elements are in Step order (property test with fast-check).
9. THE Publisher SHALL name each published file with the base name of its Bundle_Relative_Path. IF two Selected_Images have the same base name, THEN THE Publisher SHALL prefix the later one with its zero-based position and a hyphen so that every published name on the Evidence_Path is unique. THE implementation SHALL carry a code comment at that rule that says the names are already unique because `runtime/loop.ts` writes `step-N.png` and `step-N-final.png`, and that the rule is a safeguard.

### Requirement 5: Orphan branch commit and push

**User Story:** As a maintainer, I want the images stored on one orphan branch that shares no history with my code, so that publishing never touches the code history.

#### Acceptance Criteria

1. WHEN the Evidence_Branch does not exist on the remote, THE Publisher SHALL create it as an orphan branch with no parent commit and no file other than the published files.
2. WHEN the Evidence_Branch exists on the remote, THE Publisher SHALL fetch it and add a new commit on top of it, and SHALL keep every earlier file on that branch unchanged.
3. THE Publisher SHALL copy each Selected_Image to the Evidence_Path, `pr-<n>/<run-id>/<file>.png`, and SHALL add, commit and push in one Evidence_Commit.
4. THE Publisher SHALL perform the Git work in a temporary directory outside the repository working tree (a separate `git init` or a separate worktree), SHALL use no checkout of the Evidence_Branch in the repository under test, SHALL fetch only the Evidence_Branch with `git fetch --depth 1` (no other branch, no tags, no full history), and SHALL remove the temporary directory when it finishes, also when it fails. THE Publisher SHALL create the temporary directory with `mkdtemp` under `RUNNER_TEMP` (falling back to `os.tmpdir()` WHEN `RUNNER_TEMP` is unset) with mode 0700.
5. THE Publisher SHALL give the Evidence_Commit a fixed author name and e-mail that do not come from the user's Git configuration, and a message of the form `ce: evidence for PR #<n> (<run-id>)`. THE message SHALL contain no Claim text, no diff text and no Secret_Value.
6. THE Publisher SHALL authenticate every `git` command that contacts the remote with the Run_Token through environment variables only: `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.extraheader` (or the equivalent header key for the host) and `GIT_CONFIG_VALUE_0=<Authorization header>`, where the header value is `AUTHORIZATION: basic <base64("x-access-token:" + Run_Token)>`. THE Publisher SHALL NOT pass the Run_Token or the header in the argument vector of any `git` invocation (no `-c http.extraheader=...`), SHALL NOT write it into a URL, into a Git configuration file or into a log, and SHALL NOT use a shell command line (D8).
7. IF the push is rejected because the remote Evidence_Branch moved (a non-fast-forward rejection), THEN THE Publisher SHALL fetch the Evidence_Branch again with `--depth 1`, rebase the Evidence_Commit onto the new tip (or re-create it on that tip with the same files and message), and push again, and SHALL repeat that sequence for at most 3 retries after the first attempt.
8. IF the push is still rejected after the third retry, THEN THE Publisher SHALL return the Fallback_Reason `push-conflict-exhausted`.
9. WHEN two Publisher runs for different pull requests or different Run_Ids push concurrently, THE Evidence_Branch SHALL end with both sets of files, because their Evidence_Paths do not overlap (integration test, Requirement 16).
10. WHEN the Evidence_Path already exists on the Evidence_Branch (a re-run with the same Run_Id), THE Publisher SHALL overwrite the files at that path in the new commit and SHALL NOT fail.
11. THE Publisher SHALL NOT force-push, and SHALL NOT delete or rewrite any commit on the Evidence_Branch.
12. THE Publisher SHALL return the Publish_Result `published` only after the push succeeded AND the Publisher read the remote Evidence_Branch back (for example with `git ls-remote`) and confirmed that the full 40-character SHA of its Evidence_Commit is reachable from or equal to the remote tip. THE returned SHA SHALL be that Confirmed_SHA and not the SHA of a commit that a rebase replaced. IF the confirmation fails, THEN THE Publisher SHALL return the Fallback_Reason `git-error`.
13. THE Publisher SHALL run no Git hook of the repository under test, and SHALL ignore a `core.hooksPath` setting of the user or the repository.
14. THE Publisher SHALL run the system `git` binary through `execFile` with an argument vector, SHALL use no Git library and no shell, and SHALL run every `git` command through the Git_Runner (D9, D10).
15. THE Publisher SHALL set `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` in the environment of every `git` command, so that the classification of Git errors (Requirement 11) does not depend on the locale, no command waits for input, and the global and system Git configuration (`core.hooksPath`, `commit.gpgsign`, `user.*`, a duplicate `http.extraheader`) has no effect.

### Requirement 6: Immutable image URLs

**User Story:** As a reviewer, I want image links that keep working after the branch moves, so that an old PR comment still shows the screenshot it describes.

#### Acceptance Criteria

1. THE URL builder SHALL return `https://github.com/<owner>/<repo>/raw/<sha>/pr-<n>/<run-id>/<file>.png`, where `<sha>` is the full 40-character Evidence_Commit SHA, and SHALL NOT use the branch name `ce-evidence` in any Image_URL.
2. THE URL builder SHALL take `<owner>/<repo>` from `GITHUB_REPOSITORY` and SHALL take the host from the GitHub server URL (`GITHUB_SERVER_URL`, default `https://github.com`), so that a GitHub Enterprise Server host works.
3. THE URL builder SHALL percent-encode each path segment (`<run-id>` and `<file>`) and SHALL reject a `<sha>` that is not 40 lowercase hexadecimal characters, a `<n>` that is not a positive integer, and a segment that contains `/`, `..`, a control character or an empty string.
4. FOR ALL valid inputs, THE URL builder SHALL be deterministic, and parsing the returned URL SHALL give back the same owner, repository, SHA, pull request number, Run_Id and file name (round-trip property test with fast-check).
5. FOR ALL pairs of Evidence_Commits with different SHAs, THE Image_URLs of the same file SHALL differ.
6. THE Action SHALL treat the content at an Image_URL as immutable, because the URL names a commit and the Publisher never rewrites commits (Requirement 5 criterion 11).

### Requirement 7: Token handling and permissions

**User Story:** As a security-minded maintainer, I want the push and comment token to stay out of logs, files and the Subject, so that enabling publish does not widen the attack surface.

#### Acceptance Criteria

1. THE Action SHALL send the Run_Token only in transient `Authorization` credentials of requests and Git commands to the GitHub host named by `GITHUB_SERVER_URL` and `GITHUB_API_URL`, and SHALL NOT write it to a log, an output, a file, the Run_Record, the job summary or the PR_Comment.
2. THE Action SHALL register the Run_Token, its base64 form `base64("x-access-token:" + Run_Token)` and the full Authorization header value as masked values in the workflow log, before it starts the first `git` command.
3. THE Action SHALL strip every Secret_Value, the Run_Token, its base64 form and the Authorization header value from every Git error message, from every warning and from the PR_Comment before it writes them (`redactSecretValues`).
4. THE Action SHALL NOT pass the Run_Token to the CE_CLI child process in any variable (earlier Requirement 5 criterion 10 stays in force).
5. THE Action SHALL need the workflow permissions `contents: write` and `pull-requests: write` only WHILE Publish_Mode is `branch`, and SHALL keep working with `contents: read` and `pull-requests: write` WHILE Publish_Mode is `none`.
6. IF the Run_Token lacks `contents: write`, THEN THE Publisher SHALL return the Fallback_Reason `token-lacks-write` WHEN the remote rejects the push with an authorization error (HTTP 403 or a `Permission denied` message), and the fallback note SHALL name `contents: write`.
7. THE Action SHALL read no credential from `ce.yml`, and no committed file of this feature SHALL contain a token value (steering "Jev provider and secrets").
8. A test with a Run_Token of a known random value SHALL assert that neither the raw value nor its base64 form (`base64("x-access-token:" + value)`) appears in any captured log line, any argument vector recorded by the Git_Runner, any file in the temporary directory after the Publisher ends, or any PR_Comment body, including when the push fails. THE test SHALL also assert that the base64 form and the header value are registered for masking.

### Requirement 8: Image cap

**User Story:** As a reviewer, I want a bounded number of images, so that one noisy run cannot bloat the branch or the comment.

#### Acceptance Criteria

1. THE Publisher SHALL publish at most Image_Cap images per run. WHEN the Selected_Images list is longer than the Image_Cap, THE Publisher SHALL keep the final screenshot (WHEN it exists) and the last Steps, so that with the default cap the published set is the final screenshot and the last 5 executed Steps (D3). THE Publisher SHALL keep the published images in the order of Requirement 4 criterion 1.
2. THE Image_Cap SHALL default to 6.
3. THE Action SHALL accept a different Image_Cap through the input `publish-max-images`, mirrored as the `ce.yml` key `publish-max-images` and the variable `CE_PUBLISH_MAX_IMAGES`, with a positive integer value up to 50. IF the value is not a positive integer up to 50, THEN THE config loader SHALL report the error as for any other invalid key.
4. WHEN Selected_Images holds more than the Image_Cap, THE Publisher SHALL skip the images that are not kept under criterion 1, SHALL NOT copy them to the Evidence_Branch, and SHALL return the count of skipped images in the Publish_Result.
5. WHEN images were skipped for any reason (cap or size), THE PR_Comment SHALL state the count in the form `(+N more screenshots in the artifact)` (Requirement 9 criterion 8).
6. FOR ALL Run_Records, Image_Caps and Image_Byte_Caps, THE number of published images SHALL equal `min(count of Selected_Images within the Image_Byte_Cap, Image_Cap)`, published plus skipped SHALL equal the selected count, and WHEN the final screenshot is within the Image_Byte_Cap it SHALL be published (property test with fast-check).
7. THE skipped images SHALL stay in the Artifact, and the Artifact upload SHALL NOT depend on the Image_Cap.
8. THE Publisher SHALL enforce the Image_Byte_Cap per image, with the default 5242880 bytes, configurable through the input `publish-max-image-bytes`, mirrored as the `ce.yml` key `publish-max-image-bytes` and the variable `CE_PUBLISH_MAX_IMAGE_BYTES`, with a positive integer value up to 20971520. IF the value is not a positive integer up to 20971520, THEN THE config loader SHALL report the error as for any other invalid key.
9. WHEN a Selected_Image is larger than the Image_Byte_Cap, THE Publisher SHALL skip it before the Image_Cap is applied, SHALL NOT copy it, and SHALL count it as skipped. THE oversize image SHALL NOT use a slot of the Image_Cap, and the oversize image stays in the Artifact.

### Requirement 9: PR comment with inline images

**User Story:** As a reviewer, I want to see the final screenshot in the comment, so that I judge the run without opening the artifact.

#### Acceptance Criteria

1. WHEN the Publish_Result is `published`, THE Comment_Renderer SHALL show the final screenshot as an inline Markdown image whose URL is the Image_URL, placed after the Rationale_Line and before the Artifact_Link.
2. WHEN the Publish_Result is `published` AND the Run_Record has Step screenshots among the published images, THE Comment_Renderer SHALL show them in one `<details>` block with a `<summary>` line, as thumbnails in Step order. Each thumbnail SHALL be an HTML `<img>` tag (Markdown images cannot carry a width) with the attributes `src` (the Image_URL), `alt` (the fixed vocabulary of criterion 4) and `width` (the fixed integer 160), each in double quotes. THE Comment_Renderer SHALL write attribute values only from the validated Image_URL, the fixed vocabulary and the fixed integer, and SHALL HTML-escape `&`, `<`, `>`, `"` and `'` in every attribute value, so that no string of the Run_Record reaches an attribute.
3. THE Comment_Renderer SHALL take the Image_URLs only from the Publish_Result, as a parameter of the Comment_Input, and SHALL perform no I/O, no Git call and no network call (the purity rule of the earlier Requirement 8.1 stays).
4. THE Comment_Renderer SHALL give each image alternative text from a fixed vocabulary (`final screenshot`, `step <k> screenshot`) and SHALL use no Claim text and no other Run_Record string in the alternative text or in the image URL.
5. THE Comment_Input SHALL carry the fields `repository` (`<owner>/<repo>` from `GITHUB_REPOSITORY`), `serverUrl` (from `GITHUB_SERVER_URL`) and `prNumber`, in addition to the Publish_Result. THE Comment_Renderer SHALL accept an Image_URL only WHEN it matches the pattern of Requirement 6 criterion 1 for those `serverUrl`, `repository` and `prNumber`, and SHALL drop any other URL, so that untrusted text cannot introduce an image (F7). THE accepted URL SHALL contain no character outside `A-Z a-z 0-9 . _ ~ % / : -`.
6. WHEN the Publish_Result is `fallback`, THE PR_Comment SHALL contain no image reference and no `<details>` block of images, SHALL keep the Artifact_Link, and SHALL contain the one-line note of the Fallback_Reason (Requirements 10 and 11).
7. WHEN the Publish_Result is `published` AND the Artifact_Link is non-empty, THE PR_Comment SHALL keep the Artifact_Link as the way to the full Evidence_Bundle.
8. WHEN the Publish_Result reports skipped images, THE PR_Comment SHALL show the line `(+N more screenshots in the artifact)`. WHEN a `<details>` block is rendered, the line SHALL end that block. WHEN no `<details>` block is rendered (only the final screenshot is published), the line SHALL follow the final screenshot. N SHALL equal the skipped count of the Publish_Result plus the number of published Step thumbnails that the Comment_Renderer dropped under criterion 10.
9. THE PR_Comment SHALL keep every property of the earlier Requirements 8 and 10: the Comment_Marker exactly once on the first line, the Outcome on the next line, the length limit of 60000 characters, the escaping of untrusted text, and the word rules of SPEC section 3.5.
10. WHEN the full body would exceed 60000 characters, THE Comment_Renderer SHALL drop the Step thumbnails first (and increase N of criterion 8 by the number dropped, so that the line is still shown), then Claims as in the earlier Requirement 8 criterion 13, and SHALL keep the final screenshot, the Comment_Marker, the Outcome line, the Rationale_Line and the Artifact_Link.
11. WHEN the Publish_Result is `not-attempted` (Requirement 2 criteria 8 and 9, which covers the Outcomes `SKIPPED` and `UNSUPPORTED`), THE PR_Comment SHALL be the comment of the earlier spec, with no image reference and no publish note, because no image was expected or the comment is not the place to show it.
12. THE Action SHALL upsert the PR_Comment after the Publisher returned, using the earlier Comment_Upserter and its author-matching rules, so that the PR still holds exactly one comment with the Comment_Marker.
13. THE Action SHALL render a `published` comment only WHEN the Publisher returned `published`, which requires a Confirmed_SHA (Requirement 5 criterion 12). WHEN the push succeeded but the confirmation failed, THE Publisher SHALL return `fallback` with `git-error`, and THE comment SHALL NOT reference the pushed commit.
14. FOR ALL Publish_Results and Run_Records, THE Comment_Renderer SHALL return the same body for the same arguments (determinism), and SHALL contain the Comment_Marker exactly once (property test with fast-check).
15. THE PR_Comment SHALL NOT claim that an image proves correctness, and the image section SHALL use the word "signal" or "observation" and not "passed", "failed", "verified" or "correct" for the Change.

### Requirement 10: Fork pull requests

**User Story:** As a maintainer of a public project, I want fork PRs to get the artifact link and a clear note, so that a read-only token never turns into a failed job.

#### Acceptance Criteria

1. IF the head repository differs from the base repository (a fork pull request, F5), THEN THE Action SHALL skip the Publisher at check 4 of Requirement 2 criterion 10, SHALL make no Git call, and SHALL use the Fallback_Reason `fork-pr`.
2. WHEN the Fallback_Reason is `fork-pr`, THE PR_Comment SHALL contain the Artifact_Link and the exact note `publish skipped: fork PR`.
3. WHEN the PR_Comment cannot be posted on a fork pull request, THE Action SHALL write the same body, with the note, to the job summary, as the earlier spec requires.
4. THE Action SHALL NOT fail the step, and SHALL NOT change the exit code, because of the fork condition.
5. THE Action SHALL decide the fork condition from the Event_Payload (`pull_request.head.repo.full_name` against `pull_request.base.repo.full_name`), and SHALL NOT call the GitHub API for it.
6. IF the Event_Payload lacks the head or base repository name, THEN THE Action SHALL treat the pull request as a fork and use the Fallback_Reason `fork-pr`.
7. THE Action SHALL document in the README that fork pull requests never publish images (Requirement 14).

### Requirement 11: Push failures and fallback reasons

**User Story:** As a maintainer, I want a clear reason in the comment when images could not be published, so that I can fix the setting instead of guessing.

#### Acceptance Criteria

1. IF the push is blocked by branch protection or a repository ruleset (the remote rejects the push with a protected-branch or ruleset message, or a hook-declined response), THEN THE Publisher SHALL catch the error, SHALL return the Fallback_Reason `push-blocked`, and SHALL NOT retry.
2. IF any other Git or network error occurs, THEN THE Publisher SHALL catch it and return the Fallback_Reason `git-error`.
3. THE Publisher SHALL NEVER throw to its caller: every error becomes a `fallback` Publish_Result, and the step does not fail because of publishing (D6).
4. THE Publisher SHALL map each Fallback_Reason to one fixed note, of at most 200 code points, as a pure function (`fallbackNote(reason)`). The notes SHALL be:
   - `fork-pr`: `publish skipped: fork PR`
   - `no-pr-number`: `publish skipped: not a pull request event`
   - `no-images`: `publish skipped: no screenshots in this run`
   - `token-lacks-write`: `publish skipped: the token cannot push (needs contents: write)`
   - `push-blocked`: `publish skipped: push to the ce-evidence branch was blocked by branch protection or a ruleset`
   - `push-conflict-exhausted`: `publish skipped: the ce-evidence branch kept changing, gave up after 3 retries`
   - `ref-guard`: `publish skipped: CE does not publish for the ce-evidence branch`
   - `git-error`: `publish skipped: a Git error occurred (see the workflow log)`
5. THE note SHALL contain no raw Git error text, no token, no URL with credentials, and no remote output, and THE raw detail, redacted, SHALL go only to the workflow log as a warning.
6. THE Action SHALL write one warning to the workflow log for each `fallback` Publish_Result WHEN the Fallback_Reason is not `no-images` and not `no-pr-number`.
7. FOR ALL Fallback_Reasons, THE note SHALL be non-empty, SHALL be a single line, and SHALL differ from the note of every other Fallback_Reason (property test).
8. WHEN the Publish_Result is `fallback`, THE Action output `artifact-url` and the comment link SHALL be exactly as they would be WHILE Publish_Mode is `none`.
9. WHEN the Publish_Result is `fallback`, THE Action SHALL NOT delete or modify a previously published image of an earlier run, and an earlier PR_Comment version is replaced only by the upsert.

### Requirement 12: No loop on the evidence branch

**User Story:** As a maintainer using a GitHub App token, I want CE never to react to its own evidence commits, so that a push to the evidence branch cannot start a loop of runs.

#### Acceptance Criteria

1. IF `GITHUB_REF`, `GITHUB_HEAD_REF` or `GITHUB_BASE_REF` names the Evidence_Branch (`ce-evidence` or `refs/heads/ce-evidence`), THEN THE Action SHALL NOT run the CE_CLI, SHALL NOT run the Publisher, SHALL NOT upload an Artifact, SHALL NOT post a PR_Comment, SHALL write a notice to the workflow log, and SHALL end the step with exit code 0 (D5).
2. WHEN the guard of criterion 1 applies, THE Action SHALL set the output `outcome` to the empty string and the output `exit-code` to 0.
3. THE guard SHALL run before the Browser_Cache restore and before any Git or GitHub API call.
4. THE guard SHALL match exactly the branch name `ce-evidence` and SHALL NOT match a branch that merely contains the text, such as `feature/ce-evidence-docs`.
5. THE Action SHALL refuse to publish (check 5 of Requirement 2 criterion 10) WHEN the pull request head or base ref is the Evidence_Branch, with the Fallback_Reason `ref-guard` (defense in depth), and the Publisher SHALL apply the same check again before its first Git call.
6. THE dogfood workflow SHALL exclude the Evidence_Branch from its triggers (`branches-ignore` for push events if present, and a job condition for pull request events), so that the guard of criterion 1 is the second line of defense and not the only one.
7. THE guard SHALL be a pure function of the environment (`isEvidenceBranchRun(env)`), and FOR ALL generated environments the function SHALL return true if and only if one of the three variables equals `ce-evidence` or `refs/heads/ce-evidence` (property test with fast-check).

### Requirement 13: Dogfood on this repository

**User Story:** As the maintainer of CE, I want a PR on this repository to show the final screenshot inline, so that issue #47 closes with evidence.

#### Acceptance Criteria

1. THE workflow `.github/workflows/ce.yml` SHALL set `publish: branch` for the Action step, and SHALL declare `permissions` of exactly `contents: write` and `pull-requests: write`, and no other permission, replacing the earlier Requirement 14.4 for this file.
2. THE workflow SHALL keep the earlier conditions: pull request trigger, Same_Repo_PR only, `examples/demo-app` as Subject, `OPENROUTER_API_KEY` through `env:` from `secrets.OPENROUTER_API_KEY`, third-party actions pinned to a commit SHA, and a `concurrency` group per pull request.
3. THE workflow SHALL contain the condition of Requirement 12 criterion 6.
4. WHEN a Same_Repo_PR runs the workflow with the secret set, THE pull request SHALL carry exactly one comment that begins with the Comment_Marker and shows the final screenshot inline, and the Image_URL of that screenshot SHALL return the PNG for a viewer with repository access (manual acceptance check, recorded in the description of the pull request that implements this spec).
5. THE dogfood workflow SHALL skip fork pull requests through its job condition, so a workflow run on a fork pull request SHALL NOT be evidence for the fork path. THE fork path (a fork pull request ends successfully with the Artifact_Link and the note `publish skipped: fork PR`) SHALL be proved by the integration test of Requirement 16 criterion 9.
6. THE workflow SHALL NOT become a required check, and SHALL NOT change the jobs of `ci.yml`.

### Requirement 14: Documentation

**User Story:** As a maintainer, I want the README to explain publish, its permissions and its limits, so that I enable it knowingly.

#### Acceptance Criteria

1. THE root `README.md` SHALL replace the statement that `publish: branch` is not implemented with a description of `publish: none | branch`, the default `none`, and the `ce.yml` key `publish`.
2. THE README SHALL list the inputs `publish`, `publish-max-images`, `publish-max-image-bytes` and `token` (with the alias `github-token`) with their defaults, SHALL note that `default-token` is an internal input that users need not set, and SHALL show the permissions `contents: write` and `pull-requests: write` for `publish: branch`, and `contents: read` for `publish: none`.
3. THE README SHALL state that the Action pushes only to the orphan branch `ce-evidence`, under `pr-<n>/<run-id>/`, never to the code branches, and that it never force-pushes.
4. THE README SHALL state the fork behavior (`publish skipped: fork PR`), the branch protection and ruleset fallback, the retry limit of 3 and the Image_Cap default of 6.
5. THE README SHALL state in one paragraph that inline image rendering in a private repository is unverified (the Private_Render_Check is DEFERRED, Requirement 15), SHALL say that a user who needs certainty can set `publish: none` to keep the Artifact link, and SHALL cite the verification file.
6. THE README SHALL tell maintainers to exclude `ce-evidence` from other workflows, and SHALL state that a GitHub App token passed as `token` can trigger workflows on the pushed branch, and that CE guards against its own loop (Requirement 12).
7. THE README SHALL state that published images stay on the branch until a maintainer prunes it, and that this feature has no deletion.
8. THE README example workflow SHALL be valid YAML, and the test of the earlier Requirement 13.8 SHALL pass with the new inputs.
9. THE README SHALL contain no credential value.
10. THE README SHALL state the clone-weight trade-off: a plain clone and `actions/checkout` with `fetch-depth: 0` (as the dogfood workflow uses) fetch every branch, including `ce-evidence` and its PNG files, so the branch makes every such clone larger as it grows. THE README SHALL state that the Publisher itself fetches only that branch with `--depth 1`, and SHALL tell maintainers how to avoid the weight (a shallow checkout, `single-branch`, or a refspec that excludes `ce-evidence`).
11. THE README SHALL carry an explicit warning that published images are permanent until a maintainer prunes the branch, unlike Artifacts that expire (about 90 days by default), and that a screenshot can show sensitive data of the Subject (user names, tokens on screen, personal data) that text redaction does not cover. THE warning SHALL say that in a public repository the images are public, and SHALL advise against `publish: branch` when the Subject can show sensitive data.
12. THE README SHALL state the per-image limit (5 MiB by default, `publish-max-image-bytes`) and that oversize images stay in the Artifact and count as skipped.
13. THE README SHALL state that `publish: branch` with `comment: false` publishes nothing, and that CE uses the system `git` binary of the runner.

### Requirement 15: Private repository rendering check (DEFERRED)

**User Story:** As a maintainer of a private repository, I want to know whether inline images render for my reviewers, so that I do not enable a feature that shows broken images.

Status: DEFERRED (D13). The check is a tracked follow-up and does not block merging the implementing pull request or closing issue #47.

#### Acceptance Criteria

1. THE Private_Render_Check SHALL be tracked as a follow-up issue, opened when the implementing pull request is opened, and SHALL NOT be a precondition for merging that pull request or for closing issue #47.
2. WHEN the maintainer performs the Private_Render_Check, THE maintainer SHALL, in a private test repository, publish one PNG with `publish: branch`, post a PR_Comment that holds an Image_URL of the form of Requirement 6 criterion 1, open the comment in a browser as (a) a user with read access and (b) a user without access or logged out, and record the result in `.kiro/specs/inline-screenshot-in-pr/private-repo-image-verification.md` with the date, the repository visibility, the exact URL form tested (owner and repository names redacted), what viewer (a) saw, what viewer (b) saw, and whether the image rendered inline in each case.
3. WHILE the Private_Render_Check has the status DEFERRED, THE README paragraph of Requirement 14 criterion 5 SHALL state that inline rendering in a private repository is unverified and that users can fall back to `publish: none`.
4. WHEN the Private_Render_Check is completed, THE README paragraph SHALL be replaced with the recorded result and SHALL cite the verification file.
5. THE verification file SHALL contain no token, no cookie and no private repository name, and SHALL carry the status `DEFERRED` until the check is performed, then `COMPLETED`.
6. THE implementation SHALL NOT record, imply or assume a verification result before the check has been performed.

### Requirement 16: Tests and verification

**User Story:** As a maintainer, I want the publish path tested without network or key, so that CI stays keyless and fast.

#### Acceptance Criteria

1. THE tests of this feature SHALL use `FakeJevGateway` wherever a Jev call could occur, SHALL set no `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` for a call to a real provider, and SHALL make no network call.
2. THE unit tests SHALL cover the URL builder (Requirement 6), including the round-trip property and the rejection cases of criterion 3.
3. THE unit tests SHALL cover image selection (Requirement 4 and 8), including: final screenshot first, deduplication, non-PNG exclusion, a path outside the Run_Dir, an unavailable Run_Record, zero images, the cap that keeps the final screenshot and the last Steps with the skipped count, and an oversize image counted as skipped without using a cap slot.
4. THE unit tests SHALL cover every Fallback_Reason (Requirement 11): the closed set, the fixed notes, the mapping from a simulated Git error (non-fast-forward, protected branch, ruleset, `Permission denied` or 403, generic) to the Fallback_Reason, and the rule that the note holds no raw error text.
5. THE unit tests SHALL cover the Comment_Renderer cases of Requirement 9: inline final screenshot, `<details>` thumbnails in order, the skipped-count line (with and without a `<details>` block, and with N increased by dropped thumbnails), the fork note, the fallback note, and the dropping order under the length limit.
6. THE integration tests SHALL use a Fake_Remote (a bare repository in a temporary directory) and the injectable Git_Runner, and SHALL cover: creation of the orphan branch (one root commit, no parent, only published files), append on an existing branch (earlier files unchanged, new commit has the old tip as parent), and a rejected push followed by fetch, rebase and a successful retry. THE tests SHALL produce the rejection by advancing the Fake_Remote tip, through the Git_Runner seam, between the Publisher's fetch and its push (D10).
7. THE integration tests SHALL cover: retry exhaustion after 3 retries (the seam advances the Fake_Remote tip before every push, so every push is a genuine non-fast-forward rejection and no hook is involved) with the Fallback_Reason `push-conflict-exhausted`, a push blocked by a remote `pre-receive` hook with the Fallback_Reason `push-blocked`, overwrite of an existing Evidence_Path, two concurrent publishes for different Evidence_Paths, cleanup of the temporary directory after success and after failure, a `git fetch` invocation that names only the Evidence_Branch with `--depth 1`, `LC_ALL=C`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` in the environment of every invocation, and the token present only in the environment entries `GIT_CONFIG_*` and in no argument vector.
8. THE integration tests SHALL assert that the SHA in the Image_URLs equals the SHA of the commit that the Fake_Remote holds at the Evidence_Branch for that commit, and that the branch was never force-pushed (the old tip stays an ancestor of the new tip).
9. THE tests SHALL cover the fork path (no Git call recorded, note present, exit code unchanged), the ref guard of Requirement 12 (including `feature/ce-evidence-docs` not matching), the token tests of Requirement 7 criterion 8, and the `publish: none` no-write test of Requirement 3.
10. THE tests SHALL cover the Input_Map additions (`publish`, `publish-max-images`, `publish-max-image-bytes`, `token`, the `github-token` alias and the `default-token` exemption), the resolution order of D7 (including the case of only `github-token` set), the `comment: false` case (Requirement 2 criterion 8), the `not-attempted` result for `SKIPPED` and `UNSUPPORTED`, the pre-Publisher check order of Requirement 2 criterion 10 (one case per check, and a case where two checks apply and the earlier one wins), with the property test of the earlier Requirement 15.3 and the staleness check.
11. THE architecture test SHALL check that no new file under `action/src/` and `packages/ce/src/evidence/comment.ts` imports `jev/`, calls `fetch` for Jev, or assigns, returns or casts an Outcome literal.
12. WHEN `npm run typecheck`, `npm test` and `npm run build` run from the repository root, THE three commands SHALL exit with code 0, and the committed Action_Bundle SHALL equal the output of the rebuild script (the earlier Requirement 2.5).

### Requirement 17: Done-when traceability

**User Story:** As the maintainer closing issue #47, I want each "Done when" condition tied to a recorded check, so that the issue closes on evidence and not on a claim.

#### Acceptance Criteria

1. THE description of the implementing pull request SHALL contain a table that lists each issue checklist item (the rows of "Issue checklist traceability") with the test file or the manual check that proves it.
2. THE description SHALL link a run of the dogfood workflow on a Same_Repo_PR whose PR_Comment shows the final screenshot inline (Requirement 13 criterion 4), with a screenshot of that comment.
3. THE description SHALL link the output of the fork path check (Requirement 13 criterion 5). Because the dogfood job filters fork pull requests with its `if:` condition, the only evidence for the fork path is the integration test run, and THE description SHALL say so and SHALL NOT cite a workflow run on a fork pull request.
4. THE description SHALL state that the Private_Render_Check is DEFERRED to a follow-up issue (Requirement 15) and SHALL link that follow-up issue. THE description SHALL NOT present the check as done.
5. THE repository SHALL contain a test, `action/traceability.test.ts`, that reads the "Issue checklist traceability" table of this document and fails WHEN a row names a requirement number that does not exist in this document.
6. THE closing comment on issue #47 SHALL cite the pull request, the dogfood run of criterion 2, the fork-path test output of criterion 3, and the follow-up issue of criterion 4.
7. THE "Done when" conditions for closing issue #47 SHALL be (a) the Same_Repo_PR dogfood run showing the final screenshot inline and (b) the fork pull request degrading to the Artifact_Link without failing (proved by the integration test, criterion 3). THE Private_Render_Check SHALL NOT be a "Done when" condition.
