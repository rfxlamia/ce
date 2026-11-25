---
inclusion: always
---

# Technology

Normative contract: `SPEC.md`. Derived design: `docs/journal/v0.0/design.md` and `docs/journal/v0.0/requirements.md`. `SPEC.md` wins when they disagree.

## Language and runtime

- TypeScript on Node.js 22.12 or later (22 or 24 LTS lines). `engines.node` is `>=22.12`.
- npm workspaces (`packages/*`, `examples/*`). No build orchestration framework.
- Open flag: `docs/journal/v0.0/design.md` mentions `action.yml (node20)`. The GitHub Action runtime is expected to move to `node24` when `action.yml` is written. The journal is not edited.

## Stack

- Playwright, Chromium only, for the browser Capability Runtime.
- Jev as the classifier, accessed through OpenRouter by default.
- zod for configuration schemas.
- vitest for unit tests.
- fast-check for property-based tests.

## Jev provider and secrets

- The `jev.provider` setting selects the provider: `openrouter` uses `OPENROUTER_API_KEY`, `typesafe` uses `TYPESAFE_API_KEY`.
- Secrets live in environment variables only. Never put a key or credential value in a committed file, including steering, hooks, and MCP configuration.

## Design rule

Jev chooses among options built from observed facts. Jev never generates text. The outcome (`SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR`) is decided in deterministic code, in `outcome/resolve.ts`.

## Test policy

CI tests use `jev/fake.ts` (a fake Jev gateway) and need no API key.

## Commands

Run from the repository root:

- `npm install`
- `npm run build`
- `npm run typecheck`
- `npm test`

## MCP servers

- Playwright MCP (`.kiro/settings/mcp.json`) is for developer inspection inside Kiro, for example looking at `examples/demo-app`. It is separate from the Playwright library used by the CE Capability Runtime.
- Context7 MCP is configured per developer at user level (`~/.kiro/settings/mcp.json`) with the developer's own API key. It is never declared in the repository.
