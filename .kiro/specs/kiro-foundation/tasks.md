# Implementation Plan: Kiro Foundation

## Overview

This plan adds the static `.kiro/` configuration for the CE repository (issue #2, milestone M0): a root `test` script with vitest, three steering documents, two hooks, and one MCP configuration. No runtime TypeScript is added. The design has no Correctness Properties section, so there are no property-based test tasks. Verification uses automated shell checks.

## Tasks

- [x] 1. Add the test script and vitest setup
  - [x] 1.1 Add `test` scripts and the vitest dev dependency
    - Before changing any dependency, use the Context7 MCP tools (`resolve-library-id`, then `query-docs`) and run `npm view <pkg> version engines.node deprecated` to confirm the version is current, not deprecated, and compatible with Node >=22.12. Apply this to vitest and to any other package added during this spec.
    - In root `package.json`, add `"test": "npm run test --workspaces --if-present"` to `scripts`.
    - In `packages/ce/package.json`, add `"test": "vitest run --passWithNoTests"` to `scripts` and `vitest` `^5.1.1` to `devDependencies` (vitest 5.1.1 requires Node ^22.12 || ^24 || >=26).
    - Set `engines.node` to `>=22.12` in root `package.json` and in `packages/ce/package.json`.
    - Do not add a test script to `examples/demo-app`.
    - _Requirements: 5.3, 5.4, 9.4_

  - [x] 1.2 Install dependencies and verify the scripts
    - Run `node -v` and confirm the local Node satisfies `^22.12 || ^24` (the current machine runs a newer Node). If it does not, stop and tell the user before running `npm install`.
    - Run `npm install` from the repository root so `package-lock.json` includes vitest.
    - Run `npm run typecheck` and `npm test` and confirm both exit 0 with no test files.
    - Confirm `engines.node` equals `>=22.12` in both root `package.json` and `packages/ce/package.json`.
    - _Requirements: 5.3, 5.4, 9.3, 9.4_

- [x] 2. Write the steering documents
  - [x] 2.1 Create `.kiro/steering/product.md`
    - Start with front matter `inclusion: always`.
    - Include: what CE is, the problem (SPEC 1.2), audience (SPEC 1.3), the core terms (Change, Subject, Claim, Check, Assessment, Evidence), the four outcomes with `SKIPPED` and `UNSUPPORTED` stated as distinct, the v0 non-goals, and the sources-of-truth rule (`SPEC.md` normative, `docs/journal/v0.0/` derived, `SPEC.md` wins).
    - Check the "writing to the target app or to Git" non-goal against `docs/journal/v0.0/requirements.md` before writing it.
    - Reference `SPEC.md` and the journal by repository-relative path.
    - Include no secret values and no statement that contradicts `SPEC.md`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 4.2, 4.3, 4.4, 4.5_

  - [x] 2.2 Create `.kiro/steering/tech.md`
    - Start with front matter `inclusion: always`.
    - Include: TypeScript on Node.js >= 22.12 (22 or 24 LTS) with npm workspaces and no build orchestration framework; a flag that the GitHub Action runtime is expected to move to `node24` when `action.yml` is written (journal design says `node20`; do not edit the journal); Playwright (Chromium only), Jev via OpenRouter by default, zod, vitest, fast-check; the `jev.provider` setting with `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY`, and the rule that secrets stay in environment variables; the design rule that Jev chooses among options and never generates text, with outcomes decided in deterministic code; CI tests use `jev/fake.ts` and need no API key.
    - List only commands that exist: `npm install`, `npm run build`, `npm run typecheck`, `npm test`.
    - State that Playwright MCP is for developer inspection in Kiro and is separate from the Playwright library in the Capability Runtime.
    - State that Context7 MCP is configured per developer at user level with their own API key, never in the repository.
    - Reference `SPEC.md` and the journal by relative path. Include no secret values.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.2, 4.3, 4.4, 4.5, 7.6_

  - [x] 2.3 Create `.kiro/steering/structure.md`
    - Start with front matter `inclusion: always`.
    - Include: the current layout (`SPEC.md`, `packages/ce/`, `examples/demo-app/`, `docs/journal/`, `.kiro/`); the planned tree copied verbatim from journal design section 2 (including `action/` and `schemas/`), marked as target structure, with a flag next to `action/` that the Action runtime is expected to move to `node24` when `action.yml` is written; one sentence per directory under `packages/ce/src/` (`config/`, `context/`, `jev/`, `assessment/`, `runtime/`, `outcome/`, `evidence/`).
    - State that all Jev question text lives in `jev/catalog.ts`, that the outcome is decided only in `outcome/resolve.ts`, and that specs live in `.kiro/specs/<feature-name>/` and derive from the journal and `SPEC.md`.
    - Reference `SPEC.md` and the journal by relative path. Include no secret values.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.2, 4.3, 4.4, 4.5_

- [x] 3. Create the hooks
  - [x] 3.1 Create `.kiro/hooks/quality-on-save.json`
    - Use `version: "v1"`, trigger `PostFileSave`, matcher `packages/.*\\.tsx?$`, and an `agent` action.
    - The prompt tells the agent to run `npm run typecheck` from the repo root, then `npm test` only if typecheck succeeds; to report compiler output (file, line, message) or failing test names and messages; to report one line on success; to modify no file; and to not ask for a Jev API key.
    - _Requirements: 5.1, 5.2, 5.5, 5.6, 5.7, 5.8_

  - [x] 3.2 Create `.kiro/hooks/spec-review.json`
    - Use `version: "v1"`, trigger `Stop`, and an `agent` action.
    - The prompt tells the agent to: do nothing if no code under `packages/`, `examples/`, or `action/` changed; read the `MUST` and `MUST NOT` lines of `SPEC.md` with section numbers; compare the changed code (`git diff` and untracked files) against each; report conflicts with section number, quoted requirement, file path, and line range; otherwise report that no conflict was found and list the sections checked; treat `SPEC.md` as authoritative over `docs/journal/v0.0/`; report findings only and not edit any file.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 4. Create the MCP configuration
  - [x] 4.1 Create `.kiro/settings/mcp.json`
    - Declare server `playwright` with `command: "npx"` and `args: ["@playwright/mcp@0.0.86"]` (pinned for reproducibility), `disabled: false`, and no `env` block.
    - Set `autoApprove` to read-only tools only (`browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`). Do not include `browser_tabs`, because it can create, close, and select tabs.
    - Check each tool name against the current `@playwright/mcp` README and remove any name that does not exist.
    - Do not add a `context7` entry. Context7 is configured at user level (`~/.kiro/settings/mcp.json`), and a workspace entry would override it and drop the developer's API key.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 5. Checkpoint - Ensure all files are in place
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Verify the deliverables
  - [x] 6.1 Run the automated checks from the design's Testing Strategy
    - Parse both hooks and `mcp.json` as JSON.
    - Assert hook shape: quality matcher matches `packages/ce/src/index.ts` and `packages/a/b/c.tsx` and does not match `README.md` or `packages/ce/package.json`; review hook trigger is `Stop`; review prompt contains `MUST NOT`, `SPEC.md`, "section number", "line range", and "Do not edit".
    - Assert MCP shape: server `playwright`, command `npx`, every `autoApprove` entry is on the four-tool read-only list (`browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`), and no `context7` server is declared.
    - Assert each steering file starts with `inclusion: always` and every repository path it references exists.
    - Assert `engines.node` equals `>=22.12` in root `package.json` and `packages/ce/package.json`.
    - Run the secret scan over `.kiro` (variable names `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` are allowed).
    - Run `git check-ignore` on each created file and confirm exit status 1 (not ignored). Confirm the six issue deliverables exist.
    - Fix any failing check in the relevant file.
    - _Requirements: 4.2, 4.4, 5.2, 6.7, 7.3, 7.4, 7.5, 8.1, 8.2, 9.1, 9.4_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This feature has no property-based tests because the design omits Correctness Properties.
- Live checks (saving a file with a type error, ending an agent turn, opening the Kiro MCP panel, creating a sample spec in a fresh session) need a human in Kiro and are not tasks. Run them manually from the design's Testing Strategy.
- The Node baseline is raised to 22.12 by user decision (22 or 24 only), which supersedes "Node 20" in issue #2. vitest 5 is used.
- Findings outside this spec's scope, for the user to decide later (do not change them here): `typescript` latest is 7.0.2 while the repo uses `^5.6.0`; `@types/node` is `^22` in the repo, which matches the Node 22 baseline, while latest is 26.x; `zod` 4.6.7 and `fast-check` 4.11.0 are current for later milestones.
- Tasks 2.x derive content from `SPEC.md` and `docs/journal/v0.0/`. `SPEC.md` wins on conflict.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2", "2.3", "3.1", "3.2", "4.1"] },
    { "id": 2, "tasks": ["5"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["7"] }
  ]
}
```
