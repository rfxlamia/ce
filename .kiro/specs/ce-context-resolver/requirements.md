# Requirements Document

## Introduction

This feature implements the Context Resolver of Continuous Evidence (CE): GitHub issue #6 in rfxlamia/ce, "[M1] Context resolver: providers, redaction, budget, candidates" (label `core`, milestone M1). It implements R3 (context resolution) and R4.1 (claim candidates by extraction only) of `docs/journal/v0.0/requirements.md`, and the `ChangeContext` data model in section 3 of `docs/journal/v0.0/design.md`. `SPEC.md` is normative and wins on any conflict. SPEC section 3.5 requires that the origin of information stays traceable, and section 3.6 requires context over ceremony: CE uses what already describes the Change.

The Context Resolver is the first pipeline stage. It collects what describes a Change from providers, removes secrets, fits the result into the context budget, and extracts Claim candidates. It produces one `ChangeContext`, which the Assessment stage consumes. The redacted and budgeted text that the Assessment stage sends to Jev is read from the `ChangeContext` itself (title, description, commits, claims, file patches). Every later Jev call receives only redacted, budgeted text from this stage.

Code lives in `packages/ce/src/context/`: `providers/git.ts`, `providers/github-event.ts`, `providers/cli-args.ts`, `providers/junit.ts`, `glob.ts` (the shared glob matcher, Decision D20), `redact.ts`, `budget.ts`, `candidates.ts`, `resolve.ts`. Tests use vitest and fast-check and need no network and no API key.

Reuse from existing specs:

- The `context.base`, `context.include`, `context.exclude`, `context.redact` and `context.checks` keys of the Config_Schema (ce-config-loader spec, `config/schema.ts`). In the schema, `context.checks` is a string. This spec adds no config key.
- `compileRedactPattern` from `config/redact-pattern.ts`, so a configured pattern means the same in the Config_Schema and in the Redactor.
- `CREDENTIAL_KEY_NAME_PATTERN` (`/api-?key|secret|token|password/i`) from `config/schema.ts`, to recognize secret variable names. The schema keeps this pattern unchanged.
- `REDACTED` (`[REDACTED]`) from `config/redact.ts`. Because `config/secrets.ts` (new) also needs the marker and `config/redact.ts` imports `config/secrets.ts`, the constant moves to `config/secrets.ts` and `config/redact.ts` re-exports it, so the import path `config/redact.ts` stays valid.
- `StageError('context', cause)` from `errors.ts` for failures that stop the stage.
- The Jev gateway (jev-gateway spec) is not changed. The Context Resolver never imports from `jev/`. It hands redacted text to later stages, and the Redactor is the single place where secrets are removed before a Jev call (Requirement 5).

### Real shape of ChangeContext (design section 3) and extensions

Design section 3 defines:

```ts
type Provenance = { provider: 'git' | 'github' | 'cli' | 'junit' | 'config' | 'runtime'; ref?: string; location?: string };
interface ChangeContext {
  change: { title?: string; description?: string; base?: string; head?: string; files: ChangedFile[]; provenance: Provenance[] };
  candidates: { id: string; text: string; provenance: Provenance }[];
  checks: { name: string; status: 'passed' | 'failed' | 'skipped'; covers?: string[]; provenance: Provenance }[];
  truncated: { file: string; reason: string }[];
  providers: { name: string; status: 'used' | 'unavailable'; reason?: string }[];
}
```

`ChangedFile` is referenced there but not defined. The Provenance type and its `provider` values are not changed by this spec. This spec extends the shape in exactly these places (each is defined in the Requirement named):

- E1. `change.commits: { sha: string; message: string; provenance: Provenance }[]` (new, Requirement 1.2). It is the home of the redacted and budgeted commit messages.
- E2. `change.claims: { text: string; provenance: Provenance }[]` (new, Requirement 1.4). It is the home of the redacted and budgeted `--claim` values. The Claim candidates stay in the top-level `candidates`.
- E3. `ChangedFile = { path: string; oldPath?: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; patch: string; provenance: Provenance }` (defined here, Requirement 1.1 and 1.9). `patch` holds the redacted diff text and is truncated in place by the Budgeter.
- E4. `redactions: { file: string; count: number }[]` (new top-level field, Requirement 5.9). `file` is a path or a Pseudo_Path.
- E5. `providers[].name` is narrowed to `'git' | 'github' | 'cli' | 'junit'`, and `providers[].reason` is narrowed from `string` to the fixed Reason_Code enum (Requirement 3). A Provider_Status with status `used` may carry the Reason_Code `head-missing` (Decision D29).
- E6. `truncated[].reason` is narrowed from `string` to `'dropped' | 'truncated' | 'env-file' | 'sensitive-file' | 'binary' | 'candidate-cap' | 'check-cap'`, and `truncated[].file` is a path or a Pseudo_Path (Requirements 6, 7, 8, 9).
- E7. Outside the `ChangeContext` shape: a new module `config/secrets.ts` that exports the single definition of a secret value (`collectSecretValues`) and the single string function that removes secret values from a text (`redactSecretValues`, Decision D23), and a change to `config/redact.ts` so that `buildRedactedConfig` takes the environment secrets from the first and applies the second (Requirement 5.3, 5.10, Requirement 13). This changes the behavior of ce-config-loader; Requirement 13 defines how that spec and its tests are kept consistent.

### Decisions

These decisions resolve open points of the issue and the journal.

- D1. Budget: the State_Budget of 32 000 estimated tokens stays the hard limit per Jev request. The context text of the Change_Context uses at most the Context_Budget of 24 000 estimated tokens. The remaining 8 000 tokens are reserved for question text, the Claim and the Check_Results that the Assessment stage adds to each request. The budget functions are exported so the Assessment stage can apply them per request.
- D2. Token estimate: `ceil(length / 3)`, where `length` is the number of UTF-16 code units (`String.prototype.length`). The ratio of 3 characters per token is deliberately conservative: code and non-English text produce more tokens per character than English prose (about 4 characters per token), so a ratio of 4 would under-count and exceed the model limit. The estimator is one exported function, so an exact tokenizer can replace it later. The estimate of a set of fields is the sum of the estimates of the fields (the sum of the per-field `ceil`), not the `ceil` of the total length.
- D3. Diff range: the diff is the merge-base diff (`base...head`, three dots), the same range GitHub shows for a pull request, computed from the resolved Merge_Base commit and the resolved head commit (Decision D9). The commit list uses the range `base..head` (two dots) with merge commits excluded (`--no-merges`). Uncommitted changes (staged, unstaged, untracked) do not count, in CI and in a local `ce run`.
- D4. Base ref priority: `--base`, then the GitHub event payload (the pull request base, or `before` of a push event, Decision D18), then `context.base`, then `origin/main`. A pull request base commit (`pull_request.base.sha`) is preferred over a branch name. The default `origin/main` carries Provenance provider `config` with location `default:origin/main`, because the Provenance enum has no separate default value and is not extended.
- D5. `context.checks` is a file path or a glob, relative to the working directory.
- D6. A Sentence ends at terminal punctuation, a blank line, or the start of a list item. A single line break stays inside the Sentence (commit messages wrapped at 72 columns remain one candidate).
- D7. Candidates are capped at 50, counted after de-duplication, in extraction order, and the cut is recorded in `truncated`.
- D8. The Provider_Status `reason` is a fixed enum of codes. Text from git, from files or from payloads never reaches it.
- D9. Head ref: in CI, `actions/checkout` checks out `refs/pull/N/merge` for `pull_request` events, so `HEAD` is a synthetic merge commit that can carry changes of the base branch that are not part of the pull request. The head is therefore `pull_request.head.sha` when the payload names it and that commit exists in the repository, and the commit that `HEAD` points to otherwise. The commit list excludes merge commits, so a synthetic "Merge abc into def" message never becomes a Claim candidate.
- D10. Two-stage git: stage 1 lists the files with `git diff --name-status -z -M` without any pathspec exclude, so every path, every `oldPath` and every rename is known. Stage 2 reads the patches with `git diff -p`, in batches (Decision D25), with case-insensitive pathspec excludes for the Sensitive_Files (Decision D24); a Changed_File that stage 1 identified as sensitive, or that `context.include` or `context.exclude` removed, is never requested in any batch. A single stage with pathspec excludes cannot work: git then does not mention an excluded file at all (no path and status can be returned), and a Sensitive_File renamed to an ordinary name appears as an added file with the full old content. Selecting the wanted files positively, instead of adding one literal exclude per unwanted file, keeps the command line short.
- D11. The Redactor is a fixpoint: it repeats one redaction pass until the output stops changing. Idempotence then holds by definition, because a pass over an output that the loop ended on changes nothing. Termination: a pass replaces only non-empty matches inside marker-free segments, and each replacement removes at least one code unit that is outside a Redaction_Marker and inserts one Redaction_Marker, which cannot overlap another occurrence of the marker (the marker starts with `[` and ends with `]`, so it has no self-overlap). The number of code units outside Redaction_Markers is a non-negative integer that decreases by at least 1 in every pass that changes the text, so the loop ends after at most `length(input)` changing passes. A single pass is not idempotent: with the configured pattern `/^x+$/` and the text `xxSECRETVAL1xx` (where `SECRETVAL1` is a Secret_Variable value), pass 1 gives `xx[REDACTED]xx`, and pass 2 matches both segments `xx`. The same applies to lookarounds, `\b`, and to a value that another secret pattern overwrote in the same segment.
- D12. Token forms of the built-in patterns. A prefix plus a minimum number of token characters without a left boundary redacts ordinary text: `task-list-item-container` contains `sk-list-item-container` (19 characters after `sk-`), and `risk-assessment-…` and `npm_lifecycle_script` match as well. All built-in prefixes therefore require the left boundary `(?<![A-Za-z0-9_-])`, and "token characters" are `[A-Za-z0-9_-]`. A left boundary alone does not fix a word that starts at a boundary (`npm_lifecycle_script` standing alone still has 16 token characters after `npm_`), so the token body is also tightened to the real shape of each credential: `sk-` needs at least 20 token characters and at least one digit or uppercase letter; `npm_` needs at least 36 alphanumeric characters (no `_` and no `-`); `ghp_`, `gho_`, `ghu_`, `ghs_` and `ghr_` need at least 36 alphanumeric characters; `github_pat_` needs at least 22 token characters; `AIza` needs at least 35 token characters; `sk_live_`, `sk_test_`, `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-` and `xoxs-` need at least 16 token characters. Real tokens of these services meet these minimums; ordinary hyphenated or snake_case words do not.
- D13. Secret_Variable: the two variables `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` are always secret, with no condition on length or content, as `buildRedactedConfig` treats them today (the value is trimmed; an empty value after trimming is not a secret). The minimum length of 8 characters and the deny-list of non-secret words apply only to variables selected by name pattern. The name pattern for those variables is `CREDENTIAL_KEY_NAME_PATTERN` or `/api[-_]key/i`, because `CREDENTIAL_KEY_NAME_PATTERN` has `api-?key` and therefore does not match `STRIPE_API_KEY`. The widened pattern lives only in `config/secrets.ts`; the schema pattern is unchanged. A value of one or two characters in a named variable (such as `k`) redacts every occurrence of that character in the context; that cost is accepted for the two named variables, as `buildRedactedConfig` accepts it today.
- D14. One Comment_Line is one Candidate_Source_Field. The candidate text is the comment content after the `+` of the diff and the comment syntax are removed, so the Provenance `location` `<path>:<line>` is exact. A sentence that spans two comment lines is split into two candidates at the line break (a known trade-off of this decision).
- D15. Two-phase budget: phase 1 reserves the space for the `path` and `oldPath` of all Changed_Files, phase 2 fills the patches in rank order. A file that changed therefore stays visible to the Assessment stage even when the patches use up the budget.
- D16. Reproducible git output: git is invoked with `-c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false -c diff.renameLimit=1000 --no-color --no-ext-diff --no-textconv -M --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3`, and paths are read with `-z`, so that user git configuration (`diff.algorithm`, `diff.noprefix`, `diff.mnemonicPrefix`, `color.ui`, `diff.renames`, `core.quotePath`) does not change the Change_Context.
- D17. Check_Results are bounded twice. The resolver keeps at most 200 Check_Results and records the cut with the Pseudo_Path `check:<n>`, where `<n>` is the number of removed Check_Results, with the reason `check-cap`. The Assessment stage MUST truncate the Check_Results of each request with the exported function of Requirement 7.15 so that the Request_Headroom holds; that obligation is recorded here for the assessment spec.
- D18. Push events: for a `push` payload, `before` is the base. A `before` of 40 zeros (a new branch), or a `before` that does not resolve to a commit in the repository (after a force-push the old commit is gone, and a shallow clone may lack it), is ignored and the Base_Ref falls back as usual (`context.base`, then `origin/main`); otherwise an unresolvable `before` would end as `base-unresolved` and disable the Git_Provider. Behavior to document: a push to `main` with `before` set diffs `before...HEAD`; without this rule the diff of a push to `main` would be empty, because `origin/main` equals `HEAD`.
- D19. Key rule for secret values in text (Requirement 5.2) uses a stricter key pattern than the schema: the credential word must be at the END of the key. The rule does not apply to `.css`, `.scss` and `.less` files. `CREDENTIAL_KEY_NAME_PATTERN` stays for the schema and for Secret_Variable names. The rule also skips unquoted values that have the shape of a code identifier (Decision D27).
- D20. Glob matching: `fs.glob` of Node is stable only from Node 22.17 and 24.0 (it is experimental in Node 22.12 to 22.16), and `engines.node` is `>=22.12`. The resolver therefore uses one in-repo matcher in `context/glob.ts` for `context.include`, `context.exclude` and `context.checks`. Only `*` and `**` are wildcards; every other character is literal.
- D21. File ranking: a Changed_File with the status `deleted` ranks as a Low_Priority_File, because a full deletion patch says little about runtime behavior of the result. Markdown files (`.md`, `.mdx`) are not User_Facing_Files; they rank with all other files, except `CHANGELOG`, `HISTORY` and `CHANGES` files, which are Low_Priority_Files. Reason: a README or a changelog describes the Change, which the title and the description already carry, and does not change a rendered page.
- D22. Partial private keys: a diff hunk with 3 lines of context can contain only the `BEGIN` line of a private key, only the `END` line, or neither, so a pattern that needs both markers misses the key material in the hunk. The Redactor therefore applies a structural Private_Key_Block rule before the segment-based rules (Requirement 5.15): it redacts from a `-----BEGIN … PRIVATE KEY-----` line to the matching `END` line, or to the end of the Patch_Hunk (or of the text, outside a patch) when the `END` line is missing, and from the start of the Patch_Hunk to an `END` line when the `BEGIN` line is missing. In a patch the rule keeps the diff prefix and the line count of every covered line, so that the line numbers in the `<path>:<line>` locations of Claim_Candidates after the block stay exact. The rule runs on the whole text, not per marker-free segment, because an existing Redaction_Marker inside the block would otherwise cut the block and leave the rest of the key unredacted. Termination (D11) holds: a block always contains the text of a `BEGIN` or `END` line, which lies outside a Redaction_Marker and is removed. A hunk that lies entirely inside the body of a key and carries no marker line stays a known trade-off.
- D23. One string function for secrets: `config/redact.ts` (`buildRedactedConfig`) today applies `split(secret).join(REDACTED)` once per secret and in one pass. That is not idempotent when a secret value overlaps the marker. Examples: a named variable with the value `RED` turns `[REDACTED]` into `[[REDACTED]ACTED]`, and a pattern-named variable with the value `REDACTED` (8 characters, passes every rule of D13) grows the marker on each call. The existing property test `p16-redaction.test.ts` passes only because its generator prefixes every secret with `sk-` (its comment says this keeps a Secret from overlapping the marker). A shared secret list is therefore not enough: `config/secrets.ts` also exports `redactSecretValues(text, secrets)`, which splits the text at existing Redaction_Markers, replaces every secret value in each marker-free segment, joins the segments with the marker, and repeats until the text stops changing (D11). `buildRedactedConfig` and the Redactor both call it.
- D24. Sensitive_File names are matched case-insensitively, because git pathspec globs are case-sensitive by default, so `.Env` or `ID_RSA` would slip through on macOS and Windows (verified: `:(exclude,glob)**/.env` leaves `.Env` in the diff, `:(exclude,glob,icase)**/.env` removes it). The Stage 1 classification compares the base name in lower case, and the Stage 2 excludes use the pathspec magic `exclude,glob,icase`. The list is extended with `id_ecdsa`, `id_dsa`, `*.key`, `*.p12`, `*.pfx`, `.netrc`, `.git-credentials` and `.pypirc`; `.env`, `.env.*`, `*.pem`, `id_rsa`, `id_ed25519` and `.npmrc` stay.
- D25. Bounded git command lines: the installed git has no `--pathspec-from-file` for `git diff` (verified with git 2.54: that option exists for `add`, `commit`, `reset`, `restore`, `rm` and `checkout`, not for `diff`). One literal exclude per unwanted file can therefore exceed the operating system limit on the length of a command line (`E2BIG` in `execFile`), and the Git_Provider would fall to `git-failed`. Stage 2 therefore requests the wanted files positively, in batches of at most 50 Changed_Files and at most 65 536 bytes of pathspec arguments, in ascending path order, with `path` and `oldPath` of an entry in the same batch. Stage 2 patches are matched to Stage_1_Listing entries by the pair (`path`, `oldPath`); a patch that matches no entry is discarded. Example: `X` renamed to `Y`, `Y` dropped by `context.exclude`; a Stage 2 that sees only `X` would show `X` as a deleted file with its full content, an orphan patch that must not enter the Change_Context. An entry for which Stage 2 returns no patch block gets an empty `patch` and the record `dropped`.
- D26. Bounded raw diff: the raw diff is read and redacted before the Budgeter runs (Requirement 5.8), so a diff of hundreds of megabytes would be read and redacted whole, and the fixpoint of D11 can be quadratic in pathological cases. Every Stage 2 command runs with `maxBuffer` of 16 777 216 bytes (16 MiB). A Changed_File whose raw patch exceeds the Raw_Patch_Limit of 1 048 576 bytes (1 MiB) is dropped whole: empty `patch`, record `dropped`. Never cut a raw patch partially, because a cut can leave half a secret that no pattern matches any more. When a batch exceeds `maxBuffer`, the Git_Provider repeats its entries one by one; an entry that exceeds `maxBuffer` alone is dropped like an oversized patch.
- D27. Identifier-shaped values: the key rule (Requirement 5.2) redacts code such as `const token = getToken()`, `{ accessToken: accessToken }` and `nextPageToken = response.nextPageToken`, because these values have at least 8 characters and no whitespace. The rule skips a value that is unquoted, has no digit, and matches `^[A-Za-z_$][\w$]*(\.[\w$]+)*(\(\))?[,;]?$` (identifier, member access, or call without arguments). A quoted value is a string literal and keeps the rule. Reason to accept the cost: a password written as an unquoted camelCase word without digits passes this rule; it is still caught by Secret_Variable values (Requirement 5.3) and configured patterns (Requirement 5.4). Recorded as a known trade-off.
- D28. Unresolvable push `before`: a `before` that is not a commit of the repository is treated like the all-zeros value (D18): the payload source is skipped and the next source of the priority order is used. Resolution is checked with `git rev-parse --verify --quiet <before>^{commit}`, which contacts no remote.
- D29. Missing head (`pull_request_target`): for `pull_request_target` events, `actions/checkout` checks out the base by default, so `pull_request.head.sha` does not exist in the repository, `HEAD` equals the base, and the diff is empty while the Git_Provider would be recorded as `used` with zero files, without any visible cause. Options: a new Reason_Code, or documentation only. Decision: a new Reason_Code `head-missing`, set on the Git_Provider Provider_Status (status stays `used`) when the payload names a `pull_request.head.sha` that does not exist in the repository, so that the empty or wrong diff is visible in `run.json`; the repository documentation also tells users to check out `github.event.pull_request.head.sha` with `fetch-depth: 0`. Reason: documentation alone cannot be seen in the run result, and the status stays `used` because the Git_Provider did return data (for the checked-out `HEAD`).
- D30. JUnit input limits: absolute paths and `..` segments in `context.checks` are rejected as `source-malformed` (Requirement 1.17); CI users often write `${{ github.workspace }}/…`, so the documentation states that `context.checks` must be relative to the working directory. A `context.checks` value without wildcard is inspected with `lstat`, and a symbolic link is rejected as `source-malformed`. A JUnit XML file larger than 10 485 760 bytes (10 MiB) is not parsed and counts as `source-malformed`.
- D31. Comment_Line noise: filtering is a requirement, not only a trade-off, because the filter is deterministic and testable. A Comment_Line is not a Claim_Candidate when its content is a lint or tool directive (`eslint-disable`, `eslint-enable`, `eslint-disable-next-line`, `noqa`, `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `prettier-ignore`, `istanbul ignore`, `c8 ignore`, `pylint:`, `type: ignore`), a shebang (line 1 of a file that starts with `#!`), or a license header line (starts with `Copyright`, `SPDX-License-Identifier`, `Licensed under` or `All rights reserved`, case-insensitive). Commented-out code remains a known limit: it cannot be told from a comment without parsing.

Assumptions (the issue and the journal leave these open):

- A Sentence is a run of text that ends at `.`, `!` or `?` followed by whitespace or the end of the field, at a blank line, or immediately before a list item. A list item starts with `-`, `*`, `+` or `<digits>.` followed by a space at the start of a line (after optional indentation), and continues over the following non-blank lines that are not themselves list items. Fenced code blocks (``` or ~~~) are not split into candidates.
- The built-in secret patterns are a fixed list in `redact.ts` (Requirement 5.1).
- The GitHub event payload is read from the file named by `GITHUB_EVENT_PATH`. The CLI arguments `--claim` and `--base` are parsed by `cli.ts` and passed to the resolver as an options object.
- `ce run` in GitHub Actions needs the history of the base. The documentation states `fetch-depth: 0` for `actions/checkout` (Requirement 2.7).

Known trade-offs (recorded, not fixed in v0):

- A secret value with whitespace, such as `password: "my secret pass"`, is not redacted by the key rule of Requirement 5.2, because the rule requires a value without whitespace to avoid redacting prose. Built-in patterns, Secret_Variable values and configured patterns still apply.
- A copy of an Env_File to an ordinary name, or a rename whose similarity falls below the rename threshold of git, shows as an ordinary added file and is not recognized as sensitive by path. Only the Redactor protects its content.
- Rename detection depends on git and its rename limit (Decision D16); the same repository gives the same result under the same git version.
- A diff hunk that lies entirely inside the body of a private key and contains neither the `BEGIN` nor the `END` line is not recognized by the Private_Key_Block rule (Decision D22). Only configured patterns and Secret_Variable values can catch it.
- An unquoted password that looks like an identifier (camelCase, no digits, for example `password = correctHorseBattery`) is skipped by the key rule (Decision D27). Secret_Variable values and configured patterns still catch it.
- A file whose raw patch exceeds 1 MiB is dropped whole and contributes no text (Decision D26).
- Commented-out code in a Comment_Line can become a Claim_Candidate (Decision D31).
- Sensitive_Files copied to an ordinary name are still not recognized by path (see above); the extended name list of Decision D24 does not change that.

Out of scope: classifying candidates with Jev and applying the claim threshold (R4.2, R4.3, assessment stage), the Jev gateway, `ce.yml` loading, the CLI command wiring, and writing `run.json` (the resolver supplies the `ChangeContext` that `run.json` embeds).

## Glossary

- **Context_Resolver**: The module `packages/ce/src/context/resolve.ts` and the stage it implements. It produces a Change_Context from Providers.
- **Change_Context**: The `ChangeContext` object defined in design section 3 and extended by E1 to E6 of the Introduction: `change`, `candidates`, `checks`, `truncated`, `providers`, `redactions`.
- **Provider**: A module in `context/providers/` that reads one source of context: Git_Provider, GitHub_Event_Provider, CLI_Provider, JUnit_Provider.
- **Git_Provider**: `providers/git.ts`. Reads the diff of the Change, the changed files and the commit messages.
- **GitHub_Event_Provider**: `providers/github-event.ts`. Reads the pull request title, body, base and head, or the `before` of a push event, from the GitHub event payload.
- **CLI_Provider**: `providers/cli-args.ts`. Reads the `--claim` and `--base` arguments.
- **JUnit_Provider**: `providers/junit.ts`. Reads Check results from JUnit XML.
- **Provider_Status**: One entry of `providers` in the Change_Context: `{ name, status: 'used' | 'unavailable', reason?: Reason_Code }`.
- **Reason_Code**: One value of the fixed enum `not-a-repository`, `base-unresolved`, `merge-base-missing`, `git-failed`, `head-missing`, `source-absent`, `source-unreadable`, `source-malformed`, `no-input`, `not-configured`.
- **Provenance**: The record `{ provider, ref?, location? }` of design section 3 that states where a piece of information came from (SPEC section 3.5).
- **Base_Ref**: The ref that marks where the Change starts, selected under Requirement 2.
- **Head_Commit**: The commit that ends the Change: `pull_request.head.sha` when the payload names it and the commit exists in the repository, and the commit that `HEAD` points to otherwise (Decision D9).
- **Merge_Base**: The best common ancestor commit of the Base_Ref and the Head_Commit, as computed by `git merge-base`.
- **Changed_File**: One file of the Change: `{ path, oldPath?, status, patch, provenance }`. `status` is `added`, `modified`, `deleted` or `renamed`.
- **Stage_1_Listing**: The result of `git diff --name-status -z -M` between the Merge_Base and the Head_Commit, without pathspec excludes (Decision D10).
- **Stage_2_Patches**: The result of `git diff -p` between the same commits, read in Patch_Batches, with case-insensitive pathspec excludes for Sensitive_Files (Decisions D10, D24, D25).
- **Patch_Batch**: A group of at most 50 Stage_1_Listing entries, with at most 65 536 bytes of pathspec arguments, in ascending path order, whose `path` and `oldPath` are requested together in one Stage 2 command (Decision D25).
- **Raw_Patch_Limit**: 1 048 576 bytes (1 MiB), the largest raw patch of one Changed_File that the Git_Provider keeps (Decision D26).
- **Patch_Hunk**: The lines of a patch from the line after one `@@` header to the line before the next `@@` header or the end of the patch. For a text that is not a patch, the whole text is one Patch_Hunk.
- **Private_Key_Block**: The text of a private key as handled by Requirement 5.15: from a `-----BEGIN … PRIVATE KEY-----` line to its `-----END … PRIVATE KEY-----` line, or the partial forms of Decision D22.
- **Pseudo_Path**: A name used in `truncated[].file` and `redactions[].file` for a text that is not a file: `<title>`, `<description>`, `<candidates>`, `commit:<sha>`, `claim:<n>` (n is the 1-based position of the `--claim` argument) and `check:<n>` (n is the number of Check_Results removed by the cap of Requirement 7.14).
- **Redactor**: The module `context/redact.ts`.
- **Redaction_Marker**: The string `[REDACTED]`, the same value as `REDACTED` in `config/redact.ts`.
- **Redaction_Pass**: One application of all replacements of the Redactor to a text, each marker-free segment separately.
- **Secret_Pattern**: A built-in or configured regular expression that matches secret text. A Secret_Pattern with a capture group named `secret` redacts only that group; without it, the whole match is redacted.
- **Token_Boundary**: The left boundary `(?<![A-Za-z0-9_-])` required in front of every built-in token prefix. Token characters are `[A-Za-z0-9_-]`.
- **Strict_Credential_Key**: A key for Requirement 5.2 (the value rules, including Identifier_Shaped_Value, are in that requirement): a run of `[A-Za-z0-9_.-]` that ends with one of `api-key`, `api_key`, `apikey`, `access-key`, `access_key`, `secret-key`, `secret_key`, `private-key`, `private_key`, `auth-key`, `auth_key`, `secret`, `token`, `password`, `passwd`, `pwd` (case-insensitive), optionally followed by a closing quote.
- **Secret_Variable**: An environment variable whose name is `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` (always secret when the trimmed value is not empty), or whose name matches `CREDENTIAL_KEY_NAME_PATTERN` or `/api[-_]key/i` and whose trimmed value has at least 8 characters, is not purely digits, and is not one of `true`, `false`, `yes`, `no`, `on`, `off`, `null`, `undefined`, `none` (compared case-insensitively).
- **Secret_Definition**: The exported function `collectSecretValues(env)` in `config/secrets.ts` that returns the trimmed values of the Secret_Variables, without duplicates, longest value first. The Redactor and `buildRedactedConfig` both use it.
- **Secret_Value_Function**: The exported function `redactSecretValues(text, secrets)` in `config/secrets.ts`: it splits the text at every Redaction_Marker, replaces every secret value in each marker-free segment, joins the segments with the Redaction_Marker, and repeats until the text no longer changes (Decision D23). The Redactor and `buildRedactedConfig` both use it.
- **Identifier_Shaped_Value**: An unquoted value that contains no digit and matches `^[A-Za-z_$][\w$]*(\.[\w$]+)*(\(\))?[,;]?$` (Decision D27).
- **Directive_Comment**: A Comment_Line whose content is a lint or tool directive, a shebang, or a license header line, as listed in Decision D31.
- **Env_File**: A file whose base name is `.env` or starts with `.env.`, at any directory depth, compared case-insensitively (for example `.Env` and `.ENV.production`).
- **Sensitive_File**: An Env_File, or a file whose base name matches `*.pem`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `.git-credentials` or `.pypirc`, at any directory depth, compared case-insensitively (Decision D24).
- **Budgeter**: The module `context/budget.ts`.
- **State_Budget**: The maximum size of the text of one Jev request: 32 000 estimated tokens.
- **Context_Budget**: The maximum size of the context text in the Change_Context: 24 000 estimated tokens. The difference to the State_Budget (8 000) is the Request_Headroom.
- **Request_Headroom**: The 8 000 estimated tokens reserved for the question text, the Claim and the Check_Results that the Assessment stage adds to a request.
- **Token_Estimate**: The value `ceil(length / 3)` of one text, where `length` is the number of UTF-16 code units. The Token_Estimate of several texts is the sum of their Token_Estimates.
- **Budgeted_Text**: The texts counted against the Context_Budget: the title, the description, every commit message, every `--claim` text, and for every Changed_File its `path`, its `oldPath` (when present) and its `patch`.
- **User_Facing_File**, **Test_File**, **Low_Priority_File**: Changed_Files as defined in Requirement 7.2.
- **Truncation_Record**: One entry of `truncated` in the Change_Context: `{ file, reason }`.
- **Redaction_Summary**: The `redactions` array of the Change_Context: `{ file, count }[]`.
- **Candidate_Extractor**: The module `context/candidates.ts`.
- **Claim_Candidate**: One entry of `candidates` in the Change_Context: `{ id, text, provenance }`. It is existing text, never generated text.
- **Candidate_Source_Field**: One text field of the Change_Context from which candidates are extracted: a `--claim` text, the title, the description, one commit message, or one Comment_Line of a Changed_File's patch.
- **Candidate_Source_Text**: The Candidate_Source_Fields in this fixed order: `--claim` texts, title, description, commit messages (oldest first), then Comment_Lines (files in Change_Context order, lines in ascending line number). Candidates are extracted per field and never span two fields.
- **Comment_Line**: An added line (`+`) of a patch whose content is a comment under the comment syntax of the file extension (Requirement 9.8). Its text is the comment content with the `+`, the comment delimiters and the continuation prefix removed (Requirement 9.8).
- **Check_Result**: One entry of `checks` in the Change_Context: `{ name, status: 'passed' | 'failed' | 'skipped', covers?, provenance }`.
- **Issue_Checklist**: The list of acceptance items of GitHub issue #6, reproduced in the first column of the first table in the Traceability section.
- **Change**, **Subject**, **Claim**, **Check**, **Assessment**, **Evidence**: As defined in SPEC.md section 3.2.
- **Effective_Config**: As defined in the ce-config-loader spec.

## Requirements

### Requirement 1: Providers collect context from every available source

**User Story:** As a developer, I want CE to read what already describes my Change, so that I never write special metadata.

#### Acceptance Criteria

1. WHEN a Git repository is available, THE Git_Provider SHALL return the Changed_Files of the diff from the Merge_Base to the Head_Commit, each with `path`, `oldPath` (for renamed files), `status`, `patch` and Provenance.
2. WHEN a Git repository is available, THE Git_Provider SHALL return the non-merge commits in the range `base..head`, oldest first, each as `{ sha, message, provenance }`, and THE Context_Resolver SHALL carry them in `change.commits`.
3. WHEN a GitHub event payload file is available at `GITHUB_EVENT_PATH` and contains a pull request, THE GitHub_Event_Provider SHALL return the pull request title, body, base and head commit (`pull_request.head.sha`).
4. WHEN the `--claim` argument is given one or more times, THE CLI_Provider SHALL return each value as a claim text, and THE Context_Resolver SHALL carry them in `change.claims` in the order given.
5. WHEN the `--base` argument is given, THE CLI_Provider SHALL return its value as the Base_Ref.
6. WHEN one or more JUnit XML files match the path or glob in `context.checks`, THE JUnit_Provider SHALL return one Check_Result per test case, in ascending path order of the files and document order within a file, with the status `failed` for a test case that has a `<failure>` or `<error>` element, `skipped` for a test case that has a `<skipped>` element, and `passed` otherwise.
7. THE Change_Context SHALL carry the `title`, `description`, `base`, `head`, `files`, `commits` and `claims` of the Change in `change`, and the Check_Results in `checks`.
8. WHEN `context.include` or `context.exclude` globs are set, THE Git_Provider SHALL return only Changed_Files whose path matches an include glob (when any are set) and matches no exclude glob, using the matcher of Decision D20 where `*` does not match `/` and `**` matches across `/`.
9. THE Git_Provider SHALL report `status` as `added` for an added or copied file, `deleted` for a deleted file, `renamed` for a renamed file, and `modified` for every other change including a type change.
10. WHEN a Changed_File is binary, THE Git_Provider SHALL return it with an empty `patch`, and THE Context_Resolver SHALL add a Truncation_Record for it with the reason `binary`.
11. WHEN a Changed_File has the status `deleted`, THE Git_Provider SHALL return its patch like that of any other file.
12. THE JUnit_Provider SHALL name each Check_Result `<classname>.<name>` of its test case, or `<name>` when the test case has no `classname`.
13. THE JUnit_Provider SHALL parse XML with DTD processing disabled and external entities not resolved.
14. THE Git_Provider SHALL invoke git with the options of Decision D16 (`-c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false -c diff.renameLimit=1000 --no-color --no-ext-diff --no-textconv -M --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3`) and SHALL read file paths with `-z`, so that the returned paths are exact for names with spaces, non-ASCII characters and line breaks.
15. THE Git_Provider SHALL return the same Changed_Files and the same patches for the same commits under any user git configuration of `diff.algorithm`, `diff.noprefix`, `diff.mnemonicPrefix`, `color.ui`, `diff.renames` and `core.quotePath`.
16. WHEN `context.checks` contains no wildcard, THE JUnit_Provider SHALL read the one file at that path, and WHEN it contains `*` or `**`, THE JUnit_Provider SHALL list the files below the longest wildcard-free directory prefix of the pattern with the matcher of Decision D20, without following symbolic links.
17. IF the path or glob in `context.checks` is absolute or contains a `..` segment, THEN THE JUnit_Provider SHALL record itself as `unavailable` with the Reason_Code `source-malformed` and SHALL NOT read any file.
18. THE Git_Provider SHALL read the patches of the Stage_2_Patches in Patch_Batches (Decision D25) and SHALL match every returned patch to a Stage_1_Listing entry by the pair (`path`, `oldPath`), and SHALL discard every patch that matches no entry.
19. WHEN a Stage_1_Listing entry that is not a Sensitive_File has no matching patch in the Stage_2_Patches, THE Git_Provider SHALL return the Changed_File with an empty `patch`, and THE Context_Resolver SHALL add a Truncation_Record for it with the reason `dropped`.
20. THE Git_Provider SHALL run every Stage 2 command with `maxBuffer` of 16 777 216 bytes, and WHEN a Patch_Batch exceeds `maxBuffer`, THE Git_Provider SHALL repeat its entries one at a time.
21. IF the raw patch of a Changed_File exceeds the Raw_Patch_Limit of 1 048 576 bytes, or its single-entry command exceeds `maxBuffer`, THEN THE Git_Provider SHALL return the Changed_File with an empty `patch` and without any partial text, and THE Context_Resolver SHALL add a Truncation_Record for it with the reason `dropped`, and the Git_Provider status SHALL stay `used`.
22. WHEN `context.checks` has no wildcard and the path is a symbolic link (checked with `lstat`), THE JUnit_Provider SHALL record itself as `unavailable` with the Reason_Code `source-malformed` and SHALL NOT read the file.
23. IF a JUnit XML file is larger than 10 485 760 bytes, THEN THE JUnit_Provider SHALL NOT parse it and SHALL treat it as a file that fails with the Reason_Code `source-malformed` (Requirement 3.13).
24. THE repository documentation SHALL state that `context.checks` must be a relative path or glob, and that an absolute path such as `${{ github.workspace }}/…` is rejected with the Reason_Code `source-malformed`.

### Requirement 2: Base ref selection and diff range

**User Story:** As a developer, I want CE to find the base of my Change without configuration, so that it works in a local checkout and in CI.

#### Acceptance Criteria

1. THE Context_Resolver SHALL select the Base_Ref in this priority order: the `--base` argument, then the GitHub event payload (Criterion 2 and Criterion 10), then `context.base` of the Effective_Config, then `origin/main`.
2. WHERE the GitHub event payload names a pull request base, THE Context_Resolver SHALL use `pull_request.base.sha` when it is present, and `origin/` followed by `pull_request.base.ref` otherwise.
3. THE Context_Resolver SHALL record in the Provenance of the base ref which source supplied it: provider `cli` with location `--base`; provider `github` with location `pull_request.base.sha`, `pull_request.base.ref` or `push.before`; provider `config` with location `context.base`; provider `config` with location `default:origin/main`. The Provenance `ref` SHALL be the Merge_Base commit hash when it resolves.
4. THE Git_Provider SHALL compute the diff as the merge-base diff `base...head` (three dots) between the Merge_Base and the Head_Commit, and the commit list as the range `base..head` (two dots) with merge commits excluded (`--no-merges`).
5. THE Context_Resolver SHALL set `change.head` to the hash of the Head_Commit, and `change.base` to the Base_Ref as selected.
6. THE Git_Provider SHALL NOT include staged, unstaged or untracked changes of the working tree in the Change_Context.
7. THE repository documentation SHALL state that CI checkouts need `fetch-depth: 0` (for `actions/checkout`) so that the Base_Ref and the Merge_Base exist.
8. IF the Base_Ref resolves but no Merge_Base exists with the Head_Commit (for example in a shallow clone), THEN THE Context_Resolver SHALL record the Git_Provider as `unavailable` with the Reason_Code `merge-base-missing`.
9. THE Git_Provider SHALL NOT run `git fetch` or any other command that contacts a remote.
10. WHERE the GitHub event payload is a `push` event with a `before` value that is not 40 zeros and that resolves to a commit in the repository, THE Context_Resolver SHALL use `before` as the Base_Ref of the payload source, and WHERE `before` is 40 zeros or does not resolve to a commit in the repository (Decision D28), THE Context_Resolver SHALL ignore it and continue with the next source in the priority order of Criterion 1, without recording `base-unresolved`.
11. WHERE the GitHub event payload names `pull_request.head.sha` and that commit exists in the repository, THE Context_Resolver SHALL use it as the Head_Commit with the Provenance provider `github` and location `pull_request.head.sha`, and otherwise THE Context_Resolver SHALL use the commit that `HEAD` points to with the Provenance provider `git` and location `HEAD`.
12. WHEN the checked-out `HEAD` is a merge commit created by `actions/checkout` for a pull request and the base branch advanced past `pull_request.base.sha`, THE Git_Provider SHALL return only the files and commits of the pull request, and no merge commit message.
13. IF the GitHub event payload names a `pull_request.head.sha` that does not exist in the repository (for example a `pull_request_target` event with the default checkout of the base), THEN THE Context_Resolver SHALL use the commit that `HEAD` points to as the Head_Commit and SHALL record the Git_Provider with status `used` and the Reason_Code `head-missing` (Decision D29).
14. THE repository documentation SHALL state that a workflow for `pull_request_target` must check out `github.event.pull_request.head.sha` with `fetch-depth: 0`, and that the Reason_Code `head-missing` marks a run in which this was not done.

### Requirement 3: Unavailable providers are recorded, not fatal

**User Story:** As a developer, I want CE to continue when a source is missing, so that CE does not require Git or a pull request.

#### Acceptance Criteria

1. THE Context_Resolver SHALL record one Provider_Status for each of the four Providers, in the fixed order `git`, `github`, `cli`, `junit`.
2. WHEN a Provider returns data, THE Context_Resolver SHALL record its Provider_Status with status `used`, and without a `reason`, except for the Reason_Code `head-missing` of Requirement 2.13.
3. IF a Provider cannot supply data because its source is absent, unreadable or malformed, THEN THE Context_Resolver SHALL record its Provider_Status with status `unavailable` and the matching Reason_Code (`source-absent`, `source-unreadable` or `source-malformed`), and SHALL continue with the other Providers.
4. IF the working directory is not a Git repository, THEN THE Context_Resolver SHALL record the Git_Provider as `unavailable` with the Reason_Code `not-a-repository` and SHALL continue.
5. IF the Base_Ref does not resolve in the Git repository, THEN THE Context_Resolver SHALL record the Git_Provider as `unavailable` with the Reason_Code `base-unresolved` and SHALL continue.
6. IF a git command fails for any other cause, THEN THE Context_Resolver SHALL record the Git_Provider as `unavailable` with the Reason_Code `git-failed`.
7. WHEN neither `--claim` nor `--base` is given, THE Context_Resolver SHALL record the CLI_Provider as `unavailable` with the Reason_Code `no-input`.
8. WHEN `context.checks` is not set, THE Context_Resolver SHALL record the JUnit_Provider as `unavailable` with the Reason_Code `not-configured`.
9. WHEN `GITHUB_EVENT_PATH` is not set, or the payload holds neither a pull request nor a push `before` that is not 40 zeros and resolves to a commit in the repository, THE Context_Resolver SHALL record the GitHub_Event_Provider as `unavailable` with the Reason_Code `source-absent`.
10. IF all four Providers are `unavailable`, THEN THE Context_Resolver SHALL return a Change_Context with empty `files`, `commits`, `claims`, `candidates` and `checks`, and SHALL NOT throw.
11. THE Context_Resolver SHALL set the `reason` of a Provider_Status only to a Reason_Code, and SHALL NOT forward text from git output (including stderr), file contents, payload contents or secret values into a Provider_Status.
12. IF `context.checks` is set and no file matches it, THEN THE Context_Resolver SHALL record the JUnit_Provider as `unavailable` with the Reason_Code `source-absent`.
13. IF `context.checks` matches files and at least one of them parses, THEN THE Context_Resolver SHALL record the JUnit_Provider as `used`, and IF none of them parses, THEN THE Context_Resolver SHALL record it as `unavailable` with the Reason_Code of the first failing file in ascending path order (`source-unreadable` or `source-malformed`).

### Requirement 4: Provenance on everything

**User Story:** As a reviewer, I want to see where each piece of context came from, so that I can trust what a Claim and its Evidence rest on.

#### Acceptance Criteria

1. THE Context_Resolver SHALL attach a Provenance to every Changed_File, every commit, every `--claim` text, every Claim_Candidate and every Check_Result it returns.
2. THE Context_Resolver SHALL list in `change.provenance` the Provenance of the title, the description, the base ref and the head ref.
3. THE Context_Resolver SHALL set the Provenance `provider` to `git` for the diff, the commit messages and the Changed_Files, `github` for the pull request title and body, `cli` for `--claim` and `--base` values, `junit` for Check_Results, and `config` for `context.base` and the default base ref.
4. THE Context_Resolver SHALL set the Provenance `ref` to the commit hash for each commit message, and `location` as follows: the file path for a Changed_File and for a Check_Result (the JUnit file path), `message` for a commit message, `title` and `description` for the pull request fields, and `--claim[<n>]` (n starts at 1) for a `--claim` text.
5. THE Context_Resolver SHALL set the Provenance `location` of a Claim_Candidate taken from a diff Comment_Line to `<path>:<line>`, where `<line>` is the 1-based line number in the new version of the file.
6. WHEN the Redactor or the Budgeter changes a piece of text, THE Context_Resolver SHALL keep the Provenance of that text unchanged.
7. IF the same text is given by `--claim` and by another field, THEN THE Context_Resolver SHALL keep the Provenance with provider `cli` on the `change.claims` entry and on the Claim_Candidate (R4.4).

### Requirement 5: Redaction before any Jev call

**User Story:** As a developer, I want secrets removed from the context before it leaves my machine, so that CE never sends a credential to Jev.

#### Acceptance Criteria

1. THE Redactor SHALL replace the secret part of every match of every built-in Secret_Pattern with the Redaction_Marker. The built-in list SHALL cover, with the Token_Boundary in front of every token prefix and the minimums of Decision D12: the value of an `Authorization` bearer or basic header; tokens that start with `sk-` (at least 20 token characters, at least one digit or uppercase letter among them), `sk_live_`, `sk_test_`, `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, `xoxs-` (at least 16 token characters each), `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` (at least 36 alphanumeric characters), `github_pat_` (at least 22 token characters), `npm_` (at least 36 alphanumeric characters) or `AIza` (at least 35 token characters); `AKIA` followed by exactly 16 uppercase letters or digits that are not followed by another uppercase letter or digit; JSON Web Tokens of the form `eyJ….eyJ….…`; and the password in a URL of the form `scheme://user:password@host`. Private key material is handled by the Private_Key_Block rule of Criterion 15, not by a single pattern.
2. WHEN a line has the form `key=value`, `key: value` or `key = value` and the key is a Strict_Credential_Key, THE Redactor SHALL replace only the value, and SHALL keep the key. The Redactor SHALL replace the value only when the value (after removal of surrounding quotes) has at least 8 characters, contains no whitespace, is not purely digits, and is not one of `true`, `false`, `yes`, `no`, `on`, `off`, `null`, `undefined`, `none` (case-insensitive). The Redactor SHALL NOT replace a value that is an Identifier_Shaped_Value (Decision D27), so that `const token = getToken()`, `{ accessToken: accessToken }` and `nextPageToken = response.nextPageToken` stay unchanged, and SHALL still replace a quoted value of the same shape.
3. THE Redactor SHALL replace every occurrence of the value of every Secret_Variable in a text with the Redaction_Marker by calling the Secret_Value_Function, and the Redactor and `buildRedactedConfig` SHALL both obtain these values from the Secret_Definition and apply them with the Secret_Value_Function (Requirement 13.1), so that the `config` and `context` sections of `run.json` agree on what a secret is and on how it is removed.
4. THE Redactor SHALL replace every match of every pattern in `context.redact` in a text with the Redaction_Marker, compiled with `compileRedactPattern`, and SHALL ignore zero-length matches.
5. THE Redactor SHALL first apply the Private_Key_Block rule of Criterion 15 to the whole text, then split the result at every existing Redaction_Marker, apply all other replacements of a Redaction_Pass to each segment separately, and join the segments with the Redaction_Marker, so that an existing Redaction_Marker is never rewritten.
6. THE Redactor SHALL repeat the Redaction_Pass on its own output until the output no longer changes (fixpoint, Decision D11), and FOR ALL texts THE Redactor SHALL return the same result when applied to its own output (idempotence): `redact(redact(x)) = redact(x)`, including when a secret value or a configured pattern matches part of the Redaction_Marker (for example the value `RED` or the pattern `/[A-Z]+/`), and including a configured pattern with an anchor, a lookaround or `\b` (for example `/^x+$/` with the text `xxSECRETVAL1xx`).
7. FOR ALL generated secret strings that match a built-in Secret_Pattern, equal a Secret_Variable value, or match a configured pattern, THE Redactor SHALL return a text that does not contain that secret string, wherever it is embedded in the surrounding text.
8. THE Context_Resolver SHALL apply the Redactor to every text field of the Change_Context (title, description, commit messages, claim texts, Changed_File patches and paths, and Check_Result names) before the Budgeter and the Candidate_Extractor use that field.
9. WHEN the Redactor replaces text, THE Context_Resolver SHALL add to the Redaction_Summary one entry with the file path (or the Pseudo_Path of a non-file field) and the total number of replacements over all Redaction_Passes, without recording the replaced text, and SHALL add no entry for zero replacements.
10. THE Redactor SHALL be a pure function of its text and its pattern and secret inputs, with no file, network or environment access, and THE Context_Resolver SHALL read the environment once and pass the Secret_Variable values to the Redactor.
11. IF a configured pattern in `context.redact` fails to compile, THEN THE Context_Resolver SHALL throw `StageError('context', cause)` before any text is returned.
12. THE Redactor SHALL replace only non-empty matches inside marker-free segments, so that the number of Redaction_Passes that change a text is at most the length of the input text in UTF-16 code units, and THE Redactor SHALL terminate for every input and every compiled pattern.
13. THE Redactor SHALL leave the following ordinary texts unchanged: `task-list-item-container`, `risk-assessment-for-the-project`, `npm_lifecycle_script`, `npm_config_registry` and `desk-lamp-description-text-long`.
14. WHERE the file extension of a Changed_File is `.css`, `.scss` or `.less`, THE Redactor SHALL NOT apply the key rule of Criterion 2 to its patch.
15. THE Redactor SHALL apply the Private_Key_Block rule (Decision D22) to every text, with the text kind `patch` for a Changed_File patch (where each Patch_Hunk starts at the line after an `@@` line, and each line may carry a diff prefix `+`, `-` or a space) and the text kind `text` for any other field (where the whole text is one Patch_Hunk), as follows:
   - WHEN a `-----BEGIN … PRIVATE KEY-----` line occurs, THE Redactor SHALL redact from that line to the next `-----END … PRIVATE KEY-----` line of the same Patch_Hunk, inclusive, and to the end of the Patch_Hunk when no such `END` line follows.
   - WHEN a `-----END … PRIVATE KEY-----` line occurs in a Patch_Hunk with no earlier `BEGIN` line in that Patch_Hunk, THE Redactor SHALL redact from the start of that Patch_Hunk to that `END` line, inclusive.
   - WHILE the text kind is `patch`, THE Redactor SHALL replace the content of each covered line with the Redaction_Marker and keep the diff prefix and the line count of the Patch_Hunk, and WHILE the text kind is `text`, THE Redactor SHALL replace the covered text with one Redaction_Marker.
   - THE Redactor SHALL count one replacement for each redacted Private_Key_Block.
16. THE Redactor SHALL treat an existing Redaction_Marker inside a Private_Key_Block as part of the block, so that a marker never ends a block early.

### Requirement 6: Sensitive files are never sent

**User Story:** As a developer, I want `.env` files and key files kept out of the context entirely, so that no secret reaches Jev through a diff.

#### Acceptance Criteria

1. THE Git_Provider SHALL read the file list with the Stage_1_Listing (`git diff --name-status -z -M`) without any pathspec exclude, and SHALL read the patches with the Stage_2_Patches, which carry the case-insensitive pathspec excludes `:(exclude,glob,icase)**/<name>` for every Sensitive_File name of Decision D24 (for example `:(exclude,glob,icase)**/.env`, `:(exclude,glob,icase)**/.env.*`, `:(exclude,glob,icase)**/*.pem`, `:(exclude,glob,icase)**/id_rsa`, `:(exclude,glob,icase)**/*.key`, `:(exclude,glob,icase)**/.netrc`), and SHALL request in the Patch_Batches only entries that are not Sensitive_Files, so that git does not emit the content of a Sensitive_File.
2. WHEN a Sensitive_File is part of the Change, THE Git_Provider SHALL return the Changed_File with its path, `oldPath` where renamed, and status and an empty `patch`, and THE Context_Resolver SHALL add a Truncation_Record for it with the reason `env-file` for an Env_File and `sensitive-file` for any other Sensitive_File.
3. IF the `path` or the `oldPath` of a Changed_File in the Stage_1_Listing is a Sensitive_File (compared case-insensitively on the base name, so that `.Env`, `ID_RSA` and `Server.PEM` count), THEN THE Git_Provider SHALL treat the Changed_File as a Sensitive_File and SHALL request neither its `path` nor its `oldPath` in any Patch_Batch, including a file renamed from or to a Sensitive_File (for example `.env` renamed to `config.txt`).
4. THE Context_Resolver SHALL apply the Sensitive_File exclusion regardless of `context.include` and `context.exclude`.
5. THE Context_Resolver SHALL NOT read the contents of a Sensitive_File from disk at any stage.
6. IF the GitHub event payload, a commit message or a `--claim` value contains the text of a Secret_Variable value, THEN THE Redactor SHALL remove it under Requirement 5.3.
7. THE Git_Provider SHALL resolve the Merge_Base and the Head_Commit to commit hashes once and SHALL use the same two hashes in the Stage_1_Listing, the Stage_2_Patches and the commit list.
8. THE Git_Provider SHALL NOT request in any Patch_Batch the `path` or `oldPath` of a Changed_File that `context.include` or `context.exclude` removes, and SHALL discard any patch that matches no kept Stage_1_Listing entry (Requirement 1.18), so that the patch of a file that the Change_Context does not carry never enters it. THE Git_Provider SHALL NOT use one pathspec argument per removed file.
9. WHEN `X` is renamed to `Y` and `context.exclude` removes `Y`, THE Git_Provider SHALL return neither a Changed_File for `X` nor any text of `X` or `Y`.

### Requirement 7: Budget with deterministic prioritisation and truncation

**User Story:** As a developer, I want CE to fit the context into the model's state budget in a predictable way, so that the same Change always sends the same context.

#### Acceptance Criteria

1. THE Budgeter SHALL return a Change_Context whose Budgeted_Text has a Token_Estimate (the sum of the per-field Token_Estimates, Decision D2) that does not exceed the Context_Budget of 24 000, which leaves the Request_Headroom of 8 000 within the State_Budget of 32 000, and THE Budgeter SHALL truncate `files[].patch`, `change.commits[].message`, `change.description`, `change.claims[].text` and `change.title` in place.
2. THE Budgeter SHALL rank Changed_Files in this order: User_Facing_Files, then Test_Files, then all other Changed_Files, then Low_Priority_Files, and SHALL classify a Changed_File by the first matching class in the order Low_Priority_File, Test_File, User_Facing_File, other, with these definitions:
   - Low_Priority_File: a file with the status `deleted`; a lockfile (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `go.sum`); a generated file (`*.min.js`, `*.min.css`, `*.map`, `*.snap`, or a path with a directory segment `dist`, `build` or `generated`); a binary file; or a file whose base name starts with `CHANGELOG`, `HISTORY` or `CHANGES`.
   - Test_File: a path with a directory segment `test`, `tests`, `__tests__` or `e2e`, or a base name that matches `*.test.*` or `*.spec.*`.
   - User_Facing_File: a path that has a directory segment `pages`, `views`, `routes`, `components`, `locales` or `i18n`; or a directory segment `app` with no later segment `api`; or an extension `.css`, `.scss`, `.html`, `.hbs`, `.vue`, `.svelte`, `.tsx` or `.jsx`. Markdown files (`.md`, `.mdx`) are not User_Facing_Files (Decision D21).
3. THE Budgeter SHALL order Changed_Files of equal rank by path in ascending byte order.
4. THE Budgeter SHALL keep the title, the `--claim` texts, the description and the commit messages before any diff text, and SHALL include them in full when their total Token_Estimate is within the Context_Budget.
5. WHEN the total Token_Estimate of the Budgeted_Text exceeds the Context_Budget, THE Budgeter SHALL first reduce the fixed fields in this order until they fit, where E is the excess in estimated tokens at the time a field is reduced: commit messages from the oldest (a commit whose Token_Estimate is at most E is removed from `change.commits`, and otherwise the oldest remaining message is truncated by E tokens), then the description from its end, then the `--claim` texts from the last (a claim whose text would become empty is removed from `change.claims`), then the title from its end, so that the Token_Estimate never exceeds the Context_Budget even when the title and the `--claim` texts alone exceed it.
6. WHEN the fixed fields fit, THE Budgeter SHALL perform phase 1 (Decision D15): reserve the Token_Estimate of the `path` and `oldPath` of every Changed_File, in ranked order, so that a file whose `path` and `oldPath` do not fit in the remaining budget is removed from `change.files` as in Criterion 9.
7. WHEN phase 1 is complete, THE Budgeter SHALL perform phase 2: fill the remaining budget with the `patch` of each Changed_File in ranked order, and WHEN a `patch` does not fit whole and at least one full line of it fits, THE Budgeter SHALL cut it at a line boundary, record `truncated`, and set the `patch` of every later ranked Changed_File to empty with the record `dropped`, while keeping those files in `change.files`.
8. WHEN a `patch` does not fit whole and not one full line of it fits (for example a single minified line longer than the remaining budget), THE Budgeter SHALL set its `patch` to empty and record `dropped`, and SHALL continue with the next ranked Changed_File.
9. WHEN not even the `path` and `oldPath` of a Changed_File fit in phase 1, THE Budgeter SHALL remove the Changed_File from `change.files` and record `dropped`.
10. WHEN the Budgeter drops or shortens text, THE Budgeter SHALL add one Truncation_Record per affected item with the file path or the Pseudo_Path (`commit:<sha>`, `<description>`, `claim:<n>`, `<title>`) and the reason `dropped` or `truncated`, where an item that is removed from its array or emptied entirely has the reason `dropped`.
11. FOR ALL inputs, THE Budgeter SHALL return the same output when called twice with the same input (determinism), regardless of the order in which the Providers returned the files.
12. WHEN the total Token_Estimate is within the Context_Budget, THE Budgeter SHALL return the text unchanged and SHALL add no Truncation_Record.
13. THE Budgeter SHALL export the Token_Estimate function, the constants for the State_Budget, the Context_Budget and the Request_Headroom, and a function that truncates a text to a given number of estimated tokens at a line boundary (or, when no full line fits, at a code point boundary), so that the Assessment stage can apply the budget to each Jev request.
14. THE Context_Resolver SHALL keep at most 200 Check_Results: WHEN the Providers return more than 200, THE Context_Resolver SHALL keep all `failed` results first, then `skipped`, then `passed` (stable within each status) until 200 are kept, SHALL return the kept results in their original order, and SHALL add one Truncation_Record with the file `check:<n>`, where `<n>` is the number of removed Check_Results, and the reason `check-cap`.
15. THE Budgeter SHALL export a function that fits a list of Check_Results to a given number of estimated tokens (the sum of the Token_Estimates of the `name` fields), keeping `failed` results before `skipped` and `passed` ones, so that the Assessment stage can keep the Check_Results of a request within the Request_Headroom (Decision D17).
16. THE Budgeter SHALL NOT split a UTF-16 surrogate pair when truncating.

### Requirement 8: Provenance and truncation survive into the result

**User Story:** As a reviewer, I want to see exactly what was left out, so that I can judge whether the Evidence rests on partial context.

#### Acceptance Criteria

1. THE Change_Context SHALL carry every Truncation_Record in `truncated`.
2. THE Context_Resolver SHALL order `truncated` as follows: the records of Requirements 1.10, 1.19, 1.21 and 6.2 in ascending path order, then the Budgeter records in the order the Budgeter produced them, then the record of Requirement 7.14, then the candidate record of Requirement 9.12.
3. WHEN no file was dropped, shortened or withheld, THE Change_Context SHALL carry an empty `truncated` array.
4. THE Change_Context SHALL contain only data that serializes to JSON, so that it can be embedded in `run.json`.
5. THE Change_Context SHALL carry the Redaction_Summary in `redactions`.

### Requirement 9: Claim candidates are extracted text only

**User Story:** As a reviewer, I want each Claim to come from text that really exists in the Change, so that no Claim is invented.

#### Acceptance Criteria

1. THE Candidate_Extractor SHALL split each Candidate_Source_Field other than a `--claim` text into sentences and list items, as defined in the Introduction assumptions and decision D6, so that a single line break inside a sentence does not end the sentence.
2. THE Candidate_Extractor SHALL return the text of each candidate as an exact substring of its Candidate_Source_Field, with only leading and trailing whitespace and the list marker of a list item removed.
3. FOR ALL Candidate_Source_Fields, THE Candidate_Extractor SHALL return only candidates whose `text` is a substring of the Candidate_Source_Field named by the candidate's Provenance (substring property: `sourceField(c.provenance).includes(c.text)`), where the Candidate_Source_Field of a Comment_Line is its comment content as defined in Criterion 8.
4. THE Candidate_Extractor SHALL NOT paraphrase, summarize, translate, join, reorder words in or otherwise rewrite any text, and SHALL NOT return a candidate that spans two Candidate_Source_Fields.
5. THE Candidate_Extractor SHALL assign each candidate a Provenance equal to the Provenance of the Candidate_Source_Field it was extracted from, with `location` as defined in Requirement 4.5.
6. THE Candidate_Extractor SHALL assign candidate ids in the order of extraction, after de-duplication and after the cap of Criterion 12, as `c1`, `c2`, and so on, so that the same input gives the same ids.
7. WHEN the same text appears more than once in the Candidate_Source_Text, THE Candidate_Extractor SHALL return it once, with the Provenance of its first occurrence, and because the `--claim` texts come first in the Candidate_Source_Text, a text given by `--claim` SHALL keep the Provenance provider `cli`.
8. THE Candidate_Extractor SHALL read Comment_Lines only from lines of a patch that start with `+` (not the `+++` file header), one Comment_Line per line, using this comment syntax by file extension: `//`, `/*`, `/**`, `*/` and `*` continuation lines for `.js`, `.jsx`, `.ts`, `.tsx`, `.java`, `.c`, `.h`, `.cc`, `.cpp`, `.cs`, `.go`, `.rs`, `.swift`, `.kt`, `.css`, `.scss`; `#` for `.py`, `.rb`, `.sh`, `.yml`, `.yaml`, `.toml`; `--` for `.sql`, `.lua`; `<!-- -->` for `.html`, `.hbs`, `.vue`, `.svelte`, `.md`; and `"""` docstring blocks for `.py` that open and close within the added lines of one hunk. THE Candidate_Extractor SHALL remove from a Comment_Line the `+`, the leading whitespace, the comment opener and closer, and, for a line inside a `/* … */` block, a leading `*` with one following space, so that a continuation line `* text` yields the text `text`.
9. THE Candidate_Extractor SHALL skip empty candidates, and for the title, the description and the commit messages (and not for Comment_Lines) THE Candidate_Extractor SHALL skip candidates inside fenced code blocks, headings (lines that start with `#` in Markdown text), HTML comments, and table rows (lines that start with `|`).
10. WHEN a `--claim` value is given, THE Candidate_Extractor SHALL return that value as one candidate with Provenance provider `cli`, without splitting it.
11. THE Candidate_Extractor SHALL read only the text of the Change_Context after the Redactor and the Budgeter processed it, so that no candidate contains text that the Redactor removed or the Budgeter dropped.
12. WHEN more than 50 candidates remain after de-duplication, THE Candidate_Extractor SHALL keep the first 50 in extraction order, and THE Context_Resolver SHALL add one Truncation_Record with the file `<candidates>` and the reason `candidate-cap`.
13. THE Candidate_Extractor SHALL NOT call Jev.
14. THE Candidate_Extractor SHALL NOT treat the content of a Comment_Line as a list item, heading or table row, so that a continuation prefix `*` or a `-` after a comment opener is part of the comment content under Criterion 8 and never starts a list item.
15. THE Candidate_Extractor SHALL NOT return a candidate from a Directive_Comment (Decision D31): a Comment_Line whose content contains `eslint-disable`, `eslint-enable`, `noqa`, `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `prettier-ignore`, `istanbul ignore`, `c8 ignore`, `pylint:` or `type: ignore`; a shebang (the first line of a file, starting with `#!`); or a license header line that starts (after the comment opener) with `Copyright`, `SPDX-License-Identifier`, `Licensed under` or `All rights reserved`, compared case-insensitively. THE Candidate_Extractor SHALL still return candidates from every other Comment_Line.

### Requirement 10: Resolver assembles the Change_Context

**User Story:** As the Assessment stage, I want one complete context object, so that I can assess the Change without knowing which providers ran.

#### Acceptance Criteria

1. WHEN `resolveContext` is called with the Effective_Config, the CLI options and the environment, THE Context_Resolver SHALL run the Providers, then the Redactor, then the Budgeter, then the Candidate_Extractor, in that order, and SHALL return a Change_Context.
2. THE Context_Resolver SHALL accept the Providers as an optional injected argument of `resolveContext` that defaults to the four real Providers, so that tests can supply fake Providers and control the order in which their results arrive.
3. THE Context_Resolver SHALL run each Provider independently, so that the failure of one Provider does not change the data of another.
4. THE Context_Resolver SHALL return the same Change_Context for the same inputs (determinism), including the order of `files`, `commits`, `claims`, `candidates`, `checks`, `truncated`, `redactions` and `providers`, and independent of the order in which the Providers return their results.
5. IF an unexpected error stops the stage other than a Provider failure, THEN THE Context_Resolver SHALL throw `StageError('context', cause)`.
6. THE Context_Resolver SHALL NOT write to the working tree, to Git or to the network, and SHALL read Git and the files named by Providers only.
7. THE Git_Provider SHALL run git with the option `--no-optional-locks` and the environment variable `GIT_OPTIONAL_LOCKS=0`, so that no git command writes to the repository (such as the index refresh).
8. THE Context_Resolver SHALL be exported from `packages/ce/src/context/` so that the pipeline and `ce run` can call it.

### Requirement 11: Property-based and example tests

**User Story:** As a maintainer, I want the core invariants of context resolution proven by property tests, so that the issue's "Done when" holds.

#### Acceptance Criteria

1. THE test suite SHALL include a fast-check property that, for all generated secret strings (matching a built-in Secret_Pattern, equal to a Secret_Variable value, or matching a configured pattern) embedded in generated surrounding text, the Redactor output does not contain the secret string.
2. THE test suite SHALL include a fast-check property that the Redactor is idempotent for all generated texts, including generated Secret_Variable values, configured patterns that match part of the Redaction_Marker, and configured patterns with anchors, lookarounds and `\b`, and an example test with the pattern `/^x+$/` and the text `xxSECRETVAL1xx`.
3. THE test suite SHALL include a fast-check property that every Claim_Candidate `text` is a substring of the Candidate_Source_Field named by its Provenance for all generated fields, including generated Comment_Lines of every comment syntax of Requirement 9.8.
4. THE test suite SHALL include a fast-check property that the Token_Estimate (sum of per-field estimates) of the Budgeted_Text never exceeds the Context_Budget and that the Budgeter is deterministic for all generated file sets, including generated sets with a single very long line and with a title that alone exceeds the budget, and a property that every Changed_File whose path fits in phase 1 stays in `change.files`.
5. THE test suite SHALL include a fast-check property that the Change_Context from `resolveContext` is independent of the order in which injected Provider results arrive.
6. THE test suite SHALL include example tests for each Provider with fixtures, including each unavailable path and each Reason_Code of Requirement 3 (including a `context.checks` glob that matches no file), and a test that no git stderr text reaches a Provider_Status.
7. THE test suite SHALL include example tests that the diff of an Env_File never appears in the Change_Context, including a deleted `.env`, a `.env` renamed to `config.txt` with identical content (the old content must not appear, and the Changed_File must carry `path`, `oldPath`, status `renamed`, an empty patch and the Truncation_Record `env-file`), a `.env.production` renamed to `.env.staging`, and files named `.Env`, `ID_RSA`, `Server.PEM`, `deploy.KEY`, `id_ecdsa`, `id_dsa`, `store.p12`, `store.pfx`, `.netrc`, `.git-credentials` and `.pypirc` (each must give an empty patch, the Truncation_Record `env-file` or `sensitive-file`, and no content in the Change_Context), on a case-sensitive and on a case-insensitive file system.
8. THE test suite SHALL include example tests with concrete values for the false positives of Requirement 5.2 and 5.13: `max_tokens: 4000`, `tokenizer=cl100k_base`, `--color-token: var(--brand-primary)` in a `.css` file, `showPassword=false`, `secretary: abcdefghijkl`, `SKIP_TOKEN_CHECK=true`, `const token = getToken()`, `{ accessToken: accessToken }` and `nextPageToken = response.nextPageToken` (all three must stay unchanged), a test that the quoted value `password = "correcthorsebattery"` is still redacted, and the texts `task-list-item-container`, `risk-assessment-for-the-project`, `npm_lifecycle_script`, `npm_config_registry`, and a test that the key is kept when the value is redacted (for example `api_key = "Zq8vK2mXp9LrT4wB"` becomes `api_key = "[REDACTED]"`).
9. THE test suite SHALL include example tests for Base_Ref priority (Requirement 2.1 and 2.2), for the push `before` rule (including 40 zeros and a `before` that does not exist in the repository, which must fall through to the next base source and not give `base-unresolved`), for the Reason_Code `head-missing` (a `pull_request` payload whose `head.sha` is absent from the repository), for the merge-base diff, for a shallow clone, and for a checkout of a synthetic merge commit in which the base branch advanced past `pull_request.base.sha` (the result must hold only the pull request's files and commits, and no merge commit message), using a git repository created in a temporary directory.
10. THE test suite SHALL include an example test that a JUnit file with a DTD and an external entity does not read the referenced file.
11. THE test suite SHALL include an example test that `buildRedactedConfig` and the Redactor redact the same Secret_Variable values for the same environment, including `OPENROUTER_API_KEY: 'k'`, `TYPESAFE_API_KEY: 'ts-bbb'`, a pattern-named variable such as `STRIPE_API_KEY`, and the values `REDACTED` and `RED`, and that `buildRedactedConfig` is idempotent for these values (Requirement 13.4).
12. THE test suite SHALL include an example test that a wrapped commit message of 72 columns yields one candidate per sentence, not one per line.
13. THE test suite SHALL run without a network, a Jev API key or a Git remote.
14. THE property tests SHALL use at least 100 runs each.
15. THE test suite SHALL include an example test that the Git_Provider returns identical output for a repository with `diff.algorithm=patience`, `diff.noprefix=true`, `diff.mnemonicPrefix=true`, `color.ui=always`, `diff.renames=false` and `core.quotePath=true` and for the same repository with the default git configuration, using a path with a space and a non-ASCII character.
16. THE test suite SHALL include example tests that a patch that uses up the Context_Budget still leaves the `path` of every later Changed_File in `change.files` (Requirement 7.6 and 7.7), that a deleted file with a full patch ranks after a modified file, that a `README.md` ranks with other files and `CHANGELOG.md` ranks as Low_Priority_File, and that more than 200 Check_Results yield the record `check:<n>` with the reason `check-cap` and all `failed` results kept.
17. THE test suite SHALL include example tests for Comment_Lines: a `/** … */` block with `*` continuation lines yields no list items and the exact `<path>:<line>` location, a Markdown file with an `<!-- … -->` comment in a diff yields a candidate from the comment while the same comment in the pull request description does not (Requirement 9.8 and 9.9).
18. THE test suite SHALL include an example test that `context.checks` is matched by the in-repo matcher and not by `fs.glob`.
19. THE test suite SHALL include example tests for the Private_Key_Block rule (Requirement 5.15 and 5.16): a patch hunk with only the `BEGIN` line and key body, a hunk with only the `END` line preceded by key body, a hunk with both, a text field with `BEGIN` and no `END`, a block that contains an existing Redaction_Marker, and a patch in which the number of lines and the diff prefixes are unchanged after redaction; in every case no key body line may appear in the output, and the Redactor must be idempotent on the output. A hunk entirely inside a key body without a marker line is documented as a known trade-off and is not tested for redaction.
20. THE test suite SHALL include a fast-check property that the Redactor removes every generated private key body, in the three partial forms of Requirement 5.15, embedded in generated hunk context.
21. THE test suite SHALL include an example test with a repository of at least 120 Changed_Files in which `context.exclude` removes 100 of them, that checks that the Git_Provider returns the kept files, never runs a command with more than one pathspec argument per requested path, and does not end with `git-failed`.
22. THE test suite SHALL include an example test for the orphan patch of Decision D25: `X` renamed to `Y` with `Y` removed by `context.exclude`; the Change_Context must contain no Changed_File for `X` or `Y` and no text of either.
23. THE test suite SHALL include example tests for Requirement 1.20 and 1.21: a Changed_File with a raw patch above 1 048 576 bytes returns an empty `patch`, the record `dropped` and no partial text, and a Patch_Batch above `maxBuffer` is repeated entry by entry (the test may use a lowered `maxBuffer` injected for the test).
24. THE test suite SHALL include example tests for Requirement 1.22 and 1.23: a symbolic link as `context.checks`, an absolute `context.checks` path and a JUnit file above 10 485 760 bytes each give the Reason_Code `source-malformed` and no read of the file content.
25. THE test suite SHALL include example tests for Requirement 9.15: one Comment_Line each for `eslint-disable-next-line`, `# noqa`, `@ts-expect-error`, `@ts-ignore`, a shebang on line 1, and `Copyright 2025 Example` (no candidate), and an ordinary comment next to them (one candidate with the exact `<path>:<line>` location).

### Requirement 12: Traceability to issue #6

**User Story:** As a maintainer, I want each acceptance item of issue #6 mapped to requirements, so that the implementation pull request can close the issue.

#### Acceptance Criteria

1. THE pull request body SHALL contain a table that maps each item of the Issue_Checklist of issue #6 to the Requirements and tests that satisfy it, as given in the Traceability section of this document.
2. WHEN every Requirement mapped in the Traceability section passes its tests, THE pull request SHALL state `Closes #6`.

### Requirement 13: Consistency with the ce-config-loader spec

**User Story:** As a maintainer, I want the shared secret definition to be changed in both specs and their tests together, so that the config section and the context section of `run.json` never disagree about secrets.

#### Acceptance Criteria

1. THE implementation of E7 SHALL create `packages/ce/src/config/secrets.ts` with the Secret_Definition and the Secret_Value_Function, and SHALL change `buildRedactedConfig` in `packages/ce/src/config/redact.ts` to take the secret values of the environment from the Secret_Definition and to remove every secret value (environment values and the values derived from `context.redact` matches in configuration strings) from every string with the Secret_Value_Function (segment splitting at Redaction_Markers, replacement per segment, repeat until the text no longer changes), so that the config section and the context section use the same algorithm and not only the same list. The derivation of secrets from `context.redact` matches in configuration strings stays in `redact.ts`, and the `REDACTED` export of `redact.ts` stays valid.
2. THE Secret_Definition SHALL treat `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` as secret for every non-empty trimmed value, with no condition on length or content, so that the behavior of `buildRedactedConfig` for these two variables stays as it is today.
3. THE implementation SHALL update `.kiro/specs/ce-config-loader/requirements.md` (Glossary term "Secret" and Requirement 7 criteria 3, 6 and 8) and the text of Property 16 in `.kiro/specs/ce-config-loader/design.md`, so that "Secret" also covers the values of Secret_Variables selected by name pattern, and so that they state that `buildRedactedConfig` removes secrets with the Secret_Value_Function (Decision D23).
4. THE implementation SHALL extend the environment generators of the ce-config-loader property tests `packages/ce/src/config/properties/p16-redaction.test.ts` (Property 16, redaction and idempotence) and `packages/ce/src/config/properties/p17-redacted-roundtrip.test.ts` (Property 17, JSON round trip) with a pattern-named variable, and SHALL extend `packages/ce/src/config/properties/p12-report-redaction.test.ts` (Property 12, secrets in the printed report) with a secret from the Secret_Definition, so that the three properties hold for the new definition. The generator of `p16-redaction.test.ts` currently prefixes every secret with `sk-` to keep it from overlapping the `[REDACTED]` marker; THE implementation SHALL add generated secret values that overlap the marker, at least the values `REDACTED` (as a pattern-named variable value) and `RED` (as the value of a named variable), to the environment generator of Property 16, and Property 16 SHALL hold for them (removal of the secret and `second` equal to `first`).
5. WHEN the Secret_Definition and the Secret_Value_Function are in place, THE existing tests of `packages/ce/src/config/` and `packages/ce/src/jev/` SHALL pass without change, except the three files named in Criterion 4 (`p12-report-redaction.test.ts`, `p16-redaction.test.ts` and `p17-redacted-roundtrip.test.ts`), and this includes the tests that use `OPENROUTER_API_KEY: 'k'` (`credentials.test.ts`) and `TYPESAFE_API_KEY: 'ts-bbb'` (`load.test.ts`).
6. WHERE a caller computes the secret list for `reportConfigFailure`, THE caller SHALL obtain it from the Secret_Definition.

## Traceability to issue #6

| Issue #6 acceptance item | Requirements |
| --- | --- |
| Providers: git diff vs base, commit messages, GitHub event payload, CLI args (`--claim`, `--base`), JUnit | 1, 2 |
| Unavailable providers are recorded, not fatal; provenance on everything | 3, 4, 8 |
| Redaction (built-in + configured) before any Jev call; never send `.env*` or other sensitive files | 5 (including 5.15 and 5.16), 6, 13 |
| Budget: prioritise user-facing files, deterministic truncation within 32k state (24k context plus 8k request headroom), record truncation | 7, 8 |
| Claim candidates are extracted text only (sentences / list items) | 9 |
| Done when: property tests show redaction removes generated secrets (idempotent) and every candidate is a substring of the context | 11 (criteria 1, 2, 3, 20), 5.6, 5.7, 5.12, 9.3, 13.4 |
| Refs: R3, Design section 3 | 1 to 10 (R3.1 to R3.5), 9 (R4.1, R4.4), 10 |

| R3 criterion of `requirements.md` | Requirements |
| --- | --- |
| R3.1 collect from every available provider | 1, 2 |
| R3.2 continue when unavailable, do not require Git or a PR | 3 |
| R3.3 provenance for every Change, Claim and Check | 4 |
| R3.4 redaction, never send `.env*`, key files or secret values | 5, 6, 13 |
| R3.5 fit 32k state, prioritise, truncate deterministically, record | 7, 8 |

| Extension of the design section 3 shape | Defined in |
| --- | --- |
| E1 `change.commits` | 1.2, 4.4, 7.1, 7.5 |
| E2 `change.claims` | 1.4, 4.7, 7.1, 7.5 |
| E3 `ChangedFile` fields and `status` values | 1.1, 1.9, 1.10, 1.11, 1.18, 1.19, 1.21, 6.2, 7.6 |
| E4 `redactions` | 5.9, 8.5 |
| E5 `providers[].name` and Reason_Code (including `head-missing`) | 2.13, 3 |
| E6 `truncated[].reason` and Pseudo_Path (including `check-cap` and `check:<n>`) | 1.10, 1.19, 1.21, 6.2, 7.10, 7.14, 9.12 |
| E7 `config/secrets.ts` (`collectSecretValues`, `redactSecretValues`) and `config/redact.ts` | 5.3, 11.11, 13 |

| Decision | Requirements |
| --- | --- |
| D9 head ref and merge commits | 2.4, 2.5, 2.11, 2.12, 11.9 |
| D10 two-stage git | 1.18, 6.1, 6.2, 6.3, 6.7, 6.8, 6.9, 11.7, 11.21, 11.22 |
| D11 redaction fixpoint | 5.5, 5.6, 5.9, 5.12, 5.15, 11.2 |
| D12 token forms | 5.1, 5.13, 11.8 |
| D13 Secret_Variable | 5.3, 13.1, 13.2, 13.5, 11.11 |
| D14 Comment_Line as one field | 9.3, 9.8, 9.14, 11.3, 11.17 |
| D15 two-phase budget | 7.6, 7.7, 7.9, 11.4, 11.16 |
| D16 reproducible git output | 1.14, 1.15, 11.15 |
| D17 check cap | 7.14, 7.15, 8.2, 11.16 |
| D18 push events | 2.1, 2.10, 3.9, 11.9 |
| D19 strict key rule | 5.2, 5.14, 11.8 |
| D20 glob matcher | 1.8, 1.16, 1.17, 3.12, 11.18 |
| D21 file ranking | 7.2, 11.16 |
| D22 partial private keys | 5.1, 5.5, 5.15, 5.16, 11.19, 11.20 |
| D23 one string function for secrets | 5.3, 13.1, 13.3, 13.4, 13.5, 11.11 |
| D24 case-insensitive and extended Sensitive_Files | 6.1, 6.2, 6.3, 11.7 |
| D25 Patch_Batches and orphan patches | 1.18, 1.19, 6.1, 6.8, 6.9, 11.21, 11.22 |
| D26 Raw_Patch_Limit and `maxBuffer` | 1.20, 1.21, 8.2, 11.23 |
| D27 identifier-shaped values | 5.2, 11.8 |
| D28 unresolvable push `before` | 2.10, 3.9, 11.9 |
| D29 `head-missing` | 2.13, 2.14, 3.2, 11.9 |
| D30 JUnit input limits | 1.17, 1.22, 1.23, 1.24, 11.24 |
| D31 Directive_Comment filter | 9.15, 11.25 |
