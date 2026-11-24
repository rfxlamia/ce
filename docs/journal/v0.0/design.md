# Design — Continuous Evidence v0

> Journal v0.0 — architecture for the whole v0 scope.

Implements [`requirements.md`](./requirements.md). Normative source:
[`SPEC.md`](../../../SPEC.md).

## 1. Overview

CE is a single pipeline, invoked on demand, with four stages from SPEC §4.2
and one cross-cutting adapter for Jev:

```mermaid
flowchart LR
  subgraph Invokers
    CLI[ce CLI] --- GHA[GitHub Action] --- API["run(options)"]
  end
  Invokers --> CFG[Config loader]
  CFG --> CR[Context Resolver]
  CR --> AE[Assessment Engine]
  AE -- SKIPPED / UNSUPPORTED --> EO[Evidence Output]
  AE -- evidence required --> RT[Capability Runtime]
  RT --> EO
  AE <--> JG[(Jev Gateway)]
  RT <--> JG
  EO --> B[(.ce/runs/&lt;id&gt;)]
  B --> R[report.html]
  B --> C[PR comment]
```

Design rules that follow from Jev being a *classifier* rather than a text
generator:

1. **Jev never writes; it chooses.** Every Jev call answers a question whose
   answer space CE built from observed facts. Claims are extracted text,
   actions are observed elements. This is how CE satisfies "do not fabricate
   claims" (SPEC §7.2) and "bounded decisions" (SPEC §6.2) by construction.
2. **One question, one judgment.** Composite decisions (is evidence needed?)
   are split into small questions and combined in code, so thresholds live in
   `ce.yml`, not in prompts.
3. **Probabilities are signals.** CE stores them as observations with
   provenance. The outcome is decided by deterministic code in
   `outcome/resolve.ts`, never directly by a model answer.

## 2. Package layout

```
packages/ce/src/
  index.ts              run(options) — public API
  cli.ts                ce run | init | eval | report
  config/               schema.ts (zod → JSON Schema), load.ts, defaults.ts
  context/
    providers/          git.ts, github-event.ts, cli-args.ts, junit.ts
    redact.ts           built-in + configured patterns
    budget.ts           prioritise + truncate to state budget
    candidates.ts       split text into claim candidates (no generation)
    resolve.ts          → ChangeContext
  jev/
    gateway.ts          JevGateway interface + TypeSafe implementation
    catalog.ts          versioned question catalog (all question text lives here)
    fake.ts             recorded/fixture gateway for tests and eval
    log.ts              jev-calls.jsonl writer (no state contents)
  assessment/
    claims.ts           candidate → Claim[]
    assess.ts           claims × checks → Assessment
  runtime/
    target.ts           attach | start + readiness + log capture
    observe.ts          Playwright page → Observation (actionable elements)
    decide.ts           Observation + claim → Jev choice → Action
    execute.ts          Action → Playwright call
    loop.ts             bounded Observe → Decide → Execute
    capture.ts          screenshots, console, network (optional)
  outcome/resolve.ts    single source of truth for the outcome
  evidence/
    bundle.ts           run.json writer + schema validation
    report/             report.html template (self-contained, offline)
    summary.ts          terminal + markdown (PR comment) summaries
action/                 GitHub Action (action.yml + entry), repo root
schemas/                run.schema.json, ce.schema.json (generated)
```

Dependencies: `playwright` (Chromium only), `@typesafe-ai/sdk` (pointed at
OpenRouter by default via `baseURL: https://openrouter.ai/api`), `zod`,
`yaml`, `fast-check` (dev), `vitest` (dev). No framework, no daemon.

## 3. Data model

```ts
type Provenance = { provider: 'git' | 'github' | 'cli' | 'junit' | 'config' | 'runtime'; ref?: string; location?: string };

interface ChangeContext {
  change: { title?: string; description?: string; base?: string; head?: string; files: ChangedFile[]; provenance: Provenance[] };
  candidates: { id: string; text: string; provenance: Provenance }[];
  checks: { name: string; status: 'passed' | 'failed' | 'skipped'; covers?: string[]; provenance: Provenance }[];
  truncated: { file: string; reason: string }[];
  providers: { name: string; status: 'used' | 'unavailable'; reason?: string }[];
}

interface Claim { id: string; text: string; probability: number; provenance: Provenance }

interface Assessment {
  claimStatus: 'identified' | 'not_identified';
  perClaim: { claimId: string; runtimeObservable: number; checksAdequate: number; surface: Surface; surfaceConfidence: number }[];
  required: boolean;
  decidedBy: 'classifier' | 'policy';      // R5.5
  surface: Surface;                         // dominant surface
}

type Surface = 'browser_ui' | 'http_api' | 'cli' | 'backend_internal' | 'native_app' | 'non_runtime';

interface Observation { step: number; url: string; title: string; elements: ObservedElement[]; screenshot: string; domDigest: string }
interface ObservedElement { ref: string; role: string; name: string; locator: string; visible: boolean; enabled: boolean }

type Action =
  | { kind: 'click' | 'hover' | 'focus'; ref: string }
  | { kind: 'fill'; ref: string; value: string }       // value only from config fixtures (§5.4)
  | { kind: 'goto'; url: string }
  | { kind: 'done' } | { kind: 'give_up'; reason: string };

type Outcome = 'SKIPPED' | 'EVIDENCED' | 'UNSUPPORTED' | 'ERROR';
```

`run.json` = `{ schemaVersion, ceVersion, jevModel, outcome, outcomeReason,
config, context, claims, assessment, subject, steps[{observation, action,
probabilities}], finalState, artifacts, timings, error? }`.

## 4. Jev question catalog

All questions are defined in `jev/catalog.ts` with an id and version, e.g.
`claim.is_behavior@1`. Backticked paths refer to fields of the state.

| Id | Type | State | Question (abridged) | Used for |
| --- | --- | --- | --- | --- |
| `claim.is_behavior` | Noul, one per candidate | change summary + `candidate` | Does `candidate` describe behaviour the changed software should exhibit when run? | R4 |
| `assess.runtime_observable` | Noul | `claim` + changed files | Would the behaviour in `claim` be observable by running the application? | R5.1 |
| `assess.checks_adequate` | Noul | `claim` + `checks` + test files in diff | Do the passing `checks` already exercise `claim` as it actually renders or executes? | R5.1 |
| `assess.surface` | Choice (6 labels) | `claim` + changed files | Where would this behaviour be observed? | R5.2 |
| `runtime.next_action` | Choice (≤240 options) | `claim` + page metadata + step history (text only) | Which action moves the page toward the state described in `claim`? | R7.2 |
| `runtime.state_reached_dom` | Noul | `claim` + text observation (text only) | Does the observed page state match the state described in `claim`? | fast stop signal |
| `runtime.state_reached` | Noul | final screenshot image + `claim` | Does the screenshot show the state described in `claim`? | final signal, report |
| `runtime.locate_subject` | Box | screenshot image + `claim` subject | Where is the subject of `claim` in the screenshot? | report highlight |

All questions about one state go into a single request. The loop stays
text-only for speed; image questions run once on the final screenshot, since
every request with an image runs in Jev's slower, less accurate long-context
mode. Box requires `typesafe/jev-1.14` (or `~typesafe/jev-latest`).
`runtime.next_action` options are built from the observation: one option per
visible+enabled element (`e12: button "Menu"`), observed same-origin links,
configured routes, plus `done` and `give_up`. If more than 240 candidates
exist, CE ranks by proximity to changed selectors/text and keeps the top 240.

**Decision combination (code, not model):**

```
claimOk      = p(claim.is_behavior) ≥ thresholds.claim
needed(c)    = p(runtime_observable) ≥ t.observable AND p(checks_adequate) < t.adequate
uncertain(c) = any p within ±assessment.uncertainty-band of its threshold
required     = any needed(c) OR (any uncertain(c) AND on-uncertain = evidence)
supported    = surface(c) ∈ capabilityCatalog   // v0: { browser_ui }
```

When no claim is identified, the same assessment questions run against the
change title/diff summary with `claimStatus = not_identified` (SPEC §7.2).

## 5. Runtime loop

```
target = attach(url) | start(cmd) → waitReady
obs = observe(page)                         step 0 screenshot
repeat until steps = maxSteps or time budget spent:
  ask Jev {next_action(options from obs), state_reached_dom(obs)}  (one text request)
  if state_reached_dom ≥ t.reached or action = done → capture final, break
  if action = give_up → capture final, break
  execute(action)   (locator must exist in obs; else record and give_up)
  obs = observe(page)                       screenshot after each action
final: one image request {state_reached, locate_subject (Box)} on final screenshot
```

Safety bounds: same-origin navigation only unless `runtime.allow-origins`
lists more; no form submission to non-target origins; `fill` values only from
`runtime.fixtures` in config; download and dialog events auto-dismissed and
logged.

## 6. Outcome resolution

`outcome/resolve.ts` is a pure function of `(stage reached, assessment,
loop result, error)`:

| Condition | Outcome |
| --- | --- |
| Any uncaught error before a bundle could be meaningful | `ERROR` |
| `assessment.required = false` | `SKIPPED` |
| required, surface not in catalog | `UNSUPPORTED` |
| required, supported, ≥1 observation captured | `EVIDENCED` (+ `finalState: reached \| not_reached`) |
| required, supported, target unreachable / no observation | `ERROR` |

Property tests assert: exactly one outcome for every input; `SKIPPED ⇒
¬required`; `UNSUPPORTED ⇒ required ∧ ¬supported`; `EVIDENCED ⇒ bundle passes
§7.2 field check`.

Exit code: `0` unless `outcome ∈ output.fail-on` → `1` for ERROR, `2` for
UNSUPPORTED, `3` for EVIDENCED-not-reached when listed.

## 7. Configuration

```yaml
# ce.yml — every key optional
version: 0
target:
  url: http://localhost:5173
  start: npm run dev --workspace @ce/demo-app
  ready: { path: /, timeout: 60s }
  routes: [/, /settings]
context:
  base: origin/main
  include: ["src/**"]
  exclude: ["**/*.lock", "dist/**"]
  redact: ["(?i)token\\s*[:=]\\s*\\S+"]
  checks: reports/junit.xml
assessment:
  thresholds: { claim: 0.6, observable: 0.6, adequate: 0.7 }
  uncertainty-band: 0.1
  on-uncertain: evidence        # evidence | skip
runtime:
  max-steps: 12
  timeout: 90s
  viewport: { width: 1280, height: 800 }
  fixtures: { email: demo@example.com }
jev:
  provider: openrouter          # openrouter (OPENROUTER_API_KEY) | typesafe (TYPESAFE_API_KEY)
  model: typesafe/jev-1.14
output:
  dir: .ce/runs
  fail-on: [error]
```

The zod schema is the single source; `ce.schema.json` is generated from it so
editors autocomplete `ce.yml`.

## 8. GitHub Action

```yaml
- uses: rfxlamia/ce@v0
  with:
    url: http://localhost:5173
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

`action.yml` (node20) runs the bundled CLI, caches the Playwright Chromium
download, reads PR context from `GITHUB_EVENT_PATH`, uploads `.ce/runs/<id>`
with `actions/upload-artifact`, and upserts one PR comment marked
`<!-- ce:report -->`. Screenshots stay in the artifact by default; publishing
images inline (e.g. to an orphan branch) is opt-in (`publish: branch`).

## 9. Report design

`report.html` is one offline file (inline CSS/JS, images referenced
relatively). Order: outcome banner → claims with provenance chips →
assessment as small probability bars with the question asked → step timeline
(screenshot, action taken, alternatives considered with probabilities) → final
screenshot with Box highlight → logs → raw `run.json`. Dark theme by default
for Kiroween, high-contrast and keyboard-navigable. Copy always says
"signal" for classifier output.

## 10. Error handling

Each stage throws a typed `StageError(stage, cause)`. The pipeline catches at
the top, resolves `ERROR`, and still writes `run.json` with completed stages.
Jev `RateLimitError` after SDK retries → `ERROR(stage)`. Browser crash →
`ERROR` with last screenshot kept.

## 11. Testing strategy

- **Unit:** providers, redaction, budget, candidates, decision combiner.
- **Property (fast-check):** outcome invariants (§6); redaction removes every
  generated secret and is idempotent; candidates are always substrings of the
  context; `next_action` never yields a ref absent from the observation.
- **Fake Jev:** `jev/fake.ts` replays recorded answers keyed by question id +
  state hash; all CI tests run keyless.
- **E2E:** demo-app scenarios — logic change covered by tests → `SKIPPED`;
  "fix dropdown clipping in modal" → `EVIDENCED`; backend-only change with no
  check → `UNSUPPORTED`.
- **Eval:** `fixtures/eval/*.json` (15–20 labelled changes) + `ce eval` against
  live Jev, reporting agreement per question.

## 12. Open questions

Resolved:
- ~~Image + text state in one request~~ — supported via OpenRouter (state is
  an array of text and `image_url` parts). Image input and Box are early
  features in Jev, so they are kept out of the loop and off the critical path:
  if the final image request fails, the run still resolves from text signals.
- ~~Judge access to Jev~~ — OpenRouter needs no TypeSafe signup; judges use
  their own OpenRouter key or the demo key in the private Devpost field.

- ~~R7.4 mapping~~ — decided: `EVIDENCED` with `finalState: not_reached`,
  keeping SPEC's four outcomes untouched.

Open:
1. Spike task: confirm the OpenRouter System One response shape matches the
   SDK types for `choice`/`noul`/`box`, and measure latency per loop step.
