# Implementation Plan: ce-context-resolver

## Overview

This plan implements the Context Resolver (GitHub issue #6) in TypeScript under `packages/ce/src/context/`, plus the shared `packages/ce/src/config/secrets.ts` and the Requirement 13 changes to `config/redact.ts`. Order: shared secret definition, types and glob matcher, Redactor, Budgeter, Candidate_Extractor, then the four Providers, then `resolve.ts` wiring. Each property test sits next to the code it tests. Tests use vitest and fast-check (at least 100 runs per property), need no network, no Jev API key and no Git remote, and nothing in `context/` imports from `jev/`.

## Tasks

- [x] 1. Shared secret definition and `config/redact.ts` changes (Requirement 13)
  - [x] 1.1 Create `packages/ce/src/config/secrets.ts`
    - Define `REDACTED = '[REDACTED]'` here.
    - Implement `collectSecretValues(env)`: `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` always secret when the trimmed value is non-empty; variables matching `CREDENTIAL_KEY_NAME_PATTERN` or `/api[-_]key/i` only when trimmed value has at least 8 characters, is not purely digits and is not in the deny-list (`true`, `false`, `yes`, `no`, `on`, `off`, `null`, `undefined`, `none`, case-insensitive). Return trimmed values without duplicates, longest first. Leave `CREDENTIAL_KEY_NAME_PATTERN` in `config/schema.ts` unchanged.
    - Implement `redactSecretValues(text, secrets)`: split at every `[REDACTED]`, replace secrets (longest first) in each marker-free segment, rejoin, repeat until the text stops changing. Pure, no I/O.
    - _Requirements: 5.3, 13.1, 13.2, 13.6_

  - [x] 1.2 Change `packages/ce/src/config/redact.ts` to use `config/secrets.ts`
    - `buildRedactedConfig` takes environment secrets from `collectSecretValues` and removes every secret value (environment values and values derived from `context.redact` matches in configuration strings) with `redactSecretValues`.
    - Keep the derivation of secrets from `context.redact` matches in `redact.ts`. Re-export `REDACTED` from `./secrets.ts` so the `config/redact.ts` import path stays valid.
    - Update any caller that computes the secret list for `reportConfigFailure` to use `collectSecretValues`.
    - _Requirements: 13.1, 13.2, 13.6_

  - [x] 1.3 Extend the ce-config-loader property tests
    - `config/properties/p16-redaction.test.ts`: add a pattern-named variable (for example `STRIPE_API_KEY`) to the environment generator, and add generated secret values that overlap the marker: `REDACTED` as a pattern-named variable value and `RED` as the value of a named variable. Property 16 must hold (secret removed, `second` equals `first`).
    - `config/properties/p17-redacted-roundtrip.test.ts`: add a pattern-named variable to the environment generator.
    - `config/properties/p12-report-redaction.test.ts`: add a secret from the Secret_Definition.
    - Confirm existing tests in `packages/ce/src/config/` and `packages/ce/src/jev/` pass unchanged otherwise, including `credentials.test.ts` (`OPENROUTER_API_KEY: 'k'`) and `load.test.ts` (`TYPESAFE_API_KEY: 'ts-bbb'`).
    - _Requirements: 13.4, 13.5_

  - [x] 1.4 Write property test for shared secret set
    - **Property 16: `config/secrets.ts` gives `buildRedactedConfig` and the Redactor the same secret set**
    - Generated environments including `REDACTED` and `RED` values; `redactSecretValues(text, collectSecretValues(env))` is idempotent; `buildRedactedConfig` and `collectSecretValues` agree. Add example cases for `OPENROUTER_API_KEY: 'k'`, `TYPESAFE_API_KEY: 'ts-bbb'`, `STRIPE_API_KEY`.
    - File: `packages/ce/src/config/secrets.test.ts`
    - **Validates: Requirements 13.1, 13.2, 13.4, 11.11**

  - [x] 1.5 Update ce-config-loader spec documents
    - `.kiro/specs/ce-config-loader/requirements.md`: Glossary term "Secret" and Requirement 7 criteria 3, 6 and 8, so "Secret" also covers Secret_Variables selected by name pattern and `buildRedactedConfig` removes secrets with the Secret_Value_Function.
    - `.kiro/specs/ce-config-loader/design.md`: text of Property 16 likewise.
    - _Requirements: 13.3_

- [x] 2. Shared types and glob matcher
  - [x] 2.1 Create `packages/ce/src/context/types.ts`
    - `Provenance`, `ReasonCode`, `TruncationReason`, `ChangedFile`, `ChangeContext` (with `change.commits`, `change.claims`, `redactions`, narrowed `providers` and `truncated`), and a raw (pre-budget) context type, as in the design's Shared types.
    - Ensure the whole shape serializes to JSON.
    - _Requirements: 1.7, 3.2, 3.11, 8.4, 8.5_

  - [x] 2.2 Create `packages/ce/src/context/glob.ts`
    - `compileGlob`, `matchesGlob`, `matchesAny`. Only `*` (not `/`) and `**` (across `/`) are wildcards; every other character literal; anchored full-string match. Do not use `fs.glob`.
    - _Requirements: 1.8, 1.16 (matcher of Decision D20)_

  - [x] 2.3 Write unit tests for the glob matcher
    - Table of examples: `a/*.ts` vs `a/b.ts` and `a/b/c.ts`, `a/**.ts`, literal `?`, `[`, `{`. Test that `context.checks` is matched by this matcher and not `fs.glob`.
    - File: `packages/ce/src/context/glob.test.ts`
    - _Requirements: 1.8, 1.16, 11.18_

- [x] 3. Redactor
  - [x] 3.1 Implement `packages/ce/src/context/redact.ts`
    - `redact(text, { secrets, configuredPatterns, textKind, extension? })` returning `{ text, count }`.
    - Pass structure: Private_Key_Block rule on the whole text first (BEGIN-only, END-only, full; in `patch` kind keep diff prefix and line count, in `text` kind one marker; existing markers inside a block belong to the block); split at `[REDACTED]`; per segment apply built-in patterns with Token_Boundary and Decision D12 minimums, the Strict_Credential_Key rule (value at least 8 chars, no whitespace, not digits, not in deny-list, skip Identifier_Shaped_Value unless quoted, skipped for `.css`/`.scss`/`.less`), `redactSecretValues`, and configured patterns (ignore zero-length matches); rejoin; repeat to fixpoint. Count replacements over all passes.
    - Use `compileRedactPattern` from `config/redact-pattern.ts`; a compile failure surfaces as `StageError('context', cause)` (thrown by the caller in resolve.ts). Pure function, no file, network or env access.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9, 5.10, 5.12, 5.13, 5.14, 5.15, 5.16_

  - [x] 3.2 Write property test for secret removal
    - **Property 1: Redaction removes every embedded secret**
    - Generated secrets matching built-in patterns, equal to Secret_Variable values, or matching configured patterns, embedded in generated text.
    - File: `packages/ce/src/context/redact.removal.test.ts`
    - **Validates: Requirements 5.1, 5.3, 5.4, 5.7, 5.13, 11.1**

  - [x] 3.3 Write property test for idempotence
    - **Property 2: Redaction is idempotent**
    - Include secret values and configured patterns overlapping the marker (`RED`, `/[A-Z]+/`), anchors, lookarounds and `\b`. Add the example `/^x+$/` with `xxSECRETVAL1xx`.
    - File: `packages/ce/src/context/redact.idempotence.test.ts`
    - **Validates: Requirements 5.5, 5.6, 5.12, 11.2**

  - [x] 3.4 Write property test for Private_Key_Block
    - **Property 15: Private_Key_Block redaction covers every partial and full form**
    - BEGIN-only, END-only and full forms in generated hunk and plain text context; no key body line in output, idempotent, line count and diff prefixes unchanged for `patch` kind. Add examples: block containing an existing marker, text field with BEGIN and no END.
    - File: `packages/ce/src/context/redact.private-key.test.ts`
    - **Validates: Requirements 5.15, 5.16, 11.19, 11.20**

  - [x] 3.5 Write unit tests for key rule and false positives
    - Unchanged: `max_tokens: 4000`, `tokenizer=cl100k_base`, `--color-token: var(--brand-primary)` in `.css`, `showPassword=false`, `secretary: abcdefghijkl`, `SKIP_TOKEN_CHECK=true`, `const token = getToken()`, `{ accessToken: accessToken }`, `nextPageToken = response.nextPageToken`, `task-list-item-container`, `risk-assessment-for-the-project`, `npm_lifecycle_script`, `npm_config_registry`, `desk-lamp-description-text-long`. Redacted: `password = "correcthorsebattery"`, and `api_key = "Zq8vK2mXp9LrT4wB"` becomes `api_key = "[REDACTED]"`. Add the Redactor/`buildRedactedConfig` agreement example (`k`, `ts-bbb`, `STRIPE_API_KEY`, `REDACTED`, `RED`). Invalid configured pattern is rejected by `compileRedactPattern`.
    - File: `packages/ce/src/context/redact.test.ts`
    - _Requirements: 5.2, 5.13, 5.14, 5.11, 11.8, 11.11_

- [x] 4. Budgeter
  - [x] 4.1 Implement `packages/ce/src/context/budget.ts`
    - Export `STATE_BUDGET_TOKENS` (32 000), `CONTEXT_BUDGET_TOKENS` (24 000), `REQUEST_HEADROOM_TOKENS` (8 000), `estimateTokens` (`ceil(length/3)`), `estimateTokensOf` (sum of per-field), `truncateToTokens` (line boundary, else code point boundary, never split a surrogate pair), `fitCheckResults` (failed before skipped/passed), and `budget(context)`.
    - `budget`: fixed-field reduction in order (oldest commit, description, claims from last, title), file ranking (Low_Priority, Test, User_Facing, other per Requirement 7.2 and Decision D21; ties by path byte order), phase 1 path/oldPath reservation, phase 2 patch fill with line-boundary cut and later patches emptied as `dropped`, Truncation_Records with Pseudo_Paths. No record when everything fits.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.15, 7.16, 4.6_

  - [x] 4.2 Write property tests for budget bound, determinism and phase 1
    - **Property 7: Budgeted text never exceeds the Context_Budget, and budgeting is deterministic**
    - **Property 8: A file that fits phase 1 stays in `change.files`**
    - Include a title alone over budget, a single very long line, and shuffled file order.
    - File: `packages/ce/src/context/budget.test.ts`
    - **Validates: Requirements 7.1, 7.4, 7.5, 7.6, 7.9, 7.11, 11.4, 11.16**

  - [x] 4.3 Write property tests for truncation and check capping
    - **Property 9: Truncation never splits a UTF-16 surrogate pair**
    - **Property 10: Check_Result capping keeps failed results first** (covers `fitCheckResults`; the 200-result cap in resolve.ts is tested in task 8.6)
    - File: `packages/ce/src/context/budget.truncate.test.ts`
    - **Validates: Requirements 7.14, 7.15, 7.16, 11.16**

  - [x] 4.4 Write unit tests for ranking and phases
    - A patch that uses the whole budget still leaves later `path`s in `change.files`; a deleted file ranks after a modified one; `README.md` ranks with other files and `CHANGELOG.md` is Low_Priority; no records when within budget.
    - File: `packages/ce/src/context/budget.rank.test.ts`
    - _Requirements: 7.2, 7.6, 7.7, 7.12, 11.16_

- [x] 5. Candidate_Extractor
  - [x] 5.1 Implement `packages/ce/src/context/candidates.ts`
    - `extractCandidates(context)`: sources in fixed order (`--claim` unsplit, title, description, commits oldest first, Comment_Lines); sentence/list-item splitting per Decision D6 for title/description/commits only, skipping fenced code, headings, HTML comments, table rows and unchecked task-list items (Decision D32) there; Comment_Line extraction from `+` lines per extension table including `/* */` continuation and Python docstrings, never split further; Directive_Comment filter (Decision D31); text is always an exact trimmed slice of its source field; dedup keeping first Provenance; cap 50 with `<candidates>`/`candidate-cap` record; ids `c1…` after dedup and cap; location `<path>:<line>` for comment lines. Reads only redacted, budgeted data; never imports from `jev/`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 4.5_

  - [x] 5.2 Write property tests for candidates
    - **Property 11: Every Claim_Candidate is a substring of its named source field** (fields include comment lines of every syntax)
    - **Property 12: De-duplication keeps first occurrence; ids are sequential**
    - **Property 13: Candidate cap keeps the first 50 in extraction order**
    - File: `packages/ce/src/context/candidates.test.ts`
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.6, 9.7, 9.12, 11.3**

  - [x] 5.3 Write unit tests for candidate extraction
    - 72-column wrapped commit message gives one candidate per sentence; `/** … */` block with `*` continuations gives no list items and exact `<path>:<line>`; `<!-- -->` in a Markdown diff gives a candidate, the same comment in the description does not; Directive_Comments (`eslint-disable-next-line`, `# noqa`, `@ts-expect-error`, `@ts-ignore`, line-1 shebang, `Copyright 2025 Example`) give none while an ordinary neighbor gives one; `--claim` text keeps provider `cli`.
    - File: `packages/ce/src/context/candidates.examples.test.ts`
    - _Requirements: 9.7, 9.8, 9.9, 9.10, 9.14, 9.15, 9.16, 11.12, 11.17, 11.25, 11.26_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Providers
  - [x] 7.1 Implement `packages/ce/src/context/providers/cli-args.ts`
    - `resolveCliArgs`: `--claim` values in order with provenance `cli` and location `--claim[n]`; `--base` with location `--base`; `no-input` when neither.
    - _Requirements: 1.4, 1.5, 3.7, 4.3, 4.4_

  - [x] 7.2 Implement `packages/ce/src/context/providers/github-event.ts`
    - `resolveGithubEvent` with injected `readFile`: pull request title, body, base sha/ref, head sha; push `before`; `source-absent` when path unset, unreadable or payload has neither shape. No process.env access.
    - _Requirements: 1.3, 3.9, 4.3, 4.4_

  - [x] 7.3 Implement `packages/ce/src/context/providers/git.ts`
    - `resolveGit` with injected `exec`. Use the Decision D16 options, `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, `-z`, `maxBuffer` 16 MiB, no remote access.
    - Sequence: work tree check (`not-a-repository`), base resolve (`base-unresolved`), head (default `HEAD`; carry `head-missing` flag), merge-base (`merge-base-missing`), Stage 1 `--name-status -z -M` with no pathspec, Sensitive_File classification on lower-cased base name of `path` and `oldPath` (Decision D24 list), `context.include`/`context.exclude` via `glob.ts` (Sensitive exclusion not configurable), Stage 2 in Patch_Batches (50 entries, 65 536 bytes, ascending path, positive pathspecs, `exclude,glob,icase` Sensitive excludes), match patches by (`path`, `oldPath`) and discard orphans, retry oversize batch one by one, Raw_Patch_Limit 1 MiB drop whole, binary, `env-file`/`sensitive-file`/`dropped` records, commit list `--no-merges` oldest first, `git-failed` for other failures, never forward stderr into `reason`. Status map: added/copied to `added`, deleted, renamed, otherwise `modified`.
    - _Requirements: 1.1, 1.2, 1.8, 1.9, 1.10, 1.11, 1.14, 1.15, 1.18, 1.19, 1.20, 1.21, 2.4, 2.5, 2.6, 2.8, 2.9, 2.12, 2.13, 3.4, 3.5, 3.6, 3.11, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.9, 10.6, 10.7_

  - [x] 7.4 Implement `packages/ce/src/context/providers/junit.ts`
    - `resolveJunit` with injected `listFiles`, `lstat`, `readFile`. Reject absolute or `..` paths and symlinks (`source-malformed`), files over 10 MiB (`source-malformed`), `not-configured`, `source-absent` for no match, first failing file's code when none parses. One Check_Result per testcase named `<classname>.<name>` or `<name>`; `failed`/`skipped`/`passed`; ascending path order then document order. Add a small XML parser dependency to `packages/ce/package.json` with DTD processing disabled and external entities not resolved; note the chosen option in a code comment.
    - _Requirements: 1.6, 1.12, 1.13, 1.16, 1.17, 1.22, 1.23, 3.8, 3.12, 3.13, 4.3, 4.4_

  - [x] 7.5 Write unit tests for cli, github-event and junit providers
    - Fixtures for each used and unavailable path and Reason_Code (`no-input`, `source-absent`, `not-configured`, `source-malformed`, `source-unreadable`), glob matching no file, symlink, absolute path, `..`, 10 MiB+ file, and a DTD with an external entity that must not read the referenced file.
    - Files: `packages/ce/src/context/providers/*.test.ts`
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.13, 1.17, 1.22, 1.23, 3.7, 3.8, 3.9, 3.12, 3.13, 11.6, 11.10, 11.24_

  - [x] 7.6 Write git provider tests with temporary repositories
    - Real temp repo, no remote. Cover: not-a-repository, base-unresolved, merge-base-missing (shallow clone), git-failed without stderr text in status; merge-base diff; synthetic merge commit with advanced base branch (only PR files and commits, no merge message); `head-missing`; Env/Sensitive fixtures (deleted `.env`, `.env` renamed to `config.txt` with identical content, `.env.production` to `.env.staging`, `.Env`, `ID_RSA`, `Server.PEM`, `deploy.KEY`, `id_ecdsa`, `id_dsa`, `store.p12`, `store.pfx`, `.netrc`, `.git-credentials`, `.pypirc`) with empty patch and records; identical output under hostile git config with a path containing a space and a non-ASCII character; 120+ files with 100 excluded and one pathspec per requested path with no `git-failed`; orphan patch rename-then-exclude; oversize patch dropped whole and batch retry with a lowered injected `maxBuffer`; binary file; no write to the repository.
    - File: `packages/ce/src/context/providers/git.test.ts`
    - _Requirements: 1.1, 1.2, 1.10, 1.14, 1.15, 1.18, 1.19, 1.20, 1.21, 2.4, 2.8, 2.12, 2.13, 3.4, 3.5, 3.6, 3.11, 6.1, 6.2, 6.3, 6.8, 6.9, 10.7, 11.6, 11.7, 11.9, 11.15, 11.21, 11.22, 11.23_

  - [x] 7.7 Write property test for Provider status reasons
    - **Property 4: Provider status reason is always a fixed code, never raw text**
    - Generated stderr, payload and file content strings fed to each Provider's failure path; `reason` is always one of the ten Reason_Codes and contains no generated text.
    - File: `packages/ce/src/context/providers/reason.test.ts`
    - **Validates: Requirements 3.11, 11.6**

- [x] 8. Resolver wiring
  - [x] 8.1 Implement `selectBaseRef` and `selectHeadRef` in `packages/ce/src/context/resolve.ts`
    - Base priority: `--base`, GitHub payload (`pull_request.base.sha`, else `origin/` + `base.ref`, else push `before`), `context.base`, `origin/main` (provenance `config`, location `default:origin/main`). Push `before` of 40 zeros or not resolving to a commit is ignored without `base-unresolved`. Head: `pull_request.head.sha` when `commitExists`, else `HEAD` with `headMissing: true`. Export both for testing; pure given injected `commitExists`.
    - _Requirements: 2.1, 2.2, 2.3, 2.10, 2.11, 2.13, 3.9_

  - [x] 8.2 Write property test for ref selection
    - **Property 3: Base_Ref and Head_Commit selection follows priority order**
    - Plus examples for each priority level and the Provenance recorded.
    - File: `packages/ce/src/context/resolve.refs.test.ts`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.10, 2.11, 2.13, 11.9**

  - [x] 8.3 Implement `resolveContext` in `packages/ce/src/context/resolve.ts`
    - Accept `{ config, cliOptions, env, cwd, providers? }` with injectable Providers defaulting to the real four (real `fs`/`child_process` wiring).
    - Run Providers independently; select refs; run git; assemble raw context with provenance (`change.provenance` for title, description, base, head); `providers` in fixed order git, github, cli, junit with `used` / `unavailable` and Reason_Codes (including `head-missing` on a used git entry); all-unavailable returns an empty valid context without throwing.
    - Read env once; `collectSecretValues`; compile `context.redact` with `compileRedactPattern`, throwing `StageError('context', cause)` on failure before any text is returned; redact every text field (title, description, commits, claims, patches and paths, check names) accumulating `redactions` (no entry for zero); cap Check_Results at 200 (failed, skipped, passed; original order; `check:<n>`/`check-cap`); then `budget`, then `extractCandidates`.
    - `truncated` order: Provider records (binary, env-file, sensitive-file, dropped) by ascending path, budget records, check cap record, candidate cap record. Deterministic output independent of Provider arrival order. Wrap unexpected errors as `StageError('context', cause)`. No writes to working tree, Git or network.
    - _Requirements: 1.7, 3.1, 3.2, 3.3, 3.10, 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 5.8, 5.9, 5.10, 5.11, 6.6, 7.14, 8.1, 8.2, 8.3, 8.4, 8.5, 9.11, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 8.4 Write property tests for provenance and sensitive file safety
    - **Property 5: Provenance survives redaction and budgeting unchanged**
    - **Property 6: Sensitive file content never reaches the Change_Context** (fake git Provider output with generated Sensitive_File names in mixed case, generated include/exclude)
    - File: `packages/ce/src/context/resolve.invariants.test.ts`
    - **Validates: Requirements 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 11.7**

  - [x] 8.5 Write property test for Provider order independence
    - **Property 14: `resolveContext` is independent of Provider arrival order**
    - Fake injected Providers resolving in generated orders; compare entire `ChangeContext` including array order.
    - File: `packages/ce/src/context/resolve.order.test.ts`
    - **Validates: Requirements 10.4, 11.5**

  - [x] 8.6 Write integration example tests for `resolveContext`
    - All four Providers unavailable returns an empty valid context; bad `context.redact` pattern throws `StageError('context')`; secret in a commit message, `--claim` and payload removed; more than 200 Check_Results give `check:<n>`/`check-cap` with all `failed` kept; `--claim` text keeps provider `cli` when duplicated; result is JSON-serializable; no network or Jev import.
    - File: `packages/ce/src/context/resolve.test.ts`
    - _Requirements: 3.10, 4.7, 5.8, 5.11, 6.6, 7.14, 8.4, 10.5, 11.13, 11.16_

- [x] 9. Public export and documentation
  - [x] 9.1 Export the resolver from `packages/ce/src/context/index.ts`
    - Export `resolveContext`, the types, and the budget helpers (`estimateTokens`, `truncateToTokens`, `fitCheckResults`, budget constants) for the Assessment stage and `ce run`. Re-export nothing from `jev/`.
    - _Requirements: 7.13, 10.8_

  - [x] 9.2 Document CI requirements in the README
    - State: `actions/checkout` needs `fetch-depth: 0`; `pull_request_target` workflows must check out `github.event.pull_request.head.sha` with `fetch-depth: 0` and `head-missing` marks a run that did not; `context.checks` must be a relative path or glob and an absolute path such as `${{ github.workspace }}/…` is rejected with `source-malformed`.
    - _Requirements: 1.24, 2.7, 2.14_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Run `npm run typecheck` and `npm test`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. The issue's "Done when" properties are Property 1 and Property 2 (tasks 3.2, 3.3) and Property 11 (task 5.2); do not skip them if the PR is to close #6.
- Requirement 12 (traceability) is satisfied by the PR body: copy the Traceability tables of `requirements.md` into it and state `Closes #6`. It needs no code task.
- Tasks 1.3 and 1.5 change existing ce-config-loader tests and documents as Requirement 13 requires; other existing tests in `config/` and `jev/` must pass unchanged.
- Nothing in `context/` may import from `jev/`; only `config/secrets.ts`, `config/redact-pattern.ts`, `config/schema.ts` and `errors.ts` are imported from outside `context/`.
- Property tests use at least 100 runs and tag `Feature: ce-context-resolver, Property N`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.3", "3.1", "4.1", "5.1"] },
    { "id": 2, "tasks": ["1.3", "1.5", "3.2", "3.3", "3.4", "3.5", "4.2", "4.3", "4.4", "5.2", "5.3"] },
    { "id": 3, "tasks": ["6"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3", "7.4", "8.1"] },
    { "id": 5, "tasks": ["7.5", "7.6", "7.7", "8.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "8.5", "8.6", "9.1", "9.2"] },
    { "id": 7, "tasks": ["10"] }
  ]
}
```
