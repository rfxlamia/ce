# Implementation Plan: Inline screenshots in the PR comment (`publish: branch`)

## Overview

This plan implements GitHub issue #47 in TypeScript (Node 22.12+, node24 Action runtime), following `requirements.md` and `design.md` in this directory. Work is ordered so that each step is wired into the next: shared types and inputs first, then the pure Publisher modules, then the Git-backed Publisher, then the extended Comment_Renderer, then the wiring in `action/src/index.ts`, then updates to the earlier github-action-pr-comment tests, the dogfood workflow, the README, the Private_Render_Check record, the traceability test, and the PR checklist.

All tests use `FakeJevGateway`, a fake GitHub API, and a bare Git repository as the Fake_Remote. No test needs an API key or network access. Nothing in this plan edits `outcome/resolve.ts` or any Claim, Check, Assessment, or runtime loop code.

Issue #47 checklist coverage:

| Issue #47 item | Tasks |
| --- | --- |
| Input `publish: none \| branch`, default `none`, mirrored in `ce.yml` | 1.2, 1.3, 8.1 |
| Copy final screenshot and steps to `ce-evidence` at `pr-<n>/<run-id>/`, commit, push | 2.1, 2.3, 4.1, 4.2, 4.4 |
| Immutable Image_URLs from the evidence commit SHA | 2.5, 4.2 |
| Upsert `<!-- ce:report -->` with final screenshot inline, step thumbnails in `<details>` | 5.1, 5.2, 5.3, 5.4, 7.2 |
| Input `token` (default via `default-token`) for push and comment | 1.3, 1.4, 7.1 |
| Fork PR: skip publish, artifact link plus note, never fail | 2.11, 7.2, 7.3 |
| Concurrent runs: rejected push, fetch and rebase, retry up to 3 | 4.2, 4.4 |
| Push blocked by protection or ruleset: catch, fall back, say why | 2.7, 4.2, 4.4 |
| Size cap: max N images (default 6), skip the rest with a count | 2.3, 5.1 |
| CE never runs on `ce-evidence` | 2.9, 7.1, 9.1 |
| Unit tests: URL builder, image selection, fallback reasons | 2.2, 2.4, 2.6, 2.8 |
| Integration tests with a fake Git remote | 4.4 |
| Workflow permissions `contents: write`, `pull-requests: write` | 9.1, 8.3 |
| Done when: PR on this repo shows the final screenshot inline | 9.1, 10.2 |
| Done when: fork PR degrades without failing | 7.3, 10.2 |
| Private_Render_Check (DEFERRED follow-up, not a merge or close precondition) | 9.2, 9.3 |
| README and docs updates | 9.3, 8.3 |
| Update the earlier spec's tests | 8.1, 8.2, 8.3 |
| Traceability and PR evidence | 10.1, 10.2 |

## Tasks

- [x] 1. Foundations: shared types, config keys, Action inputs
  - [x] 1.1 Add shared Publish types
    - Create `packages/ce/src/evidence/publish-types.ts` with `PublishResult` (`published` with `sha`, `imageUrls`, `skippedCount`; `fallback` with `reason`; `not-attempted`) and the closed `FallbackReason` union of eight values
    - Export both types from `packages/ce/src/index.ts` so `action/` imports them from `continuous-evidence`
    - `packages/ce` must not import anything from `action/`
    - _Requirements: 2.8, 2.9, 9.3, 11.4_

  - [x] 1.2 Add `publish`, `publish-max-images`, `publish-max-image-bytes` to the config
    - Extend `ConfigSchema` in `packages/ce/src/config/schema.ts` with optional `publish` (`z.enum(['none','branch'])`), `publish-max-images` (int 1 to 50, default 6) and `publish-max-image-bytes` (int 1 to 20971520, default 5242880)
    - Add the three keys to `ENV_KEY_MAP` so `CE_PUBLISH`, `CE_PUBLISH_MAX_IMAGES`, `CE_PUBLISH_MAX_IMAGE_BYTES` are mirrored by the existing `buildMirrorEntries` and `envNameForPath` code with no new precedence logic
    - Do not add any `token` key (the schema rejects credential-shaped keys)
    - Regenerate `schemas/ce.schema.json` so it contains the three keys
    - Add unit tests for boundaries 0, 1, 50, 51, 20971520, 20971521, and non-integers
    - _Requirements: 1.2, 1.7, 1.9, 8.2, 8.3, 8.8_

  - [x] 1.3 Add Action inputs, `validatePublishMode`, and `resolveRunToken`
    - In `action.yml` add inputs `publish` (default `none`), `publish-max-images`, `publish-max-image-bytes`, `token` (default `''`), change `github-token` default to `''`, and add internal input `default-token` (default `${{ github.token }}`)
    - Replace `validatePublishMode` in `action/src/publish.ts` so `''` and `none` give `none`, `branch` gives `branch`, and any other value throws a message listing the two allowed values; delete the "not implemented" message
    - Create `action/src/token.ts` with `resolveRunToken(token, githubToken, defaultToken)` in the fixed priority order
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 2.1_

  - [x] 1.4 Write property test for Run_Token resolution
    - **Property 5: Run_Token resolution follows the fixed priority regardless of which inputs are empty**
    - File `action/src/token.property.test.ts`
    - **Validates: Requirements 1.4**

- [x] 2. Pure Publisher modules
  - [x] 2.1 Implement image selection and published-name assignment
    - Create `action/src/publish/select.ts` with `selectImages(record, listing)`, `SelectedImage`, `DirectoryEntry`, and a `assignPublishedNames` function (base name, later duplicates prefixed with zero-based position and hyphen, with the code comment required by Requirement 4.9)
    - Final screenshot first, then executed steps in order; deduplicate; accept only existing regular `.png` files with Bundle_Relative_Paths; `undefined` record returns `[]`
    - Return enough information for the caller to warn on a dropped out-of-Run_Dir path by Step number only
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 2.3 Implement the image and byte caps
    - Create `action/src/publish/cap.ts` with `applyCaps(images, imageCap, byteCapBytes)`: drop oversize images first (they use no cap slot), then keep the final screenshot plus the last steps, preserving Requirement 4.1 order
    - Return `kept` and `skippedCount`
    - _Requirements: 8.1, 8.2, 8.4, 8.6, 8.7, 8.9_

  - [x] 2.5 Implement the Image_URL builder and parser
    - Create `action/src/publish/url.ts` with `buildImageUrl` and `parseImageUrl` using the form `${serverUrl}/${owner}/${repo}/raw/${sha}/pr-${n}/${runId}/${file}`
    - Percent-encode `runId` and `file`; reject a non-40-lowercase-hex sha, a non-positive-integer PR number, and segments that are empty or contain `/`, `..`, or control characters
    - `parseImageUrl` returns `undefined` unless the URL matches exactly the pattern for the expected serverUrl, owner, repo, and PR number, and only characters in `A-Z a-z 0-9 . _ ~ % / : -`
    - Take host from `GITHUB_SERVER_URL` (default `https://github.com`) so GitHub Enterprise Server works
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 9.5_

  - [x] 2.7 Implement fallback notes and Git error classification
    - Create `action/src/publish/fallback.ts` with total `fallbackNote(reason)` using the eight fixed notes from Requirement 11.4 (the `token-lacks-write` note names `contents: write`)
    - Add `classifyGitError(error)` mapping 403 or `Permission denied` to `token-lacks-write`, protected-branch, ruleset, or hook-declined messages to `push-blocked`, anything else (including unknown shapes) to `git-error`; it never throws
    - Notes contain no raw error text, token, or URL
    - _Requirements: 7.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_

  - [x] 2.9 Implement the evidence-branch guard
    - Create `action/src/evidence-branch-guard.ts` with `isEvidenceBranchRun(env)` and `isEvidenceBranchRef(ref)`, matching exactly `ce-evidence` or `refs/heads/ce-evidence` on `GITHUB_REF`, `GITHUB_HEAD_REF`, `GITHUB_BASE_REF` and never a substring
    - _Requirements: 12.1, 12.4, 12.5, 12.7_

  - [x] 2.11 Implement the pre-Publisher decision table
    - Create `action/src/publish/decision.ts` with `decidePrePublisher(ctx)` evaluating in this order: comment disabled, Outcome `SKIPPED` or `UNSUPPORTED`, not a PR event, fork PR, evidence-branch ref, proceed
    - Treat an unavailable Run_Record (`outcome` undefined) as "continue"
    - Add `isForkPullRequest(payload)` deciding from the Event_Payload only (head repo full name versus base repo full name; missing names count as a fork), with no GitHub API call
    - _Requirements: 2.3, 2.8, 2.9, 2.10, 10.1, 10.5, 10.6_

  - [x] 2.2 Write property test and unit tests for image selection and naming
    - **Property 1: Selected_Images is ordered, deduplicated, and filtered to real, path-safe PNGs**
    - **Property 12: Published file names are always unique, and collision-free names are left unchanged**
    - Unit cases: final first, duplicates, non-PNG, directory entries, path outside the Run_Dir (`..`), unavailable record, zero images
    - File `action/src/publish/select.property.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 4.9**

  - [x] 2.4 Write property test and unit tests for caps
    - **Property 2: Capping preserves the arithmetic invariant and the ordering, regardless of cap size**
    - Unit cases: default cap 6 keeps final plus last 5 steps; oversize image counted as skipped without using a slot
    - File `action/src/publish/cap.property.test.ts`
    - **Validates: Requirements 8.1, 8.4, 8.6, 8.9**

  - [x] 2.6 Write property tests for the URL builder and parser
    - **Property 3: Image_URL build and parse round-trip, and distinguish every input dimension**
    - **Property 4: parseImageUrl accepts only a URL matching the expected repository context, and rejects adversarial strings**
    - File `action/src/publish/url.property.test.ts`
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 9.5**

  - [x] 2.8 Write property test and unit tests for fallback notes
    - **Property 8: fallbackNote is total, each note is short, single-line, and unique**
    - Unit cases mapping simulated Git errors (non-fast-forward is not classified, protected branch, ruleset, `Permission denied`, 403, generic, unknown shape) to reasons, and asserting notes hold no raw error text
    - File `action/src/publish/fallback.property.test.ts`
    - **Validates: Requirements 11.1, 11.2, 11.4, 11.5, 11.7**

  - [x] 2.10 Write property test for the evidence-branch guard
    - **Property 7: The evidence-branch guard matches the branch name exactly, never a substring**
    - Include `feature/ce-evidence-docs` and `refs/heads/ce-evidence-old` as non-matching examples
    - File `action/src/evidence-branch-guard.property.test.ts`
    - **Validates: Requirements 12.1, 12.4, 12.7**

  - [x] 2.12 Write property test for the decision table
    - **Property 6: The pre-Publisher decision table is total and respects its fixed priority order**
    - Add one example per check and a case where two checks apply and the earlier one wins
    - File `action/src/publish/decision.property.test.ts`
    - **Validates: Requirements 2.3, 2.8, 2.9, 2.10, 10.1**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Git-backed Publisher
  - [x] 4.1 Implement the Git_Runner seam
    - Create `action/src/publish/git-runner.ts` with `GitRunner`, `createGitRunner()` (system `git` via `execFile`, argument vector, no shell, no Git library), `fixedGitEnv()` (`LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`), and `credentialEnv(runToken, host)` building `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0` with the `AUTHORIZATION: basic <base64>` header
    - Non-zero exit rejects with the `GitResult` attached for classification
    - _Requirements: 5.6, 5.13, 5.14, 5.15_

  - [x] 4.2 Implement `publish()` orchestration
    - Create `action/src/publish/publisher.ts`: select, cap, re-check `isEvidenceBranchRef`, `mkdtemp` under `RUNNER_TEMP` (fallback `os.tmpdir()`) with mode 0700, separate `git init`, `git fetch --depth 1` of only `ce-evidence` (missing branch means create orphan), copy files to `pr-<n>/<run-id>/<name>.png`, one commit with fixed author, e-mail, and message `ce: evidence for PR #<n> (<run-id>)`, push with no force
    - On non-fast-forward rejection: fetch again, re-create the commit on the new tip, push again, at most 3 retries, then `push-conflict-exhausted`; other errors go through `classifyGitError`
    - After a successful push, confirm with `git ls-remote`; the Confirmed_SHA is what the Image_URLs use; confirmation failure returns `git-error`
    - Export a pure commit-message builder; remove the temp directory in `finally`; never throw (every failure returns a `fallback` result); return `no-images` with no Git call when the selection is empty
    - Overwrite files at an existing Evidence_Path on a re-run with the same Run_Id; never delete or rewrite commits
    - _Requirements: 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 8.4, 11.1, 11.2, 11.3, 12.5_

  - [x] 4.3 Write property tests for Git invocations and the commit message
    - **Property 10: Git invocations never carry the Run_Token in argv, and always carry the four fixed environment entries**
    - **Property 11: The commit message is a fixed template containing no Claim, diff, or secret text**
    - Use a recording fake `GitRunner`; cover the initial attempt and every retry
    - File `action/src/publish/publisher.test.ts`
    - **Validates: Requirements 5.5, 5.6, 5.15, 7.8**

  - [x] 4.4 Write integration tests against a Fake_Remote
    - File `action/src/publish/publisher.integration.test.ts`, using a bare repository in a temp dir and the real Git_Runner with a seam that can advance the remote tip between fetch and push
    - Cover: orphan creation (one root commit, no parent, only published files), append (earlier files unchanged, old tip is parent), rejected push then fetch and successful retry, exhaustion after 3 retries giving `push-conflict-exhausted` (seam advances tip before every push), `pre-receive` hook rejection giving `push-blocked`, overwrite of an existing Evidence_Path, two concurrent publishes for different paths both surviving, temp directory removed after success and failure, fetch names only `ce-evidence` with `--depth 1`, all four fixed env entries on every invocation, no force-push (old tip stays an ancestor), and Image_URL SHA equals the remote's commit SHA
    - _Requirements: 5.1, 5.2, 5.4, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 6.6, 11.1, 16.6, 16.7, 16.8_

  - [x] 4.5 Write the token-leak test
    - With a random known Run_Token, assert neither the raw value nor `base64("x-access-token:" + value)` appears in any captured log line, any recorded `GitInvocation.args`, any file in the temp dir after the Publisher ends, or any PR_Comment body, including on a failed push; assert the base64 form and header value are registered for masking
    - File `action/src/publish/token-leak.test.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.8_

- [x] 5. Comment_Renderer with inline images
  - [x] 5.1 Extend `renderPrComment` with `publishResult`
    - In `packages/ce/src/evidence/comment.ts` add `publishResult`, `repository`, `serverUrl`, `prNumber` to `CommentInput`; existing `publish: none` call sites pass `{ kind: 'not-attempted' }`
    - `published`: re-validate each URL with `parseImageUrl`, drop mismatches; final screenshot as inline Markdown image after the Rationale_Line and before the Artifact_Link; step thumbnails in one `<details>` block as `<img src alt width="160">` with all attribute values HTML-escaped and `alt` only from `final screenshot` / `step <k> screenshot`; add `(+N more screenshots in the artifact)` (skipped count plus dropped thumbnails)
    - `fallback`: no image markup, `fallbackNote(reason)` line, keep the Artifact_Link
    - `not-attempted`: identical to the earlier renderer output
    - Length ceiling 60000: drop step thumbnails first (increase N), then Claims; never drop the marker, Outcome line, Rationale_Line, final screenshot, or Artifact_Link
    - Keep purity (no I/O) and the word rules of SPEC section 3.5
    - _Requirements: 3.2, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.13, 9.15, 10.2, 11.8_

  - [x] 5.2 Write property test for comment rendering by result kind
    - **Property 13: Comment rendering by publishResult.kind always produces the required structural anchors and never a forged marker, verdict word, or mismatched URL**
    - Reuse the existing hostile Claim text arbitrary and add a `publishResult` arbitrary
    - File `packages/ce/src/evidence/comment.publish.property.test.ts`
    - **Validates: Requirements 9.1, 9.2, 9.4, 9.6, 9.9, 9.11, 9.14, 9.15, 10.2**

  - [x] 5.3 Write property test for length and count ceilings
    - **Property 14: Length and count ceilings drop step thumbnails before Claims, and never drop a required anchor**
    - File `packages/ce/src/evidence/comment.ceiling.property.test.ts`
    - **Validates: Requirements 9.8, 9.10**

  - [x] 5.4 Write renderer example tests
    - One fixture per `publishResult` kind: inline final screenshot, `<details>` thumbnails in Step order, skipped-count line with and without `<details>`, N increased by dropped thumbnails, fork note `publish skipped: fork PR`, each fallback note, `not-attempted` identical to the earlier output, and confirmation-failed case rendering no pushed-commit reference
    - File `packages/ce/src/evidence/comment.publish.test.ts`
    - _Requirements: 9.1, 9.2, 9.6, 9.8, 9.11, 9.13, 10.2, 16.5_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire the Action entry point
  - [x] 7.1 Add the guard, input reading, token resolution, and masking to `main()`
    - In `action/src/index.ts` call `isEvidenceBranchRun(process.env)` as the very first statement, before reading inputs, before the cache restore, and before constructing the GitHub adapters; on `true` log one notice, set `outcome` to `''` and `exit-code` to `0`, and return
    - Read `publish` through `loadConfig` precedence, validate it before running the CE_CLI, read `publish-max-images` and `publish-max-image-bytes`, resolve the Run_Token with `resolveRunToken`, and mask the token, its base64 form, and the full Authorization header before any `git` command
    - Keep the Run_Token out of the CE_CLI child environment
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 2.4, 7.1, 7.2, 7.4, 12.1, 12.2, 12.3_

  - [x] 7.2 Wire the publish pipeline and renderer call
    - After the CE_CLI ends and the Artifact upload attempt, call `decidePrePublisher`; only on `proceed` build the directory listing (reuse the symlink-safe walker, add sizes) and call `publish`; otherwise use the decision as the `PublishResult` directly
    - Write the notice when `comment` is false and mode is `branch`; write one redacted warning per `fallback` result except `no-images` and `no-pr-number`; send raw Git detail only to the log, redacted with `redactSecretValues`
    - Pass `publishResult`, `repository`, `serverUrl`, `prNumber` to `renderPrComment`; upsert the single comment as before, and use the job summary on a fork PR that cannot comment
    - Never change the outcome output, exit code, or Run_Record; never fail the step because of publishing
    - While Publish_Mode is `none`, run no Git command and no ref-creating API call
    - _Requirements: 2.2, 2.4, 2.6, 2.8, 2.9, 2.10, 3.1, 3.3, 3.4, 9.12, 9.13, 10.3, 10.4, 11.3, 11.6, 11.8, 11.9_

  - [x] 7.3 Write wiring tests
    - **Property 9: A log warning is written for every fallback result except the two silent reasons**
    - End-to-end with fakes: fork path (no Git call recorded, note present, exit code unchanged), ref guard including `feature/ce-evidence-docs` not matching, `comment: false`, `SKIPPED` and `UNSUPPORTED` giving `not-attempted`, check order cases, unavailable Run_Record giving `no-images` without a Git call, `publish: none` no-write regression, and the case where only `github-token` is set
    - File `action/src/publish-wiring.test.ts`
    - **Validates: Requirements 11.6**
    - _Requirements: 1.4, 2.3, 2.8, 2.9, 2.10, 3.1, 3.3, 10.1, 10.4, 12.1, 16.9, 16.10_

- [x] 8. Update the earlier github-action-pr-comment tests
  - [x] 8.1 Update the manifest and Input_Map tests
    - In `action/action-yml.test.ts` and the Input_Map staleness test, replace the `github-token` default expectation (now `''`), add `publish`, `publish-max-images`, `publish-max-image-bytes`, `token`, and `default-token` (explicit exemption from staleness), and remove any test asserting that `publish: branch` fails as "not implemented"
    - Add a test that fails when the `ConfigSchema` key `publish` has no input of the same name
    - _Requirements: 1.1, 1.3, 1.8, 2.1, 16.10_

  - [x] 8.2 Widen the architecture test
    - In `action/architecture.test.ts` extend the import-boundary scan to `action/src/publish/**` and `action/src/evidence-branch-guard.ts`: no `jev/` import, no Jev SDK import, no Jev `fetch`, no Outcome literal assigned, returned, or cast; keep `packages/ce/src/evidence/comment.ts` covered
    - _Requirements: 2.7, 16.11_

  - [x] 8.3 Update README and workflow tests
    - In `action/readme.test.ts` replace the "publish: branch is not implemented" assertions with checks for the Requirement 14 content (inputs table, permissions, fork note, retry limit 3, cap default 6, 5 MiB limit, clone-weight and permanence warnings, `ce-evidence` exclusion advice, Private_Render_Check paragraph citing the verification file, no credential value) and keep the embedded workflow YAML validity check
    - In `action/workflow.test.ts` replace the `contents: read` expectation with exactly `contents: write` and `pull-requests: write`, keep the earlier conditions, and add the `ce-evidence` job condition check
    - _Requirements: 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12, 14.13_

- [x] 9. Dogfood workflow, README, and Private_Render_Check
  - [x] 9.1 Update the dogfood workflow
    - Edit `.github/workflows/ce.yml`: set `publish: branch`, set `permissions` to exactly `contents: write` and `pull-requests: write`, keep Same_Repo_PR condition and add `github.head_ref != 'ce-evidence' && github.base_ref != 'ce-evidence'`, keep `fetch-depth: 0`, pinned third-party action SHAs, `OPENROUTER_API_KEY` from `secrets` via `env:`, and the per-PR concurrency group
    - Do not make it a required check and do not change `ci.yml`
    - _Requirements: 12.6, 13.1, 13.2, 13.3, 13.5, 13.6_

  - [x] 9.2 Add the Private_Render_Check record and its validator
    - Create `.kiro/specs/inline-screenshot-in-pr/private-repo-image-verification.md` from a template with the fields: date, repository visibility, exact URL form tested (names redacted), what viewer (a) with read access saw, what viewer (b) without access saw, and whether the image rendered inline in each case; mark it `DEFERRED` (a tracked follow-up, not a merge precondition) until the maintainer performs the manual check and fills in the result; never fill a result before the check is performed
    - Add `action/verification-file.test.ts` asserting the file exists, contains each required field, and contains no token, cookie, or private repository name pattern; the test reports the deferred state without failing, and fails if a completed record leaves a field empty
    - The manual check itself (publish one PNG to a private test repository, open the comment as viewers (a) and (b)) is DEFERRED to a follow-up issue and recorded in this file when performed
    - _Requirements: 15.1, 15.2, 15.5, 15.6_

  - [x] 9.3 Update the README
    - Replace the "not implemented" statement in the root `README.md` with `publish: none | branch`, the default, and the `ce.yml` key; list inputs `publish`, `publish-max-images`, `publish-max-image-bytes`, `token` (alias `github-token`) with defaults and note `default-token` is internal; show permissions for both modes
    - State: pushes only to orphan branch `ce-evidence` under `pr-<n>/<run-id>/`, never force-pushes; fork behavior; protection and ruleset fallback; retry limit 3; Image_Cap default 6; per-image 5 MiB limit with oversize images staying in the Artifact; `publish: branch` with `comment: false` publishes nothing; CE uses the runner's `git`
    - Add the clone-weight trade-off and how to avoid it, the permanence and sensitive-data warning (public repositories show public images), advice to exclude `ce-evidence` from other workflows and the GitHub App token loop note, and that the branch has no deletion
    - Add one paragraph stating that private-repository inline rendering is unverified (check DEFERRED), that users can fall back to `publish: none`, and citing the verification file; no credential value anywhere
    - _Requirements: 10.7, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12, 14.13, 15.3_

- [x] 10. Traceability and PR evidence
  - [x] 10.1 Add the traceability test
    - Create `action/traceability.test.ts` that reads the "Issue checklist traceability" table in `requirements.md` and fails when a row names a requirement number that does not exist in that document
    - _Requirements: 17.5_

  - [x] 10.2 Add the PR checklist for issue #47
    - Create `.ce/pr-checklist-issue-47.md` following the existing `.ce/pr-checklist-issue-*.md` format, with a table mapping each issue checklist item to its test file or manual check, placeholders for: the dogfood workflow run link and screenshot of the inline comment (Same_Repo_PR), the fork-path evidence stated as the integration test run only (not a workflow run on a fork PR), a follow-up-issue item for the DEFERRED Private_Render_Check, and the closing comment text citing the PR, the dogfood run, the fork-path test output and the follow-up issue
    - _Requirements: 13.4, 13.5, 17.1, 17.2, 17.3, 17.4, 17.6, 17.7_

- [x] 11. Rebuild the Action bundle and run root verification
  - Rebuild `action/dist/` with the repository's bundle script so the committed bundle equals a fresh rebuild (the existing `bundle.test.ts` must pass)
  - Run `npm run typecheck`, `npm test`, and `npm run build` from the repository root and fix any failure
  - _Requirements: 16.1, 16.12_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but the property tests are the main guard on the untrusted-input surface (URLs, comment rendering, token handling).
- Each task references specific requirements for traceability.
- Manual steps cannot be done by a coding agent and stay with the maintainer before merge: the dogfood run on a Same_Repo_PR showing the inline screenshot, and setting the repository secret. The one-time Private_Render_Check is DEFERRED to a follow-up issue (Requirement 15, D13) and does not block merging or closing issue #47. Task 10.2 provides the checklist that collects that evidence so the PR can close issue #47.
- Property tests validate universal correctness properties; the Git protocol behavior (orphan create, append, retry, concurrency) is covered by integration tests against the Fake_Remote.
- The Private_Render_Check is a tracked follow-up, not a merge gate. Until it is performed, the README says private-repository rendering is unverified and users can fall back to `publish: none`. Do not record a verification result before the check is performed.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.3", "2.5", "2.7", "2.9", "2.11"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "2.8", "2.10", "2.12"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["4.1", "5.1"] },
    { "id": 5, "tasks": ["4.2", "5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["4.3", "4.4", "4.5"] },
    { "id": 7, "tasks": ["6"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["7.2"] },
    { "id": 10, "tasks": ["7.3", "8.1", "8.2", "9.1", "9.2", "10.1"] },
    { "id": 11, "tasks": ["9.3"] },
    { "id": 12, "tasks": ["8.3", "10.2"] },
    { "id": 13, "tasks": ["11"] },
    { "id": 14, "tasks": ["12"] }
  ]
}
```
