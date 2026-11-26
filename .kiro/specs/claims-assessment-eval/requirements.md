# Requirements Document

## Introduction

This feature implements the claim identification and the Assessment of Continuous Evidence (CE), together with the labelled evaluation set and the `ce eval` command: GitHub issue #7 in rfxlamia/ce, "[M1] Claims and assessment + eval set" (label `core`, milestone M1 "Otak: konteks & assessment"). It implements R4.2 to R4.4 and R5 of `docs/journal/v0.0/requirements.md`, the `Claim` and `Assessment` data model in section 3 and the question catalog and decision combination in section 4 of `docs/journal/v0.0/design.md`, and R12.1 (evaluation set and `ce eval`). `SPEC.md` is normative and wins on any conflict. SPEC section 3.5 requires that the Assessment is not conflated with a verdict about correctness, section 3.6 requires evidence only when warranted, and section 7.2 forbids fabricating a Claim.

The Assessment stage is the second pipeline stage. It consumes the `ChangeContext` of the ce-context-resolver spec, asks Jev small questions through the `JevGateway` of the jev-gateway spec, combines the probabilities in code under the thresholds of the ce-config-loader spec, and produces the Claims and one `Assessment`. It never decides an Outcome. Jev only chooses between answers whose answer space CE built from observed facts (design section 1, rule 1). The evaluation set measures how well these choices agree with human labels.

The issue has four checklist items and a "Done when" line. All of them are in scope:

1. `claim.is_behavior` per candidate, the claim threshold and the `not_identified` status (Requirements 1, 2 and 3).
2. `assess.runtime_observable`, `assess.checks_adequate` and `assess.surface` (Requirements 4 and 5).
3. The decision combination in code (design section 4), the uncertainty band, the `on-uncertain` policy and `decidedBy` (Requirements 6, 7 and 8).
4. 15 to 20 labelled fixtures in `fixtures/eval/` and `ce eval` reporting agreement per question, built without Git and without sending the same request twice (Requirements 11, 12, 13 and 14, Decisions D15 to D19).
5. "Done when": `ce eval` runs against live Jev and the agreement is recorded in the journal (Requirement 15). The key for that run lives in the gitignored `.env`, which nothing loads today, so `cli.ts` loads it (Requirement 14 criteria 15 to 19, Decision D14).

Requirement 17 maps every item of the issue to the requirements that cover it.

Code lives in `packages/ce/src/assessment/` (`claims.ts`, `assess.ts`, `combine.ts`, `types.ts`, `index.ts`) and `packages/ce/src/eval/` (`fixture.ts`, `context.ts`, `memo.ts`, `agreement.ts`, `run.ts`, `report.ts`, `command.ts`, `index.ts`), plus additions to `packages/ce/src/jev/catalog.ts` (request builders only, Decision D2), `packages/ce/src/context/budget.ts` and `context/index.ts` (one added export, `isTestFile`, Decision D21) and `packages/ce/src/cli.ts` (the `.env` loading of Decision D14 and the `eval` command). The fixtures live at the repository root in `fixtures/eval/`, as design section 11 states. Tests use vitest and fast-check and use `jev/fake.ts`, so they need no API key.

### Facts verified in the code

The following statements were checked by reading the current source before this document was updated. Requirements that depend on them name them.

- F1. `cli.ts` handles only `run`, `help` and `--version`. `ce run` calls `run()`, which throws "not implemented". `cli.ts` has no argument parser, does not call `loadConfig`, `reportConfigFailure` or `createJevGateway`, and does not read `.env`. The `eval` wiring is therefore written from scratch (Decision D15) and does not imitate `ce run`.
- F2. No source file under `packages/ce/src/` loads a `.env` file. `loadConfig`, `requireJevCredentials` and `createJevGateway` read only the `env` object that the caller passes (the tests `factory.test.ts` and `fake.test.ts` enforce that they never read `process.env`). `.env` is listed in `.gitignore`. The script `verify:jev-image` loads it with `tsx --env-file-if-exists`, which a compiled `ce` binary cannot do.
- F3. `process.loadEnvFile(path?)` exists in Node 22 and in the installed `@types/node` 22. Run on the installed Node, it does not overwrite a variable that is already set, including one set to the empty string, it sets the variables that are absent, and it throws an error with code `ENOENT` when the file does not exist.
- F4. `resolveContext` calls `exec` (`git rev-parse --verify --quiet <ref>^{commit}`, inside `commitExists`) whenever the GitHub provider returns a `headSha` or, for a push event, a `before`. `commitExists` catches every exception from `exec` and returns `false`, so an `exec` that only throws would be swallowed. The default `exec` spawns `git`. The option `exec` replaces it, and `providers.git` replaces the Git provider that otherwise calls `exec` as well.
- F5. `resolveContext` sets `change.title` and `change.description` only when the GitHub provider used a pull request event (`githubUsed && pr`). Without a GitHub event, as in a local run, there is no title and no description, and `commits` (listed oldest first by the Git provider, `git log --reverse`) are the only prose source other than `--claim`.
- F6. `extractCandidates` turns every Comment_Line of every patch into a candidate, up to `CANDIDATE_CAP` (50), after the `--claim` texts, title, description and commit messages. It removes duplicate texts, so candidate texts are unique within a Change_Context.
- F7. `EffectiveConfig` is `z.infer` of a schema where every key is optional. `loadConfig` merges `ConfigDefaults` before it validates, so a loaded config holds the defaults, but the type does not say so. `ConfigDefaults.assessment` holds the five values of this feature.
- F8. `budget.ts` ranks files with a private function `rankOf` that treats a path as a test file when a directory segment is `test`, `tests`, `__tests__` or `e2e`, or the base name contains `.test.` or `.spec.`. The predicate is not exported.
- F9. `reportConfigFailure(failure, secrets, stderr)` returns `1` and writes to `stderr`; `collectSecretValues(env)` is exported from `config/secrets.ts`, not from a config index. `createJevGateway(loaded, env, { callLog })` runs `requireJevCredentials` itself and returns `{ ok: false, errors }` on a missing key or an invalid model.
- F10. `FakeJevGateway` looks up a recording by `(idVersion, stateHash, question name)` and throws `FakeRecordingMissingError` when none exists.

Reuse from existing specs:

- `ChangeContext`, `ClaimCandidate`, `Provenance` and `ChangedFile` from `context/types.ts`, and `resolveContext`, `estimateTokens`, `estimateTokensOf`, `fitCheckResults`, `truncateToTokens`, `STATE_BUDGET_TOKENS` and `REQUEST_HEADROOM_TOKENS` from `context/index.ts`. Candidate extraction (R4.1) is already delivered by `context/candidates.ts` and is not changed. The extractor already places the `--claim` texts first, with Provenance provider `cli` and location `--claim[<n>]`.
- The catalog entries `CATALOG.claimIsBehavior`, `CATALOG.assessRuntimeObservable`, `CATALOG.assessChecksAdequate` and `CATALOG.assessSurface` (all at version 1) and `SURFACE_LABELS` from `jev/catalog.ts`. Their question text is not changed by this spec (Decision D2).
- `JevGateway`, `Jev_Request`, `Jev_Response`, `createJevGateway`, `FakeJevGateway`, `RateLimitError` and `JevUsageError` from `jev/`, and `createJsonlCallLog` for `jev-calls.jsonl`.
- The `assessment.thresholds.claim`, `assessment.thresholds.observable`, `assessment.thresholds.adequate`, `assessment.uncertainty-band` and `assessment.on-uncertain` keys of the Config_Schema, with the defaults 0.6, 0.6, 0.7, 0.1 and `evidence`. This spec adds no config key.
- `StageError('assessment', cause)` from `errors.ts`, `loadConfig`, `requireJevCredentials` and `reportConfigFailure` from `config/`.

### Data model

Design section 3 defines `Claim` and `Assessment`. This spec extends them in exactly these places (each is defined in the Requirement named):

```ts
type Surface = 'browser_ui' | 'http_api' | 'cli' | 'backend_internal' | 'native_app' | 'non_runtime';

interface Claim {                     // design: { id, text, probability, provenance }
  id: string;                         // the id of the candidate it came from, for example "c3"
  text: string;                       // exact text of the candidate, never generated
  probability: number | null;         // p(claim.is_behavior); null for a Declared_Claim (E1)
  declared: boolean;                  // true for a Declared_Claim (E1)
  provenance: Provenance;
}

interface Assessment {
  claimStatus: 'identified' | 'not_identified';
  subjects: AssessedSubject[];        // E2: one per Claim, or one Change_Subject
  perClaim: {                         // design shape plus E3
    claimId: string;                  // the claim id, or "change" for the Change_Subject
    runtimeObservable: number;
    checksAdequate: number;
    surface: Surface;
    surfaceConfidence: number;
    needed: boolean;
    uncertain: boolean;
  }[];
  required: boolean;
  decidedBy: 'classifier' | 'policy';
  surface: Surface;                   // dominant surface (Requirement 6)
  record: AssessmentRecord;           // E4 (Requirement 8)
}
```

- E1. `probability` is `number | null` and `declared` is new. A Declared_Claim is a claim the user stated with `--claim`; asking Jev whether the user's own claim describes behaviour would let a model overrule the user, and R4.4 says CE uses the text as a claim. The `null` states that no probability exists, instead of inventing `1`.
- E2. `subjects` is new: `{ id: string; kind: 'claim' | 'change'; text: string; provenance: Provenance }[]`. It records the exact text each assessment question was asked about, which for the Change_Subject is not a Claim (Requirement 3).
- E3. `needed` and `uncertain` in `perClaim` are new, so the combination in Requirement 6 is inspectable per claim.
- E4. `record` is new (Requirement 8). It is the inspectable list of questions, probabilities and policy inputs required by R5.6. Its list of cuts has the entries `{ file: string; reason: 'truncated' | 'dropped' | 'check-cap'; isTest: boolean }` (Requirement 4, Decision D21).

`run.json` embeds `claims` and `assessment` (design section 3). The evidence bundle writer is a later issue; this spec supplies the objects it embeds.

### Decisions

These decisions resolve open points of the issue and the journal.

- D1. Per-state requests. Questions about one state go into one request (R11.2). The candidate classification asks one question per candidate and each candidate is its own state, so it is one request per candidate with one question. The three assessment questions of one subject share one state, so they are one request with three questions. At most 50 candidates exist (`CANDIDATE_CAP`), so at most 50 classification requests and 50 assessment requests happen per run. The gateway paces them (bounded concurrency, `retry-after`).
- D2. Question text. All question text stays in `jev/catalog.ts` (steering rule, R11.5). The four entries this spec uses already exist at version 1 and are not reworded here. The state text of a request (field labels such as `candidate:`, `claim:`, `files:`, `checks:`) is not question text, but the questions refer to the state fields by name (`candidate`, `claim`, `checks`). The request builders therefore live in `jev/catalog.ts`, next to `finalImageQuestions`, so the field names and the questions cannot drift apart. If the live evaluation (Requirement 15) shows that a question must be reworded, the entry version is incremented, `catalog.snapshot.json` is updated with `npm run update:catalog-snapshot`, and the change is recorded in the journal file of Requirement 15.
- D3. Reading answers. A Noul answer is read as the probability of "yes" (`answer.noul`). A Choice answer is read from `answer.probabilities`. A value outside the range 0 to 1, or an answer whose `type` differs from the question, is a malformed answer (Requirement 9).
- D4. Which probabilities can be uncertain. The uncertainty test of design section 4 applies to the two probabilities that feed `needed`: `runtimeObservable` against `thresholds.observable` and `checksAdequate` against `thresholds.adequate`. The claim probability is not part of the test, because the claim threshold only decides which candidates become Claims, before the decision combination exists. The band is closed: a probability `p` is uncertain against a threshold `t` when `|p - t| <= uncertainty-band`. This is a reading of "within ±band" in design section 4.
- D5. `decidedBy`. `decidedBy` is `policy` exactly when no subject has `needed = true` and at least one subject has `uncertain = true`. In that case the value of `required` comes from `on-uncertain` and not from a threshold crossing alone. In every other case `decidedBy` is `classifier`. This includes the case where `needed` is true for a subject that is also uncertain: the threshold decided, and the policy added nothing. This is a reading of R5.5 ("record that the policy, not the classifier, decided").
- D6. Where `supported` is decided. Design section 4 lists `supported = surface(c) ∈ capabilityCatalog` next to the combination. Deciding it here would put an Outcome rule outside `outcome/resolve.ts`. The Assessment therefore only supplies `required` and the dominant `surface`. Comparing the surface with the capability catalog, and mapping `required` to `SKIPPED` or `UNSUPPORTED`, belongs to the outcome resolver (issue #8).
- D7. Dominant surface. Among the subjects that drive the decision (those with `needed` or `uncertain` true, or all subjects when none drives it), the dominant surface is the surface of the subject with the highest `surfaceConfidence`; ties go to the subject that comes first in claim order. The argmax of `assess.surface` ties go to the label that comes first in `SURFACE_LABELS`.
- D8. Empty context. When the Change_Context has no text from which a Change_Subject can be taken and no Claim exists, the Assessment cannot ask a meaningful question. The stage raises `StageError('assessment', cause)` and does not resolve `SKIPPED`, because `SKIPPED` means that CE judged evidence unnecessary, not that CE had nothing to judge. This is a conservative reading that the maintainer can overrule in review.
- D9. Per-question isolation in the evaluation. The evaluation asks the assessment questions for every candidate that the fixture labels as behaviour, not only for the candidates that the classifier accepted. Otherwise the agreement of `assess.*` questions would depend on the agreement of `claim.is_behavior`, and one wrong classification would remove samples from the other questions. The full path (`assess()`) is evaluated separately through the aggregate rows of Requirement 13.
- D10. Evaluation labels. A noul question agrees with its label when the thresholded probability gives the same boolean as the label, using the thresholds of the Effective_Config: `claim.is_behavior` with `thresholds.claim`, `assess.runtime_observable` with `thresholds.observable`, `assess.checks_adequate` with `thresholds.adequate` (adequate means `p >= thresholds.adequate`, the complement of the `needed` test). `assess.surface` agrees when the argmax label equals the label. Probabilities near the threshold are not treated specially, so the band does not change agreement.
- D11. No quality gate. `ce eval` reports agreement and exits 0 when it completed. v0 sets no minimum agreement, because the labelled set is small (15 to 20 fixtures) and the number is a measurement for tuning thresholds, not an acceptance test of the classifier.
- D12. Where the eval fixtures are read. `fixtures/eval/` is at the repository root (design section 11). `ce eval` resolves the directory relative to the working directory, and `--fixtures <dir>` overrides it. The fixtures describe a Change as data (title, description, commits, file patches, checks, `--claim` values). They contain no repository, so `ce eval` needs no Git.
- D13. The journal is not edited. The existing files of `docs/journal/v0.0/` stay as they are. The agreement is recorded in a new file, `docs/journal/v0.0/eval-agreement.md`, as `jev-gateway-verification.md` did for the gateway.
- D14. Loading `.env` (F2, F3). Nothing loads `.env` today, so a key that lives only in `.env` would never reach `ce eval`. `cli.ts`, and only `cli.ts`, calls `process.loadEnvFile()` once before it runs the `run` or `eval` command, and only when a `.env` file exists in the working directory. It then passes `process.env` to the command as `env`. The library modules keep reading only the `env` object they receive. A variable that is already set, including an empty one, is not overwritten (F3), so the real environment wins over the file. The value of a key is never printed, logged or written. A `.env` that cannot be read (for example `EACCES`, or `EISDIR` when `.env` is a directory) stops the command with exit code 1 and a message that names the file and the error code, not its content. `help` and `--version` do not load it. This is new behaviour that the original requirements did not have.
- D15. `ce eval` is wired on its own (F1, F9). `ce run` is a stub and is not a model. `command.ts` exports `runEvalCommand(argv, deps)` and `cli.ts` only calls it with the real dependencies. The command parses `--fixtures` and `--config` itself, calls `loadConfig({ cwd, flags, env })`, reports a failure with `reportConfigFailure`, checks the credential with `requireJevCredentials`, and builds the gateway with `createJevGateway`. `deps` is the test seam: `{ env, cwd, stdout, stderr, createGateway, now }`, all injectable, with the real values as defaults in `cli.ts` only. The function returns the exit code and never calls `process.exit`.
- D16. No Git in `ce eval` (F4). The fixtures are data, so the eval builds the Change_Context with fixture-backed Git, GitHub and JUnit providers and a stub `exec`. The GitHub stand-in returns a pull request with only `title` and `body`, so it has no `headSha`, no `baseSha`, no `baseRef` and no push `before`, and `commitExists` is never reached. The stub `exec` records every call and returns an error; because `commitExists` swallows exceptions (F4), the runner also checks after `resolveContext` that the recorded call list is empty and raises an error when it is not. The test asserts that `git` was never started and that no `git` process exists in the call list.
- D17. One request, one send (cost). Questions asked per candidate (D9) and the questions of `assess()` (Requirement 13 criterion 5) build identical requests for the same candidate, and a fixture can have many candidates (F6). The Eval_Runner wraps the gateway in an Eval_Memo_Gateway keyed by stage, the sorted list of `name@idVersion` of the questions, and `stateHash(state)`. A request with a key that was already sent gets the stored response and is not sent again. The memo lives in memory for one run, implements `JevGateway`, and sits in `eval/memo.ts`, so `assess()` and the Request_Builder do not know it exists (Requirement 10 criterion 4) and Requirement 13 criterion 9 holds: the aggregate rows still come only from `assess()`. The Call_Log is written by the gateway under the memo, so `jev-calls.jsonl` has one line for every request that was really sent. The Eval_Result reports `requests` (sent) and `memoHits` (answered from the memo); the number of questions asked is their sum. A request that fails is not stored.
- D18. Labels of Declared_Claims. A Declared_Claim is a claim by definition (E1), so the classifier never judges it and `isBehavior` has no sample to compare with. The Eval_Fixture therefore does not hold `isBehavior` for a candidate whose Provenance provider is `cli`, and the fixture schema rejects it. The three assessment labels (`runtimeObservable`, `checksAdequate`, `surface`) are still required for it, because `assess()` asks the assessment questions about it and Decision D9 evaluates them. This also keeps `claim.is_behavior` rows free of samples that the classifier never sees.
- D19. Labelling cost. Every candidate needs a label (Requirement 11), and every Comment_Line of a patch is a candidate (F6). The fixtures are therefore written with patches that hold no comment line unless the comment is the point of the fixture (a comment-only change, or a near-miss), and no fixture has more than 12 candidates. This is a limit on the fixture set, checked in CI, and it is not a limit of the extractor.
- D20. Settings with defaults (F7). `assess` and the Eval_Runner read the five assessment values through one function, `resolveAssessmentSettings(config, defaults = ConfigDefaults)`, that falls back to `defaults.assessment` for each missing value and raises `StageError('assessment', cause)` when a value is still missing. `ConfigDefaults` is a constant that holds all five values, so a missing value cannot occur with the default argument; the second parameter is the test seam that lets a test pass incomplete defaults to trigger the error. `assess` and the Eval_Runner call the function with one argument and so use `ConfigDefaults`. The Assessment_Record and the Eval_Result list the resolved values, not the optional ones.
- D21. Patch cutting order (F8, design section 4). `assess.checks_adequate` needs the test files in the diff (design section 4, question table), so test patches are the last thing to be cut. When a request is over `STATE_BUDGET_TOKENS`, patches of non-test files are cut first, starting with the file that comes last in the Change_Context order (the ranked order of `budget.ts`, where low-priority files are last) and moving toward the first. A test patch is cut only when every non-test patch is already empty. Each cut is recorded with `isTest`. To decide what a test file is, `budget.ts` exports its existing predicate as `isTestFile(path)` (re-exported from `context/index.ts`) and `rankOf` calls it; the ranking itself does not change.

Assumptions (the issue and the journal leave these open):

- The Assessment receives the Change_Context after redaction and budgeting. It never sees raw context and never calls the Redactor itself, except to apply the same truncation functions to the request it builds (Requirement 4).
- Live evaluation uses the default provider `openrouter` and `OPENROUTER_API_KEY`. The key is read from the environment or, through the loading of Decision D14, from the gitignored `.env` in the working directory.
- `claim.is_behavior` text is "Does `candidate` describe behaviour that the changed software should exhibit when it is run?" (catalog entry version 1). The state of that request therefore has a field named `candidate` and gives the change summary.

Out of scope: the Context Resolver and its providers (already delivered), the Jev gateway (not changed), `outcome/resolve.ts` and the exit-code mapping (issue #8), the evidence bundle and `run.json` writer (issue #11), the runtime loop, `ce init` and `ce report`, wiring `run()` end to end, and any new config key.

## Glossary

- **Assessment_Engine**: The modules in `packages/ce/src/assessment/` and the stage they implement. They produce Claims and one Assessment from a Change_Context.
- **Claim_Identifier**: `assessment/claims.ts`. It turns Claim_Candidates into Claims.
- **Assessor**: `assessment/assess.ts`. It asks the assessment questions and builds the Assessment.
- **Combiner**: `assessment/combine.ts`. The pure function that turns probabilities, thresholds, band and policy into `needed`, `uncertain`, `required`, `decidedBy` and the dominant surface.
- **Change_Context**: The `ChangeContext` of the ce-context-resolver spec, after redaction and budgeting.
- **Claim_Candidate**: One `{ id, text, provenance }` entry of `ChangeContext.candidates`.
- **Claim**: A Claim_Candidate that became a Claim under Requirement 2, with the fields of the Data model.
- **Declared_Claim**: A Claim whose candidate has Provenance provider `cli`. It is the text of a `--claim` argument.
- **Claim_Threshold**: `assessment.thresholds.claim` of the Effective_Config.
- **Observable_Threshold**: `assessment.thresholds.observable`.
- **Adequate_Threshold**: `assessment.thresholds.adequate`.
- **Uncertainty_Band**: `assessment.uncertainty-band`.
- **Uncertainty_Policy**: `assessment.on-uncertain`, either `evidence` or `skip`.
- **Change_Subject**: The existing text of the Change that the assessment questions are asked about when no Claim was identified (Requirement 3). It is not a Claim.
- **Subject**: Either a Claim or the Change_Subject, whichever the assessment questions are asked about. Not to be confused with the SPEC entity "Subject", which this document writes as "the observed Subject" where needed.
- **Classification_Request**: A Jev_Request that holds one `claim.is_behavior` question for one candidate (Requirement 1).
- **Assessment_Request**: A Jev_Request that holds `assess.runtime_observable`, `assess.checks_adequate` and `assess.surface` for one Subject (Requirement 4).
- **Request_Builder**: The functions in `jev/catalog.ts` that build a Classification_Request and an Assessment_Request from already budgeted data.
- **Needed**: The per-Subject predicate `p(runtime_observable) >= Observable_Threshold AND p(checks_adequate) < Adequate_Threshold`.
- **Uncertain**: The per-Subject predicate of Decision D4.
- **Dominant_Surface**: The surface chosen under Decision D7.
- **Assessment_Record**: The `record` field of the Assessment (Requirement 8).
- **Eval_Fixture**: One JSON file in `fixtures/eval/` that describes a Change and holds the human labels (Requirement 11).
- **Eval_Label**: One human judgement in an Eval_Fixture.
- **Eval_Runner**: `eval/run.ts`. It loads Eval_Fixtures, asks the questions through a `JevGateway` and returns the Eval_Result.
- **Agreement**: The number of samples whose decision equals the Eval_Label, divided by the number of samples, per question (Requirement 13).
- **Eval_Result**: The object that the Eval_Runner returns: per-question Agreement rows, aggregate rows, the list of disagreements, the model ids and the effective thresholds.
- **Eval_Command**: The `ce eval` command. Its logic is `runEvalCommand` in `eval/command.ts`; `cli.ts` only dispatches to it.
- **Eval_Deps**: The injectable dependencies of `runEvalCommand`: `env`, `cwd`, `stdout`, `stderr`, `createGateway` and `now` (Decision D15).
- **Env_File**: The file `.env` in the working directory.
- **Fixture_Providers**: The Git, GitHub and JUnit provider replacements that build a Change_Context from an Eval_Fixture, together with the Stub_Exec (Decision D16).
- **Stub_Exec**: The `exec` function that the Eval_Runner passes to `resolveContext`. It records every call and returns an error.
- **Eval_Memo_Gateway**: The `JevGateway` wrapper in `eval/memo.ts` that answers a repeated request from memory (Decision D17).
- **Test_File**: A path for which `isTestFile` returns true (Decision D21).
- **Cut**: One entry of the list of cuts in the Assessment_Record: a file path or `check:<n>`, a reason and `isTest`.
- **Eval_Journal_File**: `docs/journal/v0.0/eval-agreement.md`.
- **Live_Run**: One run of the Eval_Command against the real Jev API.
- **Surface**: One of `browser_ui`, `http_api`, `cli`, `backend_internal`, `native_app`, `non_runtime` (the labels of `assess.surface`).
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC.md section 7.1).
- **Issue_Checklist**: The acceptance checklist of issue #7, reproduced in Requirement 17.
- **Effective_Config**, **Loaded_Config**: As defined in the ce-config-loader spec.
- **Jev_Gateway**, **Fake_Gateway**, **Call_Log**: As defined in the jev-gateway spec.

## Requirements

### Requirement 1: Classify each claim candidate with Jev

**User Story:** As a reviewer, I want each piece of evidence tied to a claim that really came from the Change, so that I can trust what the evidence is evidence of. *(R4.1, R4.2; SPEC section 7.2)*

#### Acceptance Criteria

1. WHEN the Claim_Identifier receives a Change_Context, THE Claim_Identifier SHALL build one Classification_Request for each Claim_Candidate whose Provenance provider is not `cli`.
2. THE Classification_Request SHALL hold exactly one question, the catalog entry `claim.is_behavior@1`, and SHALL carry the text of the Claim_Candidate in a state field named `candidate`.
3. THE Classification_Request SHALL carry in its state a summary of the Change taken from the Change_Context (title, and the paths and statuses of the changed files), so that the question can be answered about the Change.
4. WHEN a Classification_Request is built, THE Request_Builder SHALL keep the estimated token count of the state, as `estimateTokensOf` computes it, at or below `STATE_BUDGET_TOKENS`, and SHALL shorten the change summary, not the candidate text, to meet that limit.
5. THE Claim_Identifier SHALL send each Classification_Request through the Jev_Gateway with the stage `assessment`.
6. THE Claim_Identifier SHALL read the probability of `claim.is_behavior` from the Noul answer as Decision D3 states.
7. THE Claim_Identifier SHALL NOT change, rewrite, merge or generate the text of a Claim_Candidate. FOR ALL Claims that the Claim_Identifier returns, the `text` of the Claim SHALL equal the `text` of the Claim_Candidate with the same `id` (extraction property, R4.1).
8. THE Claim_Identifier SHALL NOT send any Classification_Request when the Change_Context has no Claim_Candidate whose Provenance provider is not `cli`.

### Requirement 2: Claim threshold, declared claims and the not_identified status

**User Story:** As a reviewer, I want CE to say that it could not identify a claim instead of inventing one, so that the evidence never states a claim the Change did not make. *(R4.2, R4.3, R4.4; SPEC section 7.2)*

#### Acceptance Criteria

1. WHEN the probability of `claim.is_behavior` for a Claim_Candidate is greater than or equal to the Claim_Threshold, THE Claim_Identifier SHALL create a Claim with `probability` set to that value and `declared` set to `false`.
2. WHEN the probability of `claim.is_behavior` for a Claim_Candidate is less than the Claim_Threshold, THE Claim_Identifier SHALL NOT create a Claim for it, and SHALL keep the candidate id and the probability in the Assessment_Record (Requirement 8).
3. WHEN a Claim_Candidate has the Provenance provider `cli`, THE Claim_Identifier SHALL create a Declared_Claim with `probability` set to `null`, `declared` set to `true` and the Provenance of the candidate, and SHALL NOT send a Classification_Request for it.
4. THE Claim_Identifier SHALL return Claims in the order of the Claim_Candidates in the Change_Context.
5. WHEN at least one Claim exists, THE Assessor SHALL set `claimStatus` to `identified`.
6. WHEN no Claim exists, THE Assessor SHALL set `claimStatus` to `not_identified`.
7. WHILE `claimStatus` is `not_identified`, THE Assessor SHALL carry that status in the Assessment so that the evidence states that a claim could not be identified.
8. THE Assessor SHALL NOT create, generate or infer Claim text when `claimStatus` is `not_identified`.
9. FOR ALL sets of probabilities, WHEN the Claim_Threshold rises, THE set of Claims that the Claim_Identifier creates from classified candidates SHALL be a subset of the set it creates at the lower threshold (monotonicity property).

### Requirement 3: Assessment when no claim is identified

**User Story:** As a developer, I want CE to still judge whether a Change needs evidence when no claim was identified, so that a Change with a poor description is not silently skipped. *(R5.1; SPEC section 7.2; design section 4, last paragraph)*

#### Acceptance Criteria

1. WHILE `claimStatus` is `not_identified`, THE Assessor SHALL ask the three assessment questions of Requirement 5 about one Change_Subject.
2. THE Assessor SHALL take the Change_Subject text, in this order, from the first of these that has a non-blank line: the title of the Change, the description, the first commit message in the order of `change.commits`. The text SHALL be the first non-blank line of that source, with leading and trailing whitespace removed, as it appears in the Change_Context, and THE Assessor SHALL record the Provenance of that source in `subjects`.
3. THE Assessor SHALL give the Change_Subject the id `change` and the kind `change`, and SHALL NOT present it as a Claim.
4. IF `claimStatus` is `not_identified` AND the title, the description and every commit message of the Change_Context have no non-blank line, THEN THE Assessor SHALL raise `StageError('assessment', cause)` as Decision D8 states.
5. WHILE `claimStatus` is `identified`, THE Assessor SHALL ask the assessment questions about each Claim and SHALL NOT create a Change_Subject.
6. WHEN the Change_Context has no title and no description, which is the case for every run without a GitHub pull request event (F5), THE Assessor SHALL take the Change_Subject from the first non-blank line of the first commit message, and the test suite SHALL cover that case with a description whose first line is blank.

### Requirement 4: Building assessment requests

**User Story:** As a maintainer, I want every assessment request to be built from redacted, budgeted facts in one place, so that no secret reaches Jev and no request exceeds the model budget.

#### Acceptance Criteria

1. THE Assessor SHALL build one Assessment_Request for each Subject.
2. THE Assessment_Request SHALL hold exactly three questions: `assess.runtime_observable@1`, `assess.checks_adequate@1` and `assess.surface@1`.
3. THE Assessment_Request SHALL carry in its state a field named `claim` with the text of the Subject, a field with the paths and statuses of the changed files, a field with the changed file patches, and a field named `checks` with the Check_Results of the Change_Context.
4. WHEN the Check_Results of the Change_Context would exceed the request headroom, THE Request_Builder SHALL reduce them with `fitCheckResults` to at most `REQUEST_HEADROOM_TOKENS` estimated tokens, so that the obligation of Decision D17 of the ce-context-resolver spec holds.
5. WHEN the estimated token count of the state exceeds `STATE_BUDGET_TOKENS`, THE Request_Builder SHALL shorten patches with `truncateToTokens` until the estimate is at or below `STATE_BUDGET_TOKENS`, and SHALL NOT shorten the Subject text, the file list or the Check_Results beyond criterion 4.
6. WHEN the Request_Builder shortens a patch or drops Check_Results, THE Assessor SHALL record each cut in the Assessment_Record with the file path or the pseudo-path `check:<n>`, the reason `truncated` (patch shortened but not empty), `dropped` (patch emptied) or `check-cap`, and `isTest` (true for a Test_File).
7. WHEN criterion 5 applies, THE Request_Builder SHALL cut the patches of files that are not Test_Files first, one file at a time, starting with the file that comes last in the file order of the Change_Context and moving toward the first, and SHALL shorten each such patch only by the excess it must give up, down to an empty patch (Decision D21).
8. THE Request_Builder SHALL cut the patch of a Test_File only when the patches of all files that are not Test_Files are already empty and the state is still over `STATE_BUDGET_TOKENS`, and SHALL then cut Test_Files in the same order as criterion 7.
9. IF the estimated token count of the state exceeds `STATE_BUDGET_TOKENS` after every patch is empty, THEN THE Assessor SHALL raise `StageError('assessment', cause)` and SHALL NOT send the request.
10. THE Request_Builder SHALL decide that a path is a Test_File only with `isTestFile` exported by `context/index.ts`, the predicate that `budget.ts` uses to rank files (F8), so that the ranking and the cutting agree.
11. THE Request_Builder SHALL NOT read the environment, the file system or the network, and SHALL NOT add text that did not come from the Change_Context, the Subject or the catalog.
12. FOR ALL Change_Contexts, THE state of an Assessment_Request SHALL NOT contain any text that is absent from the Change_Context, apart from the field labels of the Request_Builder (no-new-text property).
13. THE Assessor SHALL send each Assessment_Request through the Jev_Gateway with the stage `assessment`, in one request per Subject.
14. THE Assessor SHALL NOT send an Assessment_Request, a Classification_Request or any other Jev request with an image.

### Requirement 5: Assessment questions and answers

**User Story:** As a developer, I want CE to skip changes my tests already cover and to find the surface where a behaviour would show up, so that CE adds evidence and not noise. *(R5.1, R5.2; SPEC sections 3.6 and 6.1)*

#### Acceptance Criteria

1. THE Assessor SHALL read `runtimeObservable` as the Noul probability of `assess.runtime_observable@1`.
2. THE Assessor SHALL read `checksAdequate` as the Noul probability of `assess.checks_adequate@1`.
3. THE Assessor SHALL read the Choice probabilities of `assess.surface@1` over the six labels of `SURFACE_LABELS`, SHALL select the label with the highest probability as the `surface` of the Subject, and SHALL set `surfaceConfidence` to the probability of that label.
4. WHEN two labels of `assess.surface@1` have the same highest probability, THE Assessor SHALL select the label that comes first in `SURFACE_LABELS`.
5. THE Assessor SHALL NOT use any text that Jev returned as an input to a decision, as a Claim, or as a field of the Assessment. Only probabilities are used (design section 1, rule 1).
6. WHEN the answers of an Assessment_Request are read, THE Assessor SHALL return one `perClaim` entry for each Subject, with `claimId` set to the Claim id, or to `change` for the Change_Subject.

### Requirement 6: Decision combination in code

**User Story:** As a maintainer, I want the thresholds to live in `ce.yml` and the decision to live in code, so that a decision can be reproduced from the recorded probabilities. *(R5.1, R5.3, R5.4; design section 4, "Decision combination")*

#### Acceptance Criteria

1. THE Combiner SHALL be a pure function of the per-Subject probabilities and surfaces, the Observable_Threshold, the Adequate_Threshold, the Uncertainty_Band and the Uncertainty_Policy. THE Combiner SHALL NOT call the Jev_Gateway, read the environment or read the clock.
2. THE Combiner SHALL set `needed` of a Subject to `true` when `runtimeObservable` is greater than or equal to the Observable_Threshold and `checksAdequate` is less than the Adequate_Threshold, and to `false` otherwise.
3. THE Combiner SHALL set `uncertain` of a Subject to `true` when `|runtimeObservable - Observable_Threshold|` is at most the Uncertainty_Band or `|checksAdequate - Adequate_Threshold|` is at most the Uncertainty_Band, and to `false` otherwise (Decision D4).
4. WHEN at least one Subject has `needed` set to `true`, THE Combiner SHALL set `required` to `true`.
5. WHEN no Subject has `needed` set to `true` AND at least one Subject has `uncertain` set to `true`, THE Combiner SHALL set `required` to `true` while the Uncertainty_Policy is `evidence`, and to `false` while the Uncertainty_Policy is `skip`.
6. WHEN no Subject has `needed` set to `true` AND no Subject has `uncertain` set to `true`, THE Combiner SHALL set `required` to `false`.
7. THE Combiner SHALL set the Assessment `surface` to the Dominant_Surface of Decision D7.
8. THE Combiner SHALL NOT compare the Dominant_Surface with the capability catalog, SHALL NOT map `required` to an Outcome, and SHALL NOT import `outcome/resolve.ts` (Decision D6).
9. FOR ALL inputs, THE Combiner SHALL return a boolean `required` and exactly one `decidedBy` value (totality property).
10. FOR ALL inputs, `required` SHALL equal `any(needed) OR (any(uncertain) AND Uncertainty_Policy = evidence)` (equivalence with design section 4).
11. FOR ALL inputs, WHEN the Uncertainty_Band is 0, THE `uncertain` value of a Subject SHALL be `true` only if a probability equals its threshold exactly.

### Requirement 7: Uncertainty policy and decidedBy

**User Story:** As a reviewer, I want to see when the configured policy and not the classifier decided, so that I can tell a confident decision from a policy default. *(R5.5)*

#### Acceptance Criteria

1. WHEN no Subject has `needed` set to `true` AND at least one Subject has `uncertain` set to `true`, THE Combiner SHALL set `decidedBy` to `policy`.
2. WHEN at least one Subject has `needed` set to `true`, THE Combiner SHALL set `decidedBy` to `classifier`.
3. WHEN no Subject has `needed` set to `true` AND no Subject has `uncertain` set to `true`, THE Combiner SHALL set `decidedBy` to `classifier`.
4. WHILE `decidedBy` is `policy`, THE Assessor SHALL record the Uncertainty_Policy that decided and the probabilities that were within the Uncertainty_Band in the Assessment_Record.
5. FOR ALL inputs, `decidedBy` SHALL equal `policy` if and only if `any(needed)` is `false` and `any(uncertain)` is `true` (decidedBy property).
6. FOR ALL inputs, WHEN `decidedBy` is `classifier`, THE value of `required` SHALL be the same under the Uncertainty_Policy `evidence` and the Uncertainty_Policy `skip` (policy-irrelevance property).
7. THE Assessor SHALL accept the Uncertainty_Policy only from the Effective_Config, and SHALL NOT change a probability or a threshold to apply the policy.

### Requirement 8: Inspectable assessment record

**User Story:** As a reviewer, I want every question, model version and probability that led to a decision, so that I can inspect the decision and not take it on trust. *(R5.6; SPEC section 3.5)*

#### Acceptance Criteria

1. THE Assessor SHALL return an Assessment_Record that lists, for every Jev question asked by the Assessment_Engine, the catalog id and version (`id@version`), the id of the candidate or Subject it was asked about, and the returned probability (a Noul probability, or the Choice probabilities per label).
2. THE Assessment_Record SHALL list every Claim_Candidate that was classified, with its probability and whether it became a Claim.
3. THE Assessment_Record SHALL list the distinct Returned_Model_Ids of all Jev_Responses of the stage.
4. THE Assessment_Record SHALL list the effective Claim_Threshold, Observable_Threshold, Adequate_Threshold, Uncertainty_Band and Uncertainty_Policy used.
5. THE Assessment_Record SHALL list every cut of Requirement 4 criterion 6, in the order in which the Request_Builder made it, each with its `isTest` value.
6. THE Assessment_Record SHALL NOT contain the text of a question, the state text of a request, or an API key.
7. THE Assessment_Record and the Assessment SHALL be plain JSON-serializable data. FOR ALL Assessments, `JSON.parse(JSON.stringify(a))` SHALL equal `a` (round-trip property).
8. THE report text and the summaries that this spec produces SHALL call classifier output a "signal" and SHALL NOT call the Assessment a verdict on the correctness of the software (SPEC section 3.5).

### Requirement 9: Failure handling and module boundaries

**User Story:** As a maintainer, I want assessment failures to reach the pipeline as stage errors and the module rules of the repository to hold, so that outcomes and question text stay in their one place.

#### Acceptance Criteria

1. IF a Jev request of the Assessment_Engine raises `RateLimitError` after the gateway retries are exhausted, THEN THE Assessment_Engine SHALL raise `StageError('assessment', cause)` with the `RateLimitError` as `cause`.
2. IF any other error is raised while the Assessment_Engine asks a question, THEN THE Assessment_Engine SHALL raise `StageError('assessment', cause)`, except that an error that is already a `StageError` SHALL pass through unchanged.
3. IF an answer has a `type` that differs from the question, or a probability outside the range 0 to 1, or a Choice answer without all six `SURFACE_LABELS`, THEN THE Assessment_Engine SHALL raise `StageError('assessment', cause)`.
4. THE Assessment_Engine SHALL NOT return a partial Assessment when it raises.
5. THE Assessment_Engine SHALL NOT decide an Outcome, SHALL NOT import `outcome/resolve.ts`, and SHALL NOT contain the strings `SKIPPED`, `EVIDENCED` or `UNSUPPORTED` as values it returns.
6. THE Assessment_Engine SHALL NOT define question text. Only `jev/catalog.ts` SHALL contain question text and SHALL call `noul`, `choice`, `score`, `box`, `image` or `withAssets`.
7. THE Assessment_Engine SHALL NOT import `@typesafe-ai/sdk`, SHALL NOT call `fetch`, and SHALL reach Jev only through the `JevGateway` interface and the Request_Builder functions.
8. THE Assessment_Engine SHALL NOT write to the target application, to Git or to any file other than the Call_Log that the caller passed to the gateway.
9. THE test suite SHALL include an architecture test that enforces criteria 5 to 7, in the style of `jev/architecture.test.ts`.

### Requirement 10: Public API

**User Story:** As a pipeline developer, I want one function that turns a Change_Context into Claims and an Assessment, so that `run()` and `ce eval` share one code path. *(R1.4)*

#### Acceptance Criteria

1. THE Assessment_Engine SHALL export a function `assess(context, config, gateway)` that takes a Change_Context, the Effective_Config and a Jev_Gateway, and returns a promise of `{ claims: Claim[], assessment: Assessment }`.
2. THE Assessment_Engine SHALL export the Combiner function and the types `Claim`, `Assessment`, `Surface`, `AssessedSubject` and `AssessmentRecord` from `assessment/index.ts`.
3. THE function `assess` SHALL read the thresholds, the band and the policy only from the `assessment` key of the Effective_Config it receives, through `resolveAssessmentSettings`, and SHALL NOT read any other setting (Decision D20).
4. THE function `assess` SHALL accept any object that implements `JevGateway`, including the Fake_Gateway, and SHALL NOT know which one it received.
5. THE function `assess` SHALL NOT read `process.env`.
6. WHEN the same Change_Context, Effective_Config and recorded answers are given twice, THE function `assess` SHALL return equal results (determinism property).
7. WHEN a value of the `assessment` key is absent from the Effective_Config it receives (F7), THE function `resolveAssessmentSettings(config, defaults = ConfigDefaults)` SHALL use the value of `defaults.assessment` for that value alone, and SHALL NOT treat an absent value as 0, as `undefined` in a comparison, or as a reason to skip the Assessment.
8. IF a value of the `assessment` key is absent from both the `config` argument and the `defaults` argument, THEN THE function `resolveAssessmentSettings` SHALL raise `StageError('assessment', cause)`. THE `defaults` parameter SHALL default to `ConfigDefaults`, and `assess` SHALL NOT pass a second argument, so that production code always uses `ConfigDefaults`.
9. THE function `resolveAssessmentSettings` SHALL be exported from `assessment/index.ts`, SHALL be the only place that reads the `assessment` key, and the Eval_Runner SHALL use it for Decision D10 and for the settings it reports.

### Requirement 11: Labelled evaluation fixtures

**User Story:** As a maintainer, I want a small labelled set of Changes, so that I can measure how well the questions agree with a human reader. *(R12.1; design section 11)*

#### Acceptance Criteria

1. THE repository SHALL contain between 15 and 20 Eval_Fixtures, as JSON files in `fixtures/eval/`, one Change per file.
2. EACH Eval_Fixture SHALL hold an `id` that equals the file name without `.json`, a short `description`, the Change as data (`title`, `description`, `commits`, `files` with `path`, `status` and `patch`, and optional `claims` for `--claim` values), the Check_Results (`checks`), and the Eval_Labels.
3. THE Eval_Labels of an Eval_Fixture SHALL hold, for every Claim_Candidate that the candidate extractor produces from the fixture and whose Provenance provider is not `cli`, a boolean `isBehavior`, keyed by the exact candidate text. THE Eval_Labels SHALL NOT hold `isBehavior` for a candidate whose Provenance provider is `cli`, because a Declared_Claim is never classified (Decision D18).
4. THE Eval_Labels of an Eval_Fixture SHALL hold, for every candidate labelled `isBehavior` true and for every candidate whose Provenance provider is `cli`, a boolean `runtimeObservable`, a boolean `checksAdequate` and one `surface` of the six Surface values.
5. THE Eval_Labels of a Eval_Fixture SHALL hold the expected `claimStatus` and the expected `required` value of the whole Change.
6. THE set of Eval_Fixtures SHALL contain at least three fixtures with `required` false because existing Checks are adequate, at least three fixtures with `required` true and the label surface `browser_ui`, at least two fixtures with `required` true and a label surface other than `browser_ui` and `non_runtime`, at least one fixture with the expected `claimStatus` `not_identified`, and at least one fixture with a `claims` entry.
7. THE set of Eval_Fixtures SHALL contain each of the six Surface values in at least one `surface` label.
8. THE Eval_Fixtures SHALL NOT contain an API key, a token, a private key, or any text taken from a private repository.
9. THE Eval_Fixtures SHALL be written by a person or taken from public changes, and the labels SHALL be set by reading the Change, not by running Jev.
10. THE set of Eval_Fixtures SHALL include at least two fixtures with near-miss text: a Change whose title sounds like behaviour but whose files change only tooling or documentation, and a Change that touches a user-facing file while its Checks already exercise the behaviour.
11. THE candidate extractor SHALL produce at most 12 Claim_Candidates from each Eval_Fixture, and the patches of the fixtures SHALL hold no Comment_Line unless the comment is the purpose of that fixture, so that every candidate can be labelled by hand (Decision D19).

### Requirement 12: Loading and validating fixtures

**User Story:** As a maintainer, I want a malformed or incomplete fixture to fail loudly, so that a bad label never produces a misleading agreement number.

#### Acceptance Criteria

1. THE Eval_Runner SHALL validate every Eval_Fixture against a zod schema before it asks any Jev question.
2. THE Eval_Runner SHALL build the Change_Context of a fixture with `resolveContext` and the Fixture_Providers, so that redaction, budgeting and candidate extraction are the production code and not a copy. The Fixture_Providers SHALL be: a Git provider that returns the fixture files and commits with status `used`; a GitHub provider that returns a pull request with only `title` and `body`, and no `baseSha`, `baseRef` or `headSha`, when the fixture has a title or a description, and status `unavailable` with reason `source-absent` otherwise; a JUnit provider that returns the fixture checks; and the production `resolveCliArgs` fed with the fixture `claims`. THE Eval_Runner SHALL pass the `env` of the command to `resolveContext`, so that the secret values of the environment are redacted, and SHALL NOT read `GITHUB_EVENT_PATH`.
3. IF an Eval_Fixture fails validation, THEN THE Eval_Runner SHALL report the file name, the field path, the offending value and the expected shape, and SHALL NOT ask any Jev question.
4. IF the candidate extractor produces a candidate that lacks a required label (`isBehavior` for a candidate whose provider is not `cli`, or the three assessment labels for a labelled behaviour or a Declared_Claim), THEN THE Eval_Runner SHALL report the fixture id, the candidate text and the missing label, and SHALL NOT ask any Jev question.
5. IF an Eval_Label names a candidate text that the candidate extractor did not produce, THEN THE Eval_Runner SHALL report the fixture id and the label text, and SHALL NOT ask any Jev question.
6. IF the fixture directory does not exist or contains no `.json` file, THEN THE Eval_Runner SHALL report the directory and SHALL NOT ask any Jev question.
7. THE Eval_Runner SHALL read the fixtures in ascending order of file name, so that two runs over the same files ask the same questions in the same order.
8. THE Eval_Runner SHALL NOT modify a fixture file.
9. THE Eval_Runner SHALL pass to `resolveContext` a Stub_Exec that records every call it receives and returns an error, and SHALL NOT pass the default `exec` (Decision D16).
10. WHEN `resolveContext` returns, IF the Stub_Exec recorded at least one call, THEN THE Eval_Runner SHALL raise `StageError('context', cause)` naming the fixture id and SHALL NOT ask any Jev question, because `resolveContext` swallows an exception from `exec` (F4) and a throwing stub would hide the call.
11. THE Eval_Runner SHALL NOT start `git`, any other child process, a browser or a network connection other than the Jev requests of the gateway it received.

### Requirement 13: Agreement per question

**User Story:** As a maintainer, I want the agreement of each question with the labels, so that I can see which question to tune. *(R12.1; issue: "reporting agreement per question")*

#### Acceptance Criteria

1. THE Eval_Runner SHALL report one row for each of `claim.is_behavior`, `assess.runtime_observable`, `assess.checks_adequate` and `assess.surface`, with the number of samples, the number of agreeing samples and the Agreement as a number from 0 to 1.
2. THE Eval_Runner SHALL ask `claim.is_behavior` for every Claim_Candidate of every fixture whose Provenance provider is not `cli`, and SHALL compare `p >= Claim_Threshold` with the label `isBehavior` (Decision D10).
3. THE Eval_Runner SHALL ask the three assessment questions for every candidate that the fixture labels `isBehavior` true and for every Declared_Claim candidate, whatever the classifier answered for it (Decision D9), through the same Request_Builder and the same answer reading as the Assessor.
4. THE Eval_Runner SHALL compare `p(assess.runtime_observable) >= Observable_Threshold` with the label `runtimeObservable`, `p(assess.checks_adequate) >= Adequate_Threshold` with the label `checksAdequate`, and the argmax label of `assess.surface` with the label `surface` (Decision D10).
5. THE Eval_Runner SHALL also run `assess()` on every fixture, and SHALL report one aggregate row `assessment.required` that compares `Assessment.required` with the expected `required`, and one aggregate row `assessment.claimStatus` that compares `claimStatus` with the expected value.
6. THE Eval_Runner SHALL report the number of samples of every row, and WHEN a row has zero samples, THE Eval_Runner SHALL report its Agreement as `null` and not as 0 or 1.
7. THE Eval_Result SHALL list every disagreement with the fixture id, the question, the candidate text or `change`, the returned probability or label, and the Eval_Label.
8. THE Eval_Result SHALL list the effective Claim_Threshold, Observable_Threshold, Adequate_Threshold, Uncertainty_Band and Uncertainty_Policy, the distinct Returned_Model_Ids, the number of fixtures, `requests` (the number of Jev requests that reached the gateway) and `memoHits` (the number of requests answered by the Eval_Memo_Gateway).
9. THE Eval_Runner SHALL count the aggregate rows only from the result of `assess()` and SHALL NOT recompute `required` itself.
10. FOR ALL Eval_Results, THE number of agreeing samples of a row SHALL be at most its number of samples, and THE Agreement SHALL lie in the range 0 to 1 when the number of samples is greater than 0 (bounds property).
11. FOR ALL Eval_Results, THE number of disagreements listed for a row SHALL equal its number of samples minus its number of agreeing samples (accounting property).
12. THE Eval_Runner SHALL NOT decide an Outcome and SHALL NOT treat Agreement as a verdict on the correctness of the software.
13. THE Eval_Runner SHALL send every Jev request through an Eval_Memo_Gateway, keyed by the stage, the sorted list of `name@idVersion` of the questions and `stateHash` of the state, so that a request with a key that was already sent is answered with the stored response and is not sent again (Decision D17).
14. THE Eval_Memo_Gateway SHALL implement `JevGateway`, SHALL live in `eval/memo.ts`, and SHALL NOT be known to `assess()`, the Request_Builder or the Combiner. THE Eval_Memo_Gateway SHALL share one stored answer between concurrent identical requests, and SHALL NOT store a request that failed.
15. THE Call_Log `jev-calls.jsonl` SHALL hold one entry for each request counted in `requests` and none for a memo hit, and `requests + memoHits` SHALL equal the number of requests that the Eval_Runner, the Claim_Identifier and the Assessor asked for.
16. FOR ALL Eval_Results, the rows, the aggregate rows and the disagreement list SHALL be equal with and without the Eval_Memo_Gateway (memo-transparency property). THE aggregate rows SHALL still be counted only from the result of `assess()` (criterion 9).

### Requirement 14: The `ce eval` command

**User Story:** As a maintainer, I want one command that runs the evaluation and prints the agreement, so that I can repeat it after every change to a threshold or a question. *(R12.1)*

#### Acceptance Criteria

1. WHEN `runEvalCommand` runs, THE Eval_Command SHALL do these steps in this order and SHALL stop at the first one that fails: parse the arguments, call `loadConfig({ cwd, flags, env })`, check the credential with `requireJevCredentials`, build the gateway with `createGateway` (by default `createJevGateway`) with a Call_Log, load and validate the fixtures, run the Eval_Runner, write the output and print the Eval_Result (Decision D15).
2. THE Eval_Command SHALL accept `--fixtures <dir>` and `--config <path>`, each also in the form `--name=value`, with the default `fixtures/eval` relative to `cwd`. THE Eval_Command SHALL pass `--config` to `loadConfig` as the flag `config`, and SHALL pass no other flag.
3. THE Eval_Command SHALL print one line per row with the question id, the number of samples, the number of agreeing samples and the Agreement as a percentage, and SHALL print the list of disagreements after the table.
4. THE Eval_Command SHALL write a machine-readable `eval.json` with the Eval_Result and the Call_Log `jev-calls.jsonl` to a new directory `<output.dir>/eval-<timestamp>/`, and SHALL print its path.
5. IF `loadConfig` fails, THEN THE Eval_Command SHALL call `reportConfigFailure(failure, collectSecretValues(env), stderr)`, SHALL return exit code 1, and SHALL NOT call `createGateway`. IF `requireJevCredentials` or `createGateway` returns `{ ok: false, errors }`, THEN THE Eval_Command SHALL report the errors in the same way, naming `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`, and SHALL return exit code 1 without a network call.
6. IF a fixture is invalid (Requirement 12), THEN THE Eval_Command SHALL print the report of Requirement 12 and SHALL exit with code 1.
7. IF the Eval_Runner raises a `StageError`, THEN THE Eval_Command SHALL print the stage name and the cause constructor name, and SHALL exit with code 1.
8. WHEN the Eval_Runner completes, THE Eval_Command SHALL exit with code 0, whatever the Agreement is (Decision D11).
9. THE Eval_Command SHALL NOT print an API key, an Authorization header or the state text of a request, and SHALL NOT write any of them to `eval.json`.
10. THE Eval_Command SHALL list `eval` in the output of `ce --help`.
11. THE Eval_Command SHALL NOT start a browser, SHALL NOT start or contact a target application, SHALL NOT start `git` (Requirement 12 criteria 9 to 11, Decision D16), and SHALL NOT read `GITHUB_EVENT_PATH`.
12. THE Eval_Command SHALL be the exported function `runEvalCommand(argv, deps)` that returns a promise of the exit code, where `deps` holds `env`, `cwd`, `stdout`, `stderr`, `createGateway` and `now`, and `createGateway(loaded, env, { callLog })` returns `{ ok: true, gateway: JevGateway }` or `{ ok: false, errors }` (Decision D15).
13. THE function `runEvalCommand` SHALL read the environment, the working directory, the clock and the output streams only through `deps`, SHALL NOT call `process.exit`, and SHALL NOT read `process.env`. `cli.ts` SHALL be the only file that supplies the real `process.env`, `process.cwd()`, `process.stdout`, `process.stderr`, `createJevGateway` and `new Date`.
14. IF an option is unknown, is given twice, or has no value, THEN THE Eval_Command SHALL print a message that names the option, SHALL print the usage, SHALL return exit code 1, and SHALL NOT call `loadConfig` or `createGateway`.
15. WHEN `cli.ts` is about to run the `run` command or the `eval` command AND a file named `.env` exists in the working directory, THE `cli.ts` module SHALL call `process.loadEnvFile('.env')` once, before it passes `process.env` to the command (Decision D14, F2, F3).
16. WHEN `cli.ts` loads the Env_File, THE `cli.ts` module SHALL leave every variable that is already set in the environment unchanged, including a variable set to the empty string, and SHALL set only the variables that are absent.
17. IF no `.env` exists in the working directory, THEN THE `cli.ts` module SHALL NOT call `process.loadEnvFile` and SHALL NOT report an error. IF the Env_File exists but cannot be read (for example `EACCES`, or `EISDIR` when `.env` is a directory), THEN THE `cli.ts` module SHALL print the file name and the error code, SHALL NOT print any content or value of the file, and SHALL exit with code 1 before the command runs.
18. THE `help`, `--help` and `--version` commands SHALL NOT load the Env_File, and `process.loadEnvFile` SHALL appear in `cli.ts` only. No file under `packages/ce/src/` other than `cli.ts` SHALL load an Env_File.
19. THE `cli.ts` module SHALL NOT print, log or write the value of any variable loaded from the Env_File.

### Requirement 15: Live run and journal record

**User Story:** As the project owner, I want the agreement of the real classifier recorded in the journal, so that the thresholds are tuned from measured numbers and not from guesses. *(Issue "Done when")*

#### Acceptance Criteria

1. WHEN all implementation tasks are complete, THE implementer SHALL run the Eval_Command against the live Jev API with the provider `openrouter`, without any step from the user. The key comes from `OPENROUTER_API_KEY` in the environment or in the gitignored `.env`, which `cli.ts` loads under Requirement 14 criteria 15 to 17.
2. THE implementer SHALL record the Live_Run in the Eval_Journal_File, with: the run date in UTC, the git commit of the code, the provider, the Returned_Model_Ids, the number of fixtures, the effective thresholds, band and policy, the table of rows of Requirement 13, the list of disagreements, and the command that reproduces the run.
3. THE Eval_Journal_File SHALL state which value is a measurement and SHALL copy that value from the `eval.json` of the Live_Run. It SHALL NOT contain an estimated or invented value.
4. THE Eval_Journal_File SHALL NOT contain an API key, an Authorization header, the state text of a request, or the text of a private repository.
5. IF the Live_Run cannot happen because `OPENROUTER_API_KEY` is not available, THEN THE implementer SHALL record the status `not tested (blocked: OPENROUTER_API_KEY not set)` in the Eval_Journal_File, SHALL NOT invent a number, and SHALL treat the "Done when" line of issue #7 as not met.
6. IF the Live_Run raises an error, THEN THE implementer SHALL record the error class and the stage in the Eval_Journal_File, SHALL fix the cause when it lies in this feature, and SHALL repeat the run.
7. WHEN the Live_Run shows that a question or a threshold must change, THE implementer SHALL record the finding in the Eval_Journal_File and SHALL change the question under Decision D2 or the default under the ce-config-loader spec only after the maintainer has agreed, and SHALL repeat the run after the change.
8. THE Eval_Journal_File SHALL state that its first lines of Agreement are one measurement of one model on 15 to 20 fixtures and not a general accuracy claim.
9. THE implementer SHALL NOT edit `design.md`, `requirements.md` or any other existing file of `docs/journal/v0.0/`. This follows Decision D13.
10. THE Eval_Journal_File SHALL link to issue #7 and to the fixtures directory.

### Requirement 16: Test coverage

**User Story:** As a maintainer, I want core invariants proven by property-based tests and CI to run without an API key, so that the Assessment stays correct as thresholds and questions change. *(R12.2; steering "Test policy")*

#### Acceptance Criteria

1. THE test suite SHALL use `FakeJevGateway` and SHALL NOT call the network, `fetch` or the real SDK, and SHALL pass with no API key in the environment.
2. THE tests that need recordings SHALL build them in the test from the Request_Builder output and the `stateHash` function, so that a change to a state layout fails the test on the missing recording and not silently.
3. THE test suite SHALL include a fast-check property for each of: the extraction property (Requirement 1 criterion 7), the monotonicity property (Requirement 2 criterion 9), the totality property, the equivalence property and the zero-band property of the Combiner (Requirement 6 criteria 9 to 11), the decidedBy property and the policy-irrelevance property (Requirement 7 criteria 5 and 6), the round-trip property (Requirement 8 criterion 7), the no-new-text property (Requirement 4 criterion 12), the determinism property (Requirement 10 criterion 6), and the bounds and accounting properties (Requirement 13 criteria 10 and 11).
4. THE test suite SHALL include unit tests that cover: a candidate exactly at the Claim_Threshold becomes a Claim; a Declared_Claim sends no Classification_Request; no accepted Claim gives `not_identified` and a Change_Subject; empty context raises `StageError`; the three uncertainty cases (`needed`, only `uncertain` with `evidence`, only `uncertain` with `skip`); a tie on `assess.surface`; a malformed answer raises `StageError`; a `RateLimitError` raises `StageError('assessment', cause)`.
5. THE test suite SHALL include a test that, for a Subject whose probabilities are far from both thresholds, `decidedBy` is `classifier` for both policies.
6. THE test suite SHALL include a test that every question text used by the Assessment_Engine comes from the catalog, in the style of `jev/architecture.test.ts` (Requirement 9 criterion 9).
7. THE test suite SHALL include a test of the Eval_Runner with the Fake_Gateway that checks the rows, the aggregate rows, the disagreement list, the `null` Agreement of an empty row, and that no Jev question is asked when a fixture is invalid.
8. THE test suite SHALL include a test that loads the real files in `fixtures/eval/` and checks Requirement 11 criteria 1 to 7 and 10, and Requirement 12 criteria 1, 4 and 5, so that a bad fixture fails in CI without an API key.
9. THE test suite SHALL include a test of `runEvalCommand` that supplies `env`, `cwd` (a temporary directory), `stdout`, `stderr`, `now` and a `createGateway` that returns the Fake_Gateway, and that checks the printed rows, `eval.json`, `jev-calls.jsonl`, exit code 0 for a completed run, exit code 1 for a missing credential with `createGateway` not called, exit code 1 for an invalid config file, exit code 1 for each case of Requirement 14 criterion 14, and that no output contains the key.
10. THE test suite SHALL include a test that `catalog.snapshot.json` is unchanged by this feature unless Decision D2 applies.
11. THE test suite SHALL include a test that runs `cli.ts` in a child process with a temporary working directory, no `OPENROUTER_API_KEY` in the child environment, and a `.env` that sets a fake key, and that checks that `ce eval --fixtures <missing directory>` reports the missing fixture directory (Requirement 12 criterion 6) and not a missing credential, makes no network call, and prints no part of the fake key. The same test SHALL check that without the `.env` the output names `OPENROUTER_API_KEY`, that a key set in the child environment is not replaced by a different value in `.env`, that a key set to the empty string is not replaced either, and that `ce --help` does not load the file (Requirement 14 criteria 15 to 19). The same test SHALL also cover the case where `.env` cannot be read, by making `.env` a directory in the temporary working directory (error code `EISDIR`), and SHALL check that `ce eval` exits with code 1, that the output names `.env` and `EISDIR`, that no content or value of any file is printed, and that the command does not run (Requirement 14 criterion 17).
12. THE test suite SHALL include a test that runs the Eval_Runner over the real files in `fixtures/eval/` with `node:child_process` replaced by a spy and the Fake_Gateway, and that checks that the spy was never called and the Stub_Exec recorded no call. THE test suite SHALL also include a test in which a Fixture_Providers GitHub stand-in is replaced by one that returns a `headSha`, and that checks that the Eval_Runner raises `StageError('context', cause)` and asks no Jev question (Requirement 12 criteria 9 to 11).
13. THE test suite SHALL include tests of the Eval_Memo_Gateway that check: two identical requests reach the underlying gateway once; requests that differ in state, in question set or in stage reach it separately; two concurrent identical requests reach it once; a failed request is not stored; the Call_Log of a recording gateway has `requests` entries; `requests + memoHits` equals the number asked; and the memo-transparency property (Requirement 13 criteria 13 to 16).
14. THE test suite SHALL include tests of the patch cutting order of Requirement 4 criteria 7 to 10: with a Test_File patch and a non-Test_File patch over the budget, only the non-Test_File patch is cut and the Test_File patch is equal to its input; the last non-Test_File in file order is cut first; a Test_File patch is cut only after all other patches are empty; every cut is in the Assessment_Record with the right `isTest`; and a state that stays over the budget with all patches empty raises `StageError('assessment', cause)`. A fast-check property SHALL check that the patch of a Test_File is unchanged whenever the cutting of non-Test_File patches alone brings the state within the budget.
15. THE test suite SHALL include a test that `assess` with an Effective_Config of `{}`, and with a config that holds only some `assessment` values, gives the same result as the config with the missing values filled from `ConfigDefaults`, and a test that calls `resolveAssessmentSettings(config, defaults)` with a `defaults` object that lacks a value which `config` also lacks and checks that it raises `StageError('assessment', cause)` (Requirement 10 criteria 7 and 8). The test SHALL NOT try to remove a value from `ConfigDefaults` itself.
16. THE test suite SHALL include a test of the Change_Subject choice with a description whose first line is blank (Requirement 3 criteria 2 and 6), and a test that `isTestFile` and the ranking of `budget.ts` give the same answer for the same path.
17. THE test suite SHALL include a test that loads the real files in `fixtures/eval/` and checks Requirement 11 criterion 11 and that no fixture holds `isBehavior` for a candidate whose provider is `cli`.

### Requirement 17: Issue acceptance, traceability and closing the issue

**User Story:** As the project owner, I want each acceptance criterion of issue #7 traced to requirements and verified, and the issue closed by the merged pull request, so that the issue board reflects real state.

#### Acceptance Criteria

1. THE Issue_Checklist SHALL be traced to these requirements, so that each item of the issue is covered by at least one requirement:

   | Issue #7 item | Requirements |
   | --- | --- |
   | `claim.is_behavior` per candidate | 1, 2.1, 2.2, 2.3 |
   | claim threshold | 2.1, 2.2, 2.9 |
   | `not_identified` status | 2.5 to 2.8, 3 |
   | `assess.runtime_observable` | 4, 5.1 |
   | `assess.checks_adequate` | 4, 5.2 |
   | `assess.surface` | 4, 5.3, 5.4 |
   | `assess.*` request carries the test files of the diff (design section 4) | 4.5, 4.7 to 4.10 |
   | Decision combination in code (design section 4) | 6 |
   | Uncertainty band and `on-uncertain` policy | 6.3, 6.5, 7 |
   | `decidedBy` | 7 |
   | 15 to 20 labelled fixtures in `fixtures/eval/` | 11, 12 |
   | `ce eval` reporting agreement per question | 13, 14.1 to 14.14 |
   | Done when: `ce eval` runs against live Jev and agreement is recorded in the journal | 15, 14.15 to 14.19 (loading the key from `.env`), 12.9 to 12.11 and 13.13 to 13.16 (no Git, no repeated request) |
   | Refs R4 | 1, 2 |
   | Refs R5 (R5.1 to R5.6) | 3, 4, 5, 6, 7, 8, 10.3, 10.7 to 10.9 |
   | Refs R12 (R12.1, R12.2) | 11 to 14 (R12.1), 16 (R12.2, including 16.11 to 16.17) |

2. WHEN all implementation tasks are complete, THE implementer SHALL verify each item of the Issue_Checklist against the delivered code and SHALL record the evidence for each: a passing test name, a file path or a command output. The four checklist items are the claim identification, the three assessment questions, the decision combination with band, policy and `decidedBy`, and the fixtures with `ce eval`.
3. WHEN all implementation tasks are complete, THE implementer SHALL verify the "Done when" line of issue #7 under Requirement 15.
4. WHEN all implementation tasks are complete (`all_tasks_complete`) and the verification of criteria 2 and 3 passes, THE implementer SHALL open a pull request against `main` of rfxlamia/ce.
5. THE pull request body SHALL contain the line `Closes #7` so that GitHub closes issue #7 when the pull request is merged.
6. THE pull request body SHALL list the items of the Issue_Checklist, each with its recorded evidence, and SHALL link to the Eval_Journal_File.
7. THE implementer SHALL NOT merge the pull request and SHALL NOT close issue #7 by hand.
8. IF any verification in criteria 2 or 3 fails, THEN THE implementer SHALL fix the failure before opening the pull request.
9. IF Requirement 15 criterion 5 applies, THEN THE pull request body SHALL state that the "Done when" line is not met and why, and the implementer SHALL NOT open the pull request as complete.
10. THE pull request body SHALL NOT contain any API key or other secret value.
11. THE completion of all implementation tasks (`all_tasks_complete`) SHALL be a hard gate for opening the pull request. IF any implementation task is not complete, THEN THE implementer SHALL NOT open the pull request, even when every other step has passed.
