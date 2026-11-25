---
inclusion: always
---

# Structure

Normative contract: [`SPEC.md`](../../SPEC.md). Derived design: [`docs/journal/v0.0/design.md`](../../docs/journal/v0.0/design.md) (section 2, "Package layout") and [`docs/journal/v0.0/requirements.md`](../../docs/journal/v0.0/requirements.md). `SPEC.md` wins on any conflict.

## Current layout

- `SPEC.md`: the normative CE specification.
- `packages/ce/`: the `ce` npm workspace package (currently `src/index.ts` and `src/cli.ts`).
- `examples/demo-app/`: the demo application used as a target for CE.
- `docs/journal/`: derived design documents, under `docs/journal/v0.0/`.
- `.kiro/`: steering, hooks, MCP settings, and specs.

## Planned layout (target structure)

Target structure from `docs/journal/v0.0/design.md` section 2. Most of these directories and files do not exist yet.

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

Flag: `action/` is planned. The journal says `action.yml (node20)`, but the Action runtime is expected to move to `node24` when `action.yml` is written. This is not yet decided.

## Directories under `packages/ce/src/`

- `config/`: defines the `ce.yml` zod schema, loads the file, and holds the defaults.
- `context/`: gathers, redacts, budgets, and splits the Change input into claim candidates, then resolves a `ChangeContext`.
- `jev/`: the Jev classifier gateway, its versioned question catalog, a fake gateway for tests, and a call log.
- `assessment/`: turns claim candidates into Claims and assesses Claims against Checks to produce an Assessment.
- `runtime/`: starts or attaches to the Subject and runs the bounded Observe, Decide, Execute loop with Playwright.
- `outcome/`: decides the final execution outcome from the stage reached and the Assessment.
- `evidence/`: writes the Evidence bundle (`run.json`, `report.html`) and the terminal and markdown summaries.

## Placement rules

- All Jev question text lives in `jev/catalog.ts`. No other file defines question text.
- The outcome is decided only in `outcome/resolve.ts`. No other file, and no model answer, decides it.

## Specs

Kiro specs live in `.kiro/specs/<feature-name>/`. Each spec derives from the journal (`docs/journal/v0.0/`) and `SPEC.md`.
