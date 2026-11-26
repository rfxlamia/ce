# Design Document

Implements [`requirements.md`](./requirements.md) of this spec (issue #7). Normative source: [`SPEC.md`](../../../SPEC.md); derived journal: [`docs/journal/v0.0/design.md`](../../../docs/journal/v0.0/design.md) section 3 (data model) and section 4 (question catalog, decision combination). `SPEC.md` wins on any conflict.

## Overview

This feature adds the second pipeline stage, Claims and Assessment, plus the labelled evaluation harness and the `ce eval` command. It turns a `ChangeContext` (already produced by `resolveContext`, the ce-context-resolver spec) into `Claim[]` and one `Assessment`, by asking Jev four small questions per Subject through the existing `JevGateway`, and by combining the probabilities with the five `assessment.*` settings in deterministic code. It never decides an Outcome.

Two code areas are added:

- `packages/ce/src/assessment/`: `types.ts`, `claims.ts`, `combine.ts`, `assess.ts`, `index.ts`.
- `packages/ce/src/eval/`: `fixture.ts`, `providers.ts`, `memo.ts`, `agreement.ts`, `run.ts`, `report.ts`, `command.ts`, `index.ts`.

Three small additions touch existing files, each named in the requirements as a decision:

- `packages/ce/src/jev/catalog.ts` gains two request-builder functions (`buildClassificationRequest`, `buildAssessmentRequest`), next to the existing `finalImageQuestions`. No question text changes (Decision D2).
- `packages/ce/src/context/budget.ts` exports its existing `rankOf`-internal test predicate as `isTestFile`, re-exported from `packages/ce/src/context/index.ts` (Decision D21). `rankOf` is changed to call the exported function instead of duplicating the check; its ranking output is unchanged.
- `packages/ce/src/cli.ts` gains `.env` loading (Decision D14) and the `eval` command (Decision D15).

### Verified facts used by this design

Read directly from the current source before writing the interfaces below (duplicates `requirements.md` "Facts verified in the code" for convenience; that section is authoritative for wording):

- `JevGateway` is `{ ask(request: Jev_Request, options?: AskOptions): Promise<Jev_Response> }` (`jev/gateway.ts:64`). `Jev_Request` is `{ stage: Stage; state: string | TextWithAssets; questions: Record<string, BuiltCatalogQuestion> }` (`jev/types.ts`). `Jev_Response.answers` is `Record<string, NoulResponse | ChoiceResponse | ScoreResponse | BoxResponse>`.
- A `CatalogEntry.built()` returns a `BuiltCatalogQuestion` carrying `question`; a request is built by hand as a plain object literal (see `finalImageQuestions` in `jev/catalog.ts:147`), not through a separate "request" helper. The classification and assessment request builders follow the same pattern.
- `FakeJevGateway` (`jev/fake.ts`) matches a `Recording` by `(idVersion, stateHash, question name)` via `stateHash(request.state)` (`jev/hash.ts`). A request with no matching Recording throws `FakeRecordingMissingError`, never a default answer.
- `context/types.ts` already defines `ChangeContext`, `ChangedFile`, `ClaimCandidate`, `Provenance`, `TruncationReason`. `ChangeContext.candidates` is `{ id: string; text: string; provenance: Provenance }[]`, already produced by `extractCandidates` (`context/candidates.ts`) before this spec runs. `ChangeContext.change.claims` is `{ text: string; provenance: Provenance }[]` — the `--claim` texts, with `provenance.provider === 'cli'` and `location: '--claim[<n>]'`.
- Candidates from `--claim` are **not** a separate provenance marker on `ChangeContext.candidates` entries by inspection alone: `extractCandidates` (per the ce-context-resolver spec) places `--claim` texts first among `candidates`, each carrying `provenance.provider === 'cli'`. This spec's Claim_Identifier therefore partitions `candidates` by `provenance.provider === 'cli'` and does not re-derive membership from `change.claims`.
- `context/budget.ts` exports `STATE_BUDGET_TOKENS` (32 000), `CONTEXT_BUDGET_TOKENS` (24 000), `REQUEST_HEADROOM_TOKENS` (8 000), `estimateTokens`, `estimateTokensOf`, `truncateToTokens`, `fitCheckResults`. All are already re-exported from `context/index.ts`. `rankOf` (private) classifies a `ChangedFile` into `RANK_USER_FACING | RANK_TEST | RANK_OTHER | RANK_LOW`; the `RANK_TEST` branch tests `TEST_DIRS.has(dir)` or `base.includes('.test.')` or `base.includes('.spec.')` — this is the predicate this spec exports as `isTestFile`.
- `config/schema.ts` already defines `assessment: { thresholds: { claim, observable, adequate }, 'uncertainty-band', 'on-uncertain' }`, all optional (`EffectiveConfig = z.infer<typeof ConfigSchema>`). `config/defaults.ts` (`ConfigDefaults.assessment`) supplies `{ thresholds: { claim: 0.6, observable: 0.6, adequate: 0.7 }, 'uncertainty-band': 0.1, 'on-uncertain': 'evidence' }`.
- `config/credentials.ts` exports `requireJevCredentials(loaded, env)`; `jev/gateway.ts` exports `createJevGateway(loaded, env, options)` returning `{ ok: true, gateway } | { ok: false, errors }`; `config/errors.ts` exports `reportConfigFailure(failure, secrets, stderr): 1` and `config/secrets.ts` exports `collectSecretValues(env)`.
- `config/load.ts` exports `loadConfig(options: { cwd, flags, env }): LoadedConfig | LoadFailure`.
- `errors.ts` exports `StageError` with `Stage = 'context' | 'assessment' | 'runtime' | 'evidence'`.
- `cli.ts` today has no argument parser; it only matches `run | help | --help | -h | --version | -v` and a default branch (F1). `index.ts` exports `VERSION` and the stub `run()`.
- `context/providers/cli-args.ts` (`resolveCliArgs`), `context/providers/github-event.ts` (`resolveGithubEvent`), `context/providers/junit.ts` (`resolveJunit`), and `context/providers/git.ts` (`resolveGit`) are the four Fixture_Provider shapes the Eval harness must build fixture-backed replacements for, matching their existing input/output interfaces exactly (shown in Components and Interfaces).
- `context/resolve.ts` (`resolveContext`) accepts `providers?: { cli?, github?, git?, junit? }` and `exec?: (args, options) => GitExecResult` as test hooks (`ResolveContextOptions`), and already swallows every exception from `exec` inside its internal `commitExists` (F4) — confirmed at `resolveContextUnsafe`'s `commitExists` closure, which wraps the `exec` call in `try { ... } catch { return false; }`.
- `jev/architecture.test.ts` is the existing architecture-test pattern (source-scanning of import specifiers and disallowed call patterns) that Requirement 9 criterion 9 asks this spec to replicate for `assessment/`.
- `@typesafe-ai/sdk` answer shapes read by `jev/gateway.ts`: a Noul answer is read through `probability(raw.noul)` giving `{ type: 'noul', probability: number }` surfaced to callers as `NoulResponse` (`{ type: 'noul', noul: number }` is the shape used in `FakeJevGateway` recordings and `jev/fake.test.ts`); a Choice answer with fixed labels (`labelsFixed: true`, which `assess.surface` sets) is read through `probabilityMap(raw.probabilities, (key) => key)`, giving `ChoiceResponse` with `{ type: 'choice', choice: string, probabilities: Record<string, number>, confidence: number }`.

## Architecture

```mermaid
flowchart TD
  CC[ChangeContext] --> CI[Claim_Identifier\nassessment/claims.ts]
  CI -- non-cli candidate --> RB1[buildClassificationRequest\njev/catalog.ts]
  RB1 --> GW[(JevGateway)]
  GW --> CI
  CI --> CL[Claim[]]
  CL --> AS[Assessor\nassessment/assess.ts]
  CC --> AS
  AS -- Subject = Claim or Change_Subject --> RB2[buildAssessmentRequest\njev/catalog.ts]
  RB2 --> GW
  GW --> AS
  AS --> CB[Combiner\nassessment/combine.ts]
  CB --> ASM[Assessment]
  CFG[EffectiveConfig.assessment] --> RS[resolveAssessmentSettings]
  RS --> CI
  RS --> AS
  RS --> CB
  subgraph eval [eval/, offline harness]
    FX[fixtures/eval/*.json] --> FXL[loadFixtures\neval/fixture.ts]
    FXL --> FXP[Fixture_Providers\neval/providers.ts]
    FXP --> RC[resolveContext]
    RC --> EV[Eval_Runner\neval/run.ts]
    EV --> MG[Eval_Memo_Gateway\neval/memo.ts]
    MG --> GW
    EV --> AS
    EV --> AG[agreement.ts]
    AG --> ER[Eval_Result]
  end
  ER --> EC[runEvalCommand\neval/command.ts]
  EC --> CLI[cli.ts]
```

Both `CI` (Claim_Identifier) and `AS` (Assessor) call the same `JevGateway` instance and the same request builders whether invoked from `assess()` in production or from the Eval_Runner — the only difference is that the Eval_Runner wraps the gateway in `Eval_Memo_Gateway` first (Decision D17) and supplies a fixture-backed `ChangeContext` instead of a Git/GitHub-backed one (Decision D16). Neither `assess()` nor the Request_Builder knows the memo exists.

### Module placement (steering compliance)

- `jev/catalog.ts` is the only file that contains question text or calls `noul`, `choice`, `score`, `box`, `image`, `withAssets` (steering "tech", design rule; `jev/architecture.test.ts` rule (b)). The two new request builders live there and call the four existing `CATALOG` entries by reference; they add field labels (`candidate:`, `claim:`, `files:`, `checks:`) but no question text.
- `outcome/resolve.ts` does not exist yet (issue #8) and is not created by this spec. `assessment/` and `eval/` never import it and never return the strings `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` as values (Requirement 9 criterion 5, Requirement 13 criterion 12). A new architecture test (`assessment/architecture.test.ts`, modelled on `jev/architecture.test.ts`) enforces this plus "only `jev/` imports `@typesafe-ai/sdk`" (already enforced) and "nothing under `assessment/` or `eval/` imports `jev/transport-sdk.ts` or `jev/transport-json.ts`".
- Tests use `FakeJevGateway` from `jev/fake.ts` and need no API key (steering "Test policy"). The only code path that talks to a live Jev endpoint is the Live_Run of Requirement 15, run once by the implementer, not by CI.

## Components and Interfaces

### `assessment/types.ts`

```ts
import type { Provenance } from '../context/types.js';

export type Surface =
  | 'browser_ui'
  | 'http_api'
  | 'cli'
  | 'backend_internal'
  | 'native_app'
  | 'non_runtime';

/** A Claim_Candidate that became a Claim (declared or classified). */
export interface Claim {
  id: string;
  text: string;
  /** null for a Declared_Claim (E1): no classifier probability exists. */
  probability: number | null;
  declared: boolean;
  provenance: Provenance;
}

/** One Subject the assessment questions were asked about: a Claim, or the Change_Subject. */
export interface AssessedSubject {
  id: string; // claim id, or 'change'
  kind: 'claim' | 'change';
  text: string;
  provenance: Provenance;
}

export interface PerClaimAssessment {
  claimId: string; // Claim id, or 'change'
  runtimeObservable: number;
  checksAdequate: number;
  surface: Surface;
  surfaceConfidence: number;
  needed: boolean;
  uncertain: boolean;
}

export type Cut = {
  /** File path, or a pseudo-path: `check:<n>`, `commit:<sha>`, `<title>`, `<description>`, `claim:<n>`. */
  file: string;
  reason: 'truncated' | 'dropped' | 'check-cap';
  isTest: boolean;
};

export interface AssessmentRecord {
  /** One entry per Jev question asked by this stage. */
  questions: {
    idVersion: string; // `${id}@${version}`
    subjectId: string; // candidate id, or Subject id
    probability?: number; // Noul
    probabilities?: Record<string, number>; // Choice
  }[];
  /** One entry per classified Claim_Candidate (not Declared_Claims; Decision D18). */
  candidates: { candidateId: string; probability: number; becameClaim: boolean }[];
  modelIds: string[]; // distinct Returned_Model_Ids
  settings: AssessmentSettings; // effective, resolved values
  cuts: Cut[];
  /** Present only when decidedBy === 'policy' (Requirement 7 criterion 4). */
  policyDecision?: {
    policy: 'evidence' | 'skip';
    inBand: { subjectId: string; probability: 'runtimeObservable' | 'checksAdequate' }[];
  };
}

export interface Assessment {
  claimStatus: 'identified' | 'not_identified';
  subjects: AssessedSubject[];
  perClaim: PerClaimAssessment[];
  required: boolean;
  decidedBy: 'classifier' | 'policy';
  surface: Surface;
  record: AssessmentRecord;
}

export interface AssessmentSettings {
  claimThreshold: number;
  observableThreshold: number;
  adequateThreshold: number;
  uncertaintyBand: number;
  onUncertain: 'evidence' | 'skip';
}
```

Every field is a plain JSON-serializable value (Requirement 8 criterion 7): no `Date`, `Map`, `Set`, function, or `undefined`-only optional beyond a `?:` property.

### `assessment/combine.ts` — the Combiner

Pure function, matches design.md section 4's "Decision combination" table exactly, using the resolved `AssessmentSettings` instead of raw config:

```ts
export interface SubjectProbabilities {
  claimId: string;
  runtimeObservable: number; // [0,1]
  checksAdequate: number; // [0,1]
  surface: Surface;
  surfaceConfidence: number; // [0,1]
}

export interface CombineResult {
  perClaim: PerClaimAssessment[];
  required: boolean;
  decidedBy: 'classifier' | 'policy';
  surface: Surface; // dominant surface
  policyDecision?: Assessment['policyDecision'];
}

export function combine(
  subjects: readonly SubjectProbabilities[],
  settings: AssessmentSettings,
): CombineResult;
```

`combine` never calls `JevGateway`, never reads `process.env` or the clock (Requirement 6 criterion 1), and is the only function that computes `needed`, `uncertain`, `required`, `decidedBy`, and the dominant surface (Decision D6, D7). Given zero subjects, `required` is `false` and `decidedBy` is `classifier` (no `needed`, no `uncertain` — the "no Subject" case of criterion 6), and `surface` falls back to `'non_runtime'` (there being no subject to drive a dominant surface; this is an explicit decision this design adds because D7 does not define the zero-subject case, and `combine` must still be total per Requirement 6 criterion 9 — the empty-context path never reaches `combine` in production because Requirement 3 criterion 4 raises `StageError` first, so this fallback is exercised only by the totality property test, not by a real run).

Dominant surface tie-break (Decision D7): among the driving subjects (those with `needed` or `uncertain` true; all subjects if none drive), pick the highest `surfaceConfidence`; ties go to the subject earliest in `subjects` order (which `assess.ts` builds in Claim/Change_Subject order per Requirement 2 criterion 4); a tie in `assess.surface` itself (Requirement 5 criterion 4, resolved before `combine` is called, inside `assess.ts`'s answer reading) goes to the label earliest in `SURFACE_LABELS`.

### `assessment/claims.ts` — the Claim_Identifier

```ts
export interface ClassifyResult {
  claims: Claim[];
  /** Per-candidate record for Requirement 8 criterion 2, in candidate order. */
  classifications: { candidateId: string; probability: number; becameClaim: boolean }[];
  modelIds: string[];
  /** Jev question log entries for Requirement 8 criterion 1. */
  questionsAsked: AssessmentRecord['questions'];
}

export async function identifyClaims(
  context: ChangeContext,
  settings: AssessmentSettings,
  gateway: JevGateway,
): Promise<ClassifyResult>;
```

Behaviour (Requirement 1, 2):

1. Declared_Claims: every candidate with `provenance.provider === 'cli'` becomes a `Claim` with `probability: null`, `declared: true`, no Classification_Request sent (Requirement 2 criterion 3).
2. Every other candidate gets one Classification_Request, built by `buildClassificationRequest(context, candidate)` (see `jev/catalog.ts` below), sent with `stage: 'assessment'`.
3. `p = answer.noul` of `claim.is_behavior@1`. `p >= settings.claimThreshold` creates a `Claim` with `declared: false`; otherwise no `Claim` is created, and the candidate id and `p` are still recorded in `classifications`.
4. Returned `claims` preserve the order of `context.candidates` (Declared_Claims interleaved in their original candidate position — Requirement 2 criterion 4 says "in the order of the Claim_Candidates", which is `context.candidates` order, not "declared first then classified").
5. A malformed answer (Decision D3, Requirement 9 criterion 3) raises `StageError('assessment', cause)` immediately; no partial `ClassifyResult` is returned.

### `assessment/assess.ts` — the Assessor and public entry point

```ts
export interface AssessOptions {
  /** Test seam: lets a test pass a different defaults object to resolveAssessmentSettings. Production code omits it. */
  defaults?: EffectiveConfig;
}

export async function assess(
  context: ChangeContext,
  config: EffectiveConfig,
  gateway: JevGateway,
  options?: AssessOptions,
): Promise<{ claims: Claim[]; assessment: Assessment }>;

export function resolveAssessmentSettings(
  config: EffectiveConfig,
  defaults?: EffectiveConfig, // default: ConfigDefaults
): AssessmentSettings;
```

`assess()`:

1. Calls `resolveAssessmentSettings(config)` (Decision D20; `assess` never passes a second argument in production, so it always uses `ConfigDefaults` — the `options.defaults` seam exists only so a test can call `resolveAssessmentSettings` directly with an incomplete `defaults`, not so `assess()` itself can bypass `ConfigDefaults`).
2. Calls `identifyClaims(context, settings, gateway)`.
3. Builds the Subject list (Requirement 3): if `claims.length > 0`, one Subject per Claim, `claimStatus = 'identified'`; otherwise one Change_Subject (`id: 'change'`, `kind: 'change'`), chosen by `selectChangeSubject(context)` (Requirement 3 criterion 2, text-source priority: title → description → first commit message, first non-blank line, trimmed). If no source has a non-blank line, raises `StageError('assessment', cause)` (Decision D8) before any Assessment_Request is built.
4. For each Subject, builds one Assessment_Request with `buildAssessmentRequest(context, subject)`, sends it with `stage: 'assessment'`, and reads `runtimeObservable`, `checksAdequate` (Noul), and `surface`/`surfaceConfidence` (Choice argmax over `SURFACE_LABELS`, Requirement 5 criteria 3–4).
5. Calls `combine(subjects, settings)`.
6. Assembles `AssessmentRecord` from the Classification questions (`ClassifyResult.questionsAsked`), the Assessment questions just asked, the distinct `modelIds` of both, `settings`, the `cuts` the two Request_Builders recorded, and `CombineResult.policyDecision`.
7. Returns `{ claims, assessment }`.

Any error not already a `StageError` is wrapped: `StageError('assessment', cause)` (Requirement 9 criterion 2). `assess()` reads `process.env` nowhere and knows nothing about which `JevGateway` implementation it received (Requirement 10 criteria 4–5).

### `jev/catalog.ts` additions

Two request builders, placed next to `finalImageQuestions`, following its existing pattern exactly (plain object literal, no new abstraction):

```ts
/** State field labels for the Classification_Request. Not question text (D2). */
export function buildClassificationRequest(
  context: ChangeContext,
  candidate: { id: string; text: string },
): { request: Jev_Request; cuts: Cut[] };

/** State field labels for the Assessment_Request. Not question text (D2). */
export function buildAssessmentRequest(
  context: ChangeContext,
  subject: { id: string; text: string },
): { request: Jev_Request; cuts: Cut[] };
```

`buildClassificationRequest`:

- `state` is built from fixed field labels `candidate:`, `title:`, `files:` (path + status pairs) and the candidate text, in that order, as a plain template string (no image, so `TextWithAssets` is not needed — `state: string`).
- `questions: { is_behavior: CATALOG.claimIsBehavior.built() }`.
- Only the `title:`/`files:` summary is shortened to fit `STATE_BUDGET_TOKENS` (via `truncateToTokens`); the candidate text is never touched (Requirement 1 criterion 4). Returns `cuts: []` when nothing needed shortening, matching the `Cut` shape used by `buildAssessmentRequest` for a uniform `AssessmentRecord.cuts` list (classification-side cuts use the pseudo-path `<title>` or `<files>`, `isTest: false`, since the summary carries no per-file patches).

`buildAssessmentRequest`:

- `state` fields: `claim:` (the Subject text), `files:` (path + status pairs, in `ChangeContext.change.files` order — already ranked by `budget()` upstream), `patches:` (one block per file, path then patch), `checks:` (name + status pairs, after `fitCheckResults(context.checks, REQUEST_HEADROOM_TOKENS)`, Requirement 4 criterion 4).
- `questions: { runtime_observable: CATALOG.assessRuntimeObservable.built(), checks_adequate: CATALOG.assessChecksAdequate.built(), surface: CATALOG.assessSurface.built() }`.
- When the full state exceeds `STATE_BUDGET_TOKENS`, patches are cut one file at a time (Decision D21, Requirement 4 criteria 5–10):
  1. Only among files where `!isTestFile(file.path)`, starting from the **last** such file in `context.change.files` order and moving toward the first, shorten with `truncateToTokens` by exactly the excess still owed, down to an empty patch, recording one `Cut` per touched file (`reason: 'truncated'` while non-empty, `'dropped'` once emptied, `isTest: false`).
  2. Only once every non-Test_File patch is already empty and the state is still over budget, repeat the same last-to-first order over Test_File patches (`isTest: true`).
  3. If the state is still over `STATE_BUDGET_TOKENS` after every patch is empty, throws (caught by `assess.ts` and turned into `StageError('assessment', cause)`, Requirement 4 criterion 9 — the builder itself throws a plain `Error`; wrapping in `StageError` is `assess.ts`'s job, consistent with Requirement 9 criterion 7 forbidding `assessment/` modules other than the wrapper from defining error semantics that leak the stage concept into `jev/`).
- `isTestFile` is imported from `context/index.ts` (Decision D21), never reimplemented.
- No field is added beyond `claim:`, `files:`, `patches:`, `checks:` and their values taken verbatim (after the redaction and budgeting already applied upstream) from `context`/`subject` — this is the no-new-text obligation (Requirement 4 criterion 12).

Both builders are synchronous, read no environment variable, file, or network (Requirement 4 criterion 11), and are exercised by the architecture test's rule (b) (only `catalog.ts` calls `noul`/`choice`/etc. — these two functions call none of those helpers directly; they call `CATALOG.*.built()`, which is already permitted since `built()` is defined in the same file).

### `context/budget.ts` / `context/index.ts` — `isTestFile` export

```ts
// budget.ts
export function isTestFile(path: string): boolean; // extracted from rankOf's RANK_TEST branch, unchanged logic
```

`rankOf` is edited to call `isTestFile(file.path)` instead of inlining the `TEST_DIRS`/`.test.`/`.spec.` check; `TEST_DIRS` stays private. `context/index.ts` re-exports `isTestFile` alongside the other `budget.ts` exports already listed there. No other behaviour of `budget()` or `rankOf` changes — this is a pure extraction, verified by the existing `budget.rank.test.ts` continuing to pass unmodified plus one new assertion that `isTestFile` and `rankOf`'s classification agree (Requirement 16 criterion 16).

### `eval/fixture.ts` — fixture schema and loader

```ts
export interface EvalFixtureFile {
  id: string;
  description: string;
  change: {
    title?: string;
    description?: string;
    commits: { sha: string; message: string }[];
    files: { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; patch: string }[];
    claims?: string[]; // --claim values
  };
  checks: { name: string; status: 'passed' | 'failed' | 'skipped' }[];
  labels: {
    isBehavior: Record<string, boolean>; // keyed by exact candidate text; excludes --claim candidates (D18)
    runtimeObservable: Record<string, boolean>;
    checksAdequate: Record<string, boolean>;
    surface: Record<string, Surface>;
    claimStatus: 'identified' | 'not_identified';
    required: boolean;
  };
}

export const EvalFixtureSchema: z.ZodType<EvalFixtureFile>; // zod schema, Requirement 12 criterion 1

export interface LoadFixturesResult {
  fixtures: { id: string; file: EvalFixtureFile }[];
}
export type LoadFixturesFailure =
  | { ok: false; kind: 'directory'; dir: string }
  | { ok: false; kind: 'schema'; file: string; path: string; value: unknown; expected: string }
  | { ok: false; kind: 'unlabelled-candidate'; fixtureId: string; candidateText: string; missing: string }
  | { ok: false; kind: 'unknown-label'; fixtureId: string; candidateText: string };

export function loadFixtures(dir: string): (LoadFixturesResult & { ok: true }) | LoadFixturesFailure;
```

`loadFixtures` reads `*.json` files in ascending file-name order (Requirement 12 criterion 7), validates each against `EvalFixtureSchema` (criterion 1/3), then — for every fixture — builds its `ChangeContext` (via `eval/providers.ts` + `resolveContext`, see next) to get the real `candidates` list, and cross-checks every candidate against `labels` (criteria 4–5): a non-`cli` candidate missing `isBehavior` is an `unlabelled-candidate` failure; a candidate labelled `isBehavior: true`, or a `cli`-provenance candidate, missing any of the three assessment labels is also `unlabelled-candidate`; a `labels` key naming a text absent from `candidates` is `unknown-label`. No Jev question is asked before this check passes (criteria 3–5).

### `eval/providers.ts` — Fixture_Providers and Stub_Exec

```ts
export function fixtureGitProvider(fixture: EvalFixtureFile): typeof resolveGit;
export function fixtureGithubProvider(fixture: EvalFixtureFile): typeof resolveGithubEvent;
export function fixtureJunitProvider(fixture: EvalFixtureFile): typeof resolveJunit;
// cli provider: the production `resolveCliArgs` is reused unchanged, fed `{ claim: fixture.change.claims }` (Decision D12).

export interface StubExecCall { args: string[] }
export function createStubExec(): {
  exec: (args: string[], options: GitExecOptions) => GitExecResult;
  calls: StubExecCall[];
};
```

- `fixtureGitProvider(fixture)` returns a function matching `resolveGit`'s signature that ignores its `exec`/`cwd` inputs and returns `{ files: <from fixture, status 'used' per changed file>, commits: <from fixture>, head: undefined, truncated: [], status: { name: 'git', status: 'used' } }` — every file and commit's `provenance` is `{ provider: 'git', location: <path or sha> }`, matching `GitProviderResult`'s real shape (Decision D16).
- `fixtureGithubProvider(fixture)` returns a function matching `resolveGithubEvent`'s signature. When `fixture.change.title` or `fixture.change.description` is present, it returns `{ pullRequest: { title, body: description }, provenance: { provider: 'github', location: 'fixture' }, status: { name: 'github', status: 'used' } }` with **no** `baseSha`, `baseRef`, or `headSha` fields (Decision D16, so `commitExists` is never reached via the PR branch); otherwise `{ status: { name: 'github', status: 'unavailable', reason: 'source-absent' } }`.
- `fixtureJunitProvider(fixture)` returns a function matching `resolveJunit`'s signature, returning `{ checks: fixture.checks.map(c => ({ ...c, provenance: { provider: 'junit', location: c.name } })), status: { name: 'junit', status: 'used' } }`.
- `createStubExec()` returns an `exec` that pushes `{ args }` to `calls` and returns `{ error: Object.assign(new Error('git not available in eval'), { code: 'ENOENT' }) }` — an error, never a throw, so `commitExists`'s `try/catch` (F4) cannot hide a call that happened (Decision D16; the Eval_Runner, not the stub, is responsible for checking `calls.length === 0` afterwards, since the stub only records).
- `resolveContext` is called with `{ config, cliOptions: { claim: fixture.change.claims }, env, cwd: '/eval' (unused, no filesystem walk happens because `git`/`github`/`junit` providers are all replaced and the real `junit` provider is never reached), providers: { git: fixtureGitProvider(fixture), github: fixtureGithubProvider(fixture), junit: fixtureJunitProvider(fixture) }, exec: stubExec.exec }` (Requirement 12 criterion 2, 9).

### `eval/memo.ts` — Eval_Memo_Gateway

```ts
export interface MemoStats {
  requests: number; // sent to the underlying gateway
  memoHits: number; // answered from the memo
}

export class EvalMemoGateway implements JevGateway {
  constructor(underlying: JevGateway);
  ask(request: Jev_Request, options?: AskOptions): Promise<Jev_Response>;
  readonly stats: MemoStats;
}
```

Key: `JSON.stringify([request.stage, [...Object.entries(request.questions)].map(([name, q]) => `${name}:${q.idVersion}`).sort(), stateHash(request.state)])` (Decision D17; `stateHash` imported from `jev/hash.ts`, the same function `FakeJevGateway` already uses, so key collisions match the Fake_Gateway's own notion of "the same request"). A second `ask()` with the same key while the first is still in flight awaits the same in-flight promise (shared between concurrent identical requests, Requirement 13 criterion 14); a request whose promise rejects is removed from the memo so it is not "stored" (Requirement 13 criterion 14) and the next identical request is sent again. `EvalMemoGateway` lives only in `eval/`, is never imported by `assessment/` or `jev/`, and implements `JevGateway` so `assess()` cannot distinguish it from any other gateway (Requirement 13 criterion 14).

### `eval/agreement.ts` — row and aggregate computation

```ts
export interface AgreementRow {
  question: string; // 'claim.is_behavior' | 'assess.runtime_observable' | 'assess.checks_adequate' | 'assess.surface' | 'assessment.required' | 'assessment.claimStatus'
  samples: number;
  agreeing: number;
  agreement: number | null; // null iff samples === 0
}

export interface Disagreement {
  fixtureId: string;
  question: string;
  subject: string; // candidate text, or 'change'
  predicted: number | string | boolean;
  label: number | string | boolean;
}

/** Generic comparator-driven row builder, reused for every question kind (P19). */
export function buildRow<T>(
  question: string,
  samples: readonly { fixtureId: string; subject: string; predicted: T; label: T }[],
  equal: (predicted: T, label: T) => boolean,
): { row: AgreementRow; disagreements: Disagreement[] };
```

One `buildRow` call per question in `eval/run.ts`, with the comparator from Decision D10: `p >= threshold` vs. boolean label for the three Noul-backed questions, argmax-label string equality for `assess.surface`, and direct boolean/string equality for the two aggregate rows (`assessment.required`, `assessment.claimStatus`) built from `assess()`'s own output (Requirement 13 criterion 9 — `eval/run.ts` reads `Assessment.required`/`claimStatus` directly, it does not recompute them).

### `eval/run.ts` — Eval_Runner

```ts
export interface EvalRunnerDeps {
  gateway: JevGateway; // wrapped in EvalMemoGateway by the caller, not here (keeps run.ts gateway-agnostic)
  config: EffectiveConfig;
  env: Record<string, string | undefined>;
}

export interface EvalResult {
  rows: AgreementRow[];
  disagreements: Disagreement[];
  modelIds: string[];
  fixtureCount: number;
  settings: AssessmentSettings;
  requests: number;
  memoHits: number;
}

export async function runEval(
  fixturesDir: string,
  deps: EvalRunnerDeps,
): Promise<{ ok: true; result: EvalResult } | LoadFixturesFailure | { ok: false; stageError: StageError }>;
```

Steps, matching Requirement 12 and 13:

1. `loadFixtures(fixturesDir)`; return its failure unchanged on error (no Jev question asked).
2. Wrap `deps.gateway` in one `EvalMemoGateway` for the whole run (Decision D17); every subsequent call goes through it.
3. For each fixture, in ascending id order: build `ChangeContext` via `eval/providers.ts` + `resolveContext`; if the Stub_Exec recorded any call, return `{ ok: false, stageError: new StageError('context', cause) }` naming the fixture id (Requirement 12 criterion 10) without asking any Jev question for that fixture.
4. Ask `claim.is_behavior` for every non-`cli` candidate (reusing `buildClassificationRequest` directly — not `identifyClaims`, so the eval can ask every candidate regardless of whether a Claim would be created, matching Requirement 13 criterion 2 exactly), collecting samples for the `claim.is_behavior` row.
5. Ask the three assessment questions (reusing `buildAssessmentRequest` directly) for every candidate labelled `isBehavior: true` and every `cli`-provenance candidate (Decision D9, Requirement 13 criterion 3), collecting samples for the three `assess.*` rows.
6. Call `assess(context, deps.config, memoGateway)` once per fixture (full path, Requirement 13 criterion 5) and compare its `required`/`claimStatus` against `fixture.labels.required`/`claimStatus` for the two aggregate rows.
7. Build all six `AgreementRow`s via `buildRow`, collect `disagreements`, collect distinct `modelIds` from every `Jev_Response.model` seen, and read `memoGateway.stats` for `requests`/`memoHits`.

Step 4/5 share request-building code with `assess()` by calling the same `jev/catalog.ts` builders, never duplicating the decision logic the Combiner owns — the only new orchestration in `eval/run.ts` is "which candidates to ask", which `assessment/` modules do not need to know about (Requirement 13 criterion 14's "not known to `assess()`" extends naturally to this orchestration: `assess()` itself is called unmodified in step 6).

### `eval/command.ts` — `runEvalCommand`

```ts
export interface EvalDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  createGateway: typeof createJevGateway;
  now: () => Date;
}

export async function runEvalCommand(argv: string[], deps: EvalDeps): Promise<number>;
```

Order (Requirement 14 criterion 1), stopping at the first failure:

1. Parse `argv` for `--fixtures <dir>`/`--fixtures=<dir>` (default `fixtures/eval` relative to `deps.cwd`) and `--config <path>`/`--config=<path>`; an unknown flag, a flag given twice, or a flag with no value prints usage and returns `1` without calling `loadConfig` (criterion 14).
2. `loadConfig({ cwd: deps.cwd, flags: { config: <path or undefined> }, env: deps.env })`; on failure, `reportConfigFailure(failure, collectSecretValues(deps.env), deps.stderr)`, return `1`.
3. `requireJevCredentials(loaded, deps.env)`; on failure, same reporting, return `1`, `deps.createGateway` not called.
4. `deps.createGateway(loaded, deps.env, { callLog: createJsonlCallLog(join(outputDir, 'jev-calls.jsonl')) })`; on `{ ok: false, errors }`, same reporting, return `1`.
5. `runEval(fixturesDir, { gateway, config: loaded.config, env: deps.env })`; a `LoadFixturesFailure` prints the Requirement 12 report and returns `1`; a `{ ok: false, stageError }` prints the stage name and cause constructor name and returns `1` (criterion 7).
6. On success, writes `eval.json` (the `EvalResult`) and the already-written `jev-calls.jsonl` under `<output.dir>/eval-<timestamp>/` (`deps.now()` for the timestamp), prints the row table and the disagreement list to `deps.stdout`, prints the output directory path, and returns `0` regardless of the agreement numbers (Decision D11, criterion 8).

`runEvalCommand` reads the environment, working directory, clock, and streams only through `deps` and never calls `process.exit` (criterion 13). No secret value — the API key, an `Authorization` header, or any request state text — is ever written to `eval.json`, `jev-calls.jsonl` (already guaranteed by `createJsonlCallLog`'s schema, which holds no state text), or printed (criterion 9).

### `cli.ts` changes

```ts
// New, before dispatching 'run' or 'eval':
async function loadEnvFileIfPresent(cwd: string): Promise<void> // calls process.loadEnvFile(join(cwd, '.env')) iff existsSync; EISDIR/EACCES etc. print and exit 1 before the command runs (Decision D14)
```

`cli.ts`'s `switch` gains one case, `'eval'`, calling `runEvalCommand(rest, { env: process.env, cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr, createGateway: createJevGateway, now: () => new Date() })`. `help`/`--help`/`-h`/`--version`/`-v` are checked **before** `loadEnvFileIfPresent` is called, so they never load `.env` (criterion 18). `.env` is loaded at most once per process, only for `run` and `eval`, and only `cli.ts` calls `process.loadEnvFile` (grep-enforced by the new architecture test, criterion 18 — "No file under `packages/ce/src/` other than `cli.ts` SHALL load an Env_File").

### `assessment/index.ts`

```ts
export { assess, resolveAssessmentSettings } from './assess.js';
export { combine } from './combine.js';
export type {
  Assessment,
  AssessmentRecord,
  AssessmentSettings,
  AssessedSubject,
  Claim,
  Cut,
  PerClaimAssessment,
  Surface,
} from './types.js';
```

### `eval/index.ts`

```ts
export { loadFixtures } from './fixture.js';
export { EvalMemoGateway } from './memo.js';
export { runEval } from './run.js';
export { runEvalCommand } from './command.js';
export type { EvalFixtureFile, EvalResult, AgreementRow, Disagreement } from './fixture.js' /* and run.js, agreement.ts as applicable */;
```

## Data Models

The `Claim`, `Assessment`, `AssessmentRecord`, `AssessedSubject`, `PerClaimAssessment`, `Surface`, `Cut` types above extend `docs/journal/v0.0/design.md` section 3 exactly as `requirements.md`'s "Data model" section specifies (E1–E4); that section is the normative shape and is not repeated here beyond the TypeScript already shown in Components and Interfaces. `run.json`'s `claims`/`assessment` fields (future `evidence/bundle.ts`, issue #11) embed these types unchanged — this spec supplies the objects, not the writer.

`EvalFixtureFile` and `EvalResult`/`AgreementRow`/`Disagreement` are new data models, local to `eval/`, with no journal precedent; their shapes are fixed by Requirements 11–13 and shown above.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The prework pass classified every acceptance criterion of Requirements 1–16 and consolidated overlapping criteria into one property each, per the reflection step (criteria that test the same formula or the same invariant from different angles share one property; criteria naming genuinely distinct claims — e.g. totality vs. formula-correctness, decidedBy-iff vs. policy-irrelevance — keep separate properties even though they sit in the same requirement).

### Property 1: Classification request cardinality and exclusion

*For any* `ChangeContext`, the set of candidates for which `identifyClaims` builds and sends a Classification_Request equals exactly the candidates whose `provenance.provider !== 'cli'`; every `cli`-provenance candidate becomes a Declared_Claim with `probability: null` and no Classification_Request is built for it; when no non-`cli` candidate exists, no Classification_Request is built at all.

**Validates: Requirements 1.1, 1.8, 2.3**

### Property 2: Classification_Request state composition (no-new-text)

*For all* `ChangeContext`s and candidates, the built Classification_Request holds exactly one question (`claim.is_behavior@1`); its state contains the candidate text verbatim and unshortened; and every other substring of the state (outside the Request_Builder's own fixed field labels) is a substring of the `ChangeContext`'s title or changed-file paths/statuses — nothing is added that did not come from the context.

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 3: Claim identity and order (extraction property)

*For all* `ChangeContext`s and any resulting `Claim[]`, for every Claim, `claim.text` equals the `text` of the `ClaimCandidate` with the same `id`; and the returned `Claim[]` is in the same relative order as `ChangeContext.candidates` filtered to the candidates that became Claims.

**Validates: Requirements 1.7, 2.4**

### Property 4: Claim threshold monotonicity

*For all* lists of `(candidateId, probability)` pairs and any two thresholds `t1 <= t2`, the set of Claims created from classified (non-declared) candidates at threshold `t2` is a subset of the set created at threshold `t1`.

**Validates: Requirements 2.1, 2.2, 2.9**

### Property 5: claimStatus totality

*For all* `Claim[]` produced by the Claim_Identifier, the Assessor sets `claimStatus` to `'identified'` if and only if the list is non-empty, and when `claimStatus` is `'not_identified'`, the Assessment carries no claim-shaped text (only the Change_Subject, whose `kind` is always `'change'`, never `'claim'`).

**Validates: Requirements 2.5, 2.6, 2.7, 2.8**

### Property 6: Change_Subject selection priority

*For all* combinations of present/absent/blank `title`, `description`, and `commits[].message` on a `ChangeContext` with `claimStatus = 'not_identified'`, the chosen Change_Subject text equals the first non-blank line (trimmed) of the first of `{title, description, first commit message}` that has one, with the matching `provenance` recorded; when every source has no non-blank line, `assess()` raises `StageError('assessment', cause)` instead of selecting any text; and when `claimStatus = 'identified'`, no Change_Subject is created at all.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

### Property 7: Assessment_Request state composition (no-new-text)

*For all* `ChangeContext`s and Subjects, the built Assessment_Request holds exactly three questions (`assess.runtime_observable@1`, `assess.checks_adequate@1`, `assess.surface@1`); its state contains the Subject text verbatim; and every other substring of the state (outside fixed field labels) is a substring of the context's file list, patches, or Check_Results — nothing is added that did not come from the context or the Subject.

**Validates: Requirements 4.1, 4.2, 4.3, 4.11, 4.12**

### Property 8: Test_File patch-cutting protection

*For all* sets of changed-file patches whose combined state exceeds `STATE_BUDGET_TOKENS`, whenever cutting (truncating/dropping) the patches of files for which `isTestFile(path)` is false alone brings the state within budget, every Test_File's patch is returned unchanged from its input, and the `AssessmentRecord.cuts` list contains one entry per touched file with `isTest` equal to `isTestFile(path)`.

**Validates: Requirements 4.5, 4.6, 4.7, 4.8**

### Property 9: Surface argmax tie-break

*For all* probability distributions over the six `SURFACE_LABELS` (including ties for the maximum), the Assessor selects the label with the highest probability as `surface`, with `surfaceConfidence` equal to that probability; when two or more labels tie for the maximum, the selected label is the one that appears earliest in `SURFACE_LABELS`.

**Validates: Requirements 5.3, 5.4**

### Property 10: Combiner decision formulas

*For all* lists of Subject probabilities and any thresholds/band, `needed(subject)` equals `(runtimeObservable >= observableThreshold) AND (checksAdequate < adequateThreshold)`; `uncertain(subject)` equals `(|runtimeObservable - observableThreshold| <= band) OR (|checksAdequate - adequateThreshold| <= band)` (including the `band = 0` boundary, where `uncertain` is true only on exact equality); and `required` equals `any(needed) OR (any(uncertain) AND onUncertain = 'evidence')`.

**Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.10, 6.11**

### Property 11: Combiner totality and output cardinality

*For all* Subject lists, including the empty list, `combine` returns a `CombineResult` with a boolean `required`, a `decidedBy` in `{'classifier', 'policy'}`, a `surface` in `SURFACE_LABELS`, and exactly one `perClaim`/`PerClaimAssessment` entry per input Subject, never throwing and never returning a partial result.

**Validates: Requirements 5.6, 6.9**

### Property 12: decidedBy iff and policy record

*For all* Subject lists and settings, `decidedBy === 'policy'` if and only if `any(needed)` is false and `any(uncertain)` is true; in every other case `decidedBy === 'classifier'`; and whenever `decidedBy === 'policy'`, the `AssessmentRecord`'s `policyDecision` names the `onUncertain` policy used and lists exactly the subjects/probabilities that were within the uncertainty band.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 13: Policy-irrelevance under classifier decision

*For all* Subject lists and settings for which `decidedBy === 'classifier'`, the value of `required` is the same whether `onUncertain` is `'evidence'` or `'skip'`.

**Validates: Requirements 7.5**

### Property 14: Assessment_Record completeness and no-leak

*For all* assessment runs (given a fixed sequence of Fake_Gateway answers), `AssessmentRecord.questions` contains one entry for every Jev question actually asked (by id@version, subject id, and probability/probabilities); `AssessmentRecord.candidates` contains one entry for every classified candidate with its probability and whether it became a Claim; `AssessmentRecord.modelIds` equals the distinct `Jev_Response.model` values seen; and no field of the record contains the fixed catalog question strings, a provided fake API key value, or any request state text.

**Validates: Requirements 8.1, 8.2, 8.3, 8.6**

### Property 15: Assessment/record JSON round-trip

*For all* generated `Assessment` values (built from the same generators as Property 11/14), `JSON.parse(JSON.stringify(assessment))` deep-equals `assessment`.

**Validates: Requirements 8.7**

### Property 16: Malformed-answer rejection

*For all* generated malformed answers — a `type` that differs from the question's type, a Noul/Choice probability outside `[0, 1]`, or a Choice answer missing one of the six `SURFACE_LABELS` — the Assessment_Engine raises `StageError('assessment', cause)` and returns no partial result.

**Validates: Requirements 9.3**

### Property 17: assess() determinism

*For all* `(ChangeContext, EffectiveConfig, fixed set of Fake_Gateway recordings)` triples, calling `assess()` twice with the same inputs returns deep-equal `{ claims, assessment }` results both times.

**Validates: Requirements 10.6**

### Property 18: resolveAssessmentSettings fallback

*For all* partial `config.assessment` objects and partial `defaults.assessment` objects, `resolveAssessmentSettings(config, defaults)` resolves each of the five settings independently: using `config`'s value when present, else `defaults`'s value when present, and raising `StageError('assessment', cause)` only for a setting absent from both; it never substitutes `0`, `undefined`, or a reason to skip assessment for a value resolved from `defaults` alone.

**Validates: Requirements 10.7, 10.8**

### Property 19: Eval bounds and accounting

*For all* generated lists of `(predicted, label)` pairs across any of the six `AgreementRow` kinds, including the empty list: `0 <= agreeing <= samples`; `agreement` is `null` iff `samples === 0`, else `agreement` is in `[0, 1]` and equals `agreeing / samples`; and the number of `Disagreement` entries attributed to that row equals `samples - agreeing`.

**Validates: Requirements 13.1, 13.2, 13.6, 13.7, 13.10, 13.11**

### Property 20: Eval_Memo_Gateway memo-transparency

*For all* sequences of Jev requests (including repeated requests with identical `(stage, questions, state)`, requests issued concurrently, and requests differing in state, question set, or stage), the `EvalMemoGateway` returns, for each request, the same answer the underlying gateway would have returned directly; the underlying gateway receives exactly one `ask()` call per distinct key, except that a request whose key's in-flight call failed is retried against the underlying gateway on the next identical request; and `requests + memoHits` equals the total number of `ask()` calls made to the `EvalMemoGateway`.

**Validates: Requirements 13.13, 13.14, 13.15, 13.16**

## Error Handling

- Every public entry point of `assessment/` (`identifyClaims`, `assess`, the two Request_Builders when called from `assess.ts`) funnels unexpected errors through `assess()`'s outer `try/catch`, which wraps anything that is not already a `StageError` as `StageError('assessment', cause)`, including a `RateLimitError` the gateway raised after exhausting its own retries (Requirement 9 criteria 1–2). A `StageError` thrown deeper (for example by `resolveContext`, stage `'context'`) passes through unchanged — `assess()` never re-wraps a foreign-stage `StageError`.
- `combine()` itself never throws for any well-formed `SubjectProbabilities[]` input (Property 11); the only thrown errors below `assess()` come from the two Request_Builders (budget exhausted, Requirement 4 criterion 9) and from answer reading (malformed answer, Requirement 9 criterion 3), both plain `Error`/`RangeError` instances that `assess()` wraps.
- `resolveAssessmentSettings` raises a plain `Error` when a setting is absent from both `config` and `defaults`; `assess()`'s caller context means this surfaces as `StageError('assessment', cause)` once `assess()`'s try/catch wraps it (Requirement 10 criterion 8). Called directly by a test, `resolveAssessmentSettings` is documented to throw unwrapped, and the test imports `StageError` itself only if it calls it through `assess()`.
- `eval/fixture.ts`'s `loadFixtures` never throws; every failure mode is a tagged return value (`LoadFixturesFailure`), so `eval/command.ts` can report file name, field path, offending value, and expected shape without a try/catch around fixture loading (Requirement 12 criterion 3).
- `eval/run.ts`'s `runEval` catches a `StageError('context', cause)` raised when the Stub_Exec recorded an unexpected call (Decision D16) and returns it as a tagged failure rather than letting it propagate uncaught, so `eval/command.ts` can report it the same way as any other `StageError` (Requirement 14 criterion 7).
- `eval/command.ts`'s `runEvalCommand` never calls `process.exit` and never lets an exception escape uncaught to the caller — the function signature returns `Promise<number>`, so `cli.ts` is the only place that converts the number to an actual process exit, consistent with how `cli.ts` already handles `run` today.
- `cli.ts`'s `.env` loading distinguishes "file absent" (silently skip, Requirement 14 criterion 17) from "file present but unreadable" (`EACCES`, `EISDIR`, etc. — print the file name and error code, never content, and exit 1 before any command logic runs, same criterion).

## Testing Strategy

**Unit tests** (vitest) cover concrete examples, edge cases, and wiring, per Requirement 16 criteria 4–17:

- A candidate exactly at `claimThreshold` becomes a Claim (boundary of Property 4).
- A Declared_Claim sends no Classification_Request (boundary of Property 1, already a `for all` case but worth a named example for readability).
- No accepted Claim gives `claimStatus: 'not_identified'` and a Change_Subject (boundary of Property 5/6).
- Empty context (no Claim, no non-blank source anywhere) raises `StageError` (Decision D8).
- The three uncertainty cases: `needed` true, only `uncertain` true with `onUncertain: 'evidence'`, only `uncertain` true with `onUncertain: 'skip'`.
- A tie on `assess.surface` resolves to the earliest `SURFACE_LABELS` entry (boundary of Property 9).
- A malformed answer raises `StageError` (boundary of Property 16, one concrete case per malformation kind for readability).
- A `RateLimitError` from the gateway raises `StageError('assessment', cause)`.
- `assessment/architecture.test.ts` (new, modelled on `jev/architecture.test.ts`): no file under `assessment/` or `eval/` imports `outcome/resolve` or contains the literal strings `'SKIPPED'`/`'EVIDENCED'`/`'UNSUPPORTED'` as a returned value; only `jev/catalog.ts` calls `noul`/`choice`/`score`/`box`/`image`/`withAssets` (already enforced, re-asserted here is redundant — the existing test's scope already covers the whole `src/` tree, confirmed by its `SRC` root); `assessment/` never imports `jev/transport-sdk.ts` or `jev/transport-json.ts` directly; no file other than `cli.ts` calls `process.loadEnvFile`.
- `catalog.snapshot.json` is unchanged by this feature (no entry version bumped; Decision D2 default path).
- The Eval_Runner: a test with `FakeJevGateway` checking rows, aggregate rows, the disagreement list, `agreement: null` for an empty row, and that no Jev question is asked when a fixture is invalid.
- A test that loads the real `fixtures/eval/*.json` and checks Requirement 11 criteria 1–7, 10–11 and Requirement 12 criteria 1, 4, 5 (schema-validation style, no generator — the corpus is fixed, hand-authored data; this matches the IaC/config-validation guidance for data that is curated, not generated).
- A `runEvalCommand` test suite (temp `cwd`, injected `deps`) covering: printed rows, `eval.json`, `jev-calls.jsonl`, exit 0 on success, exit 1 for missing credential (`createGateway` not called), exit 1 for invalid config, exit 1 for each malformed-flag case, and no output containing a fake key.
- A `cli.ts` child-process test (temp `cwd`, no real `OPENROUTER_API_KEY`) covering: `.env` present/absent, a key already in the child env not overwritten by `.env` (including an empty-string value not overwritten), `.env` as a directory (`EISDIR`) stopping the command before it runs, and `ce --help` never loading `.env`.
- A real-`fixtures/eval/` test with `node:child_process` spied, confirming the spy is never called and the Stub_Exec recorded no call; plus a negative test where a Fixture_Provider stand-in is deliberately given a `headSha`, asserting `runEval` returns the `StageError('context', cause)` failure and asks no Jev question.
- `Eval_Memo_Gateway`-specific unit tests for the Call_Log entry count (`requests` entries) and that a failed request is not stored, as concrete scenarios alongside Property 20.
- `isTestFile` vs. `rankOf`'s classification agreeing for a handful of concrete paths (the consistency is structural by construction per Decision D21, so this is a smoke check, not a generator).

**Property-based tests** (fast-check, minimum 100 iterations each), one test per Correctness Property above, tagged with the format `Feature: claims-assessment-eval, Property {number}: {property title}`:

| # | Property | Generators (sketch) |
| --- | --- | --- |
| 1 | Classification request cardinality | `ChangeContext` with a mix of `cli`/non-`cli` candidates (arbitrary count, arbitrary provenance provider) |
| 2 | Classification_Request state composition | Candidate text + context summary fields of varying length, including some that force shortening |
| 3 | Claim identity and order | `ClaimCandidate[]` with arbitrary text/ids + a scripted probability per candidate (via `FakeJevGateway` recordings keyed by `stateHash`) |
| 4 | Threshold monotonicity | `(candidateId, probability)[]` + two thresholds `t1 <= t2` (`fc.tuple` with a sorted pair) |
| 5 | claimStatus totality | Arbitrary `Claim[]` (including empty) |
| 6 | Change_Subject selection | `(title?, description?, commits: message[])` with each text independently blank/non-blank/whitespace-only |
| 7 | Assessment_Request state composition | Subject text + context file/patch/check fields of varying length, including some that force cutting |
| 8 | Test_File protection | File list with a mix of test/non-test paths and patch sizes that force the state over budget |
| 9 | Surface argmax tie-break | Probability vectors over the 6 labels, including deliberately tied maxima |
| 10 | Combiner formulas | Subject lists with probabilities/thresholds/band drawn from `[0,1]`, including `band = 0` |
| 11 | Combiner totality | Subject lists including the empty list |
| 12 | decidedBy iff | Same domain as Property 10 |
| 13 | Policy-irrelevance | Same domain as Property 10, filtered to the `decidedBy === 'classifier'` branch |
| 14 | Record completeness | Scripted Fake_Gateway answer sequences + a fake secret value injected into env |
| 15 | JSON round-trip | Arbitrary-shaped `Assessment` values (reuse Property 11/14 generators) |
| 16 | Malformed-answer rejection | Answers with randomly corrupted `type`, out-of-range probability, or missing Choice label |
| 17 | assess() determinism | `ChangeContext` + `EffectiveConfig` + a fixed recording set, run twice |
| 18 | Settings fallback | Independent `Partial<assessment>` objects for `config` and `defaults` |
| 19 | Eval bounds/accounting | `(predicted, label)[]` pairs of booleans or `Surface` strings, including the empty list |
| 20 | Memo-transparency | Request sequences with controlled duplication and injected concurrency/failure |

Both layers are complementary (steering/workflow rule): unit tests pin down specific, named scenarios and the architecture boundaries; property tests sweep the input space of every formula, selection rule, and structural invariant the design introduces. CI runs all of the above through `jev/fake.ts` with no API key (steering "Test policy"); only the one-time Live_Run of Requirement 15 talks to the real OpenRouter-backed Jev endpoint, and it is not part of the automated suite.
