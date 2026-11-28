# Task T4 — Next-steps text and workflow snippet

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Next-steps text and workflow snippet [depends: T2] [parallel: T3]

## OBJECTIVE
Create `packages/ce/src/init/next-steps.ts`: `renderNextSteps(input: { detection: Detection; configPath: string; env: Record<string, string | undefined> }): string`.

Steps:
1. Write failing test for: next steps after a detected init
   Test file: `packages/ce/src/init/next-steps.test.ts`
   Level: unit
   Test intent: Given vite/npm detection with ceInstalled true and env without a key / When renderNextSteps / Then text lists, in order: the written path; `OPENROUTER_API_KEY` with `https://openrouter.ai/keys` and `.env` auto-load + keep out of git; `npx playwright install chromium`; add `.ce/` and `.env` to `.gitignore`; `npx ce run`; a fenced YAML snippet. Extracting the snippet and parsing it with `yaml` gives `on.pull_request`, permissions contents read / pull-requests write, a checkout step with `fetch-depth: 0`, setup-node node 22, `npm ci`, and a step `uses: rfxlamia/ce@v0` with env `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}` and no `with.target-*` inputs
   Exercise through: `renderNextSteps`
   Test doubles: none
   Expected RED: module does not exist
2. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/next-steps.test.ts`
3. Implement → PASS. Commit `feat(init): print onboarding next steps`.
4. Write failing test for: install-step table per package manager (C2)
   Test file: `packages/ce/src/init/next-steps.test.ts`
   Level: unit
   Test intent: one case per row — npm+lock → `npm ci`; npm no lock → `npm install`; pnpm+lock → `pnpm/action-setup@v4` step before setup-node and `pnpm install --frozen-lockfile`; pnpm no lock → `pnpm install`; yarn pmMajor 4 + lock → `corepack enable` run step and `yarn install --immutable`; yarn pmMajor null + lock → `yarn install --frozen-lockfile`; yarn no lock → `yarn install`; bun+lock → `oven-sh/setup-bun@v2` and `bun install --frozen-lockfile`; bun no lock → `bun install`; fallback → `npm ci` with `# adjust to your install command`
   Exercise through: `renderNextSteps` (parse snippet steps)
   Test doubles: none
   Expected RED: only the npm row exists
5. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/next-steps.test.ts -t "install"`
6. Implement → PASS → refactor while green. Commit `feat(init): pick workflow install steps per package manager`.
7. Write failing test for: run command when not installed + fallback ordering (C1 step 6, C1 step 2)
   Test file: `packages/ce/src/init/next-steps.test.ts`
   Level: unit
   Test intent: Given ceInstalled false / Then text contains "npm i -D continuous-evidence" and "npx continuous-evidence run", and every index of "npx ce run" is greater than the index of "npm i -D continuous-evidence". Given a fallback detection / Then the step "edit target in ce.yml" appears before the key step
   Exercise through: `renderNextSteps`
   Test doubles: none
   Expected RED: run command not conditional
8. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/next-steps.test.ts -t "not installed"`
9. Implement → PASS → refactor while green. Commit `feat(init): guard the run command when continuous-evidence is not installed`.
10. Write failing test for: key value never echoed (C3)
    Test file: `packages/ce/src/init/next-steps.test.ts`
    Level: unit
    Test intent: Given env OPENROUTER_API_KEY "sk-test-123" / When renderNextSteps / Then output does not contain "sk-test-123" and says the key is already set
    Exercise through: `renderNextSteps`
    Test doubles: none
    Expected RED: "already set" message missing
11. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/next-steps.test.ts -t "never echoed"`
12. Implement → PASS; refactor while green; commit `feat(init): never echo API key values`.

## REFERENCES LOADED
Spec — rules C1, C2 (install table), C3; scenarios next steps after a detected init, run command when installed / not installed, key value never echoed, snippet is valid YAML
README.md (existing Action snippet, for shape), action.yml (input names; Action installs Chromium), action/src/index.ts (runs `ce run` in workspace → reads ce.yml)
packages/ce/src/init/detect.ts (created by: T2)

## WHY THIS APPROACH
Complexity: standard
Justification: table-driven output with ordering and secret-handling rules.

## SANDWICH CONTEXT
[CRITICAL: never print an environment variable's value; never print a bare `npx ce run` before install guidance when continuous-evidence is not installed]
You are implementing the next-steps output for `ce init`.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: Option A — pure text renderer
Files in scope: packages/ce/src/init/next-steps.ts, next-steps.test.ts
Available after: T2 (Detection)
Architecture rule: pure — reads only the passed env object; no fs, no process.*
[RESTATE: never print secret values]

## DELIVERABLE
Given vite detection succeeded, Then stdout text contains OPENROUTER_API_KEY, playwright install chromium, ce run, and a YAML block with uses rfxlamia/ce@v0, fetch-depth 0, secrets.OPENROUTER_API_KEY
Given each package manager row, Then the snippet's install step matches the C2 table
Given continuous-evidence not installed, Then install guidance precedes any `npx ce run`
[must-not] Given OPENROUTER_API_KEY=sk-test-123, Then output must NOT contain sk-test-123

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Snippet validated by parsing with `yaml`
Must-not-have:
  - `target-*` inputs in the snippet
  - Running or suggesting network commands from init itself (printing them is fine)
Open question risks:
  - none identified
Rollback note:
  - Additive; revert
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: all next-steps tests pass
Uncertain when: an action version pin (pnpm/action-setup@v4, oven-sh/setup-bun@v2) is wrong → NEEDS_CONTEXT
Escalate when: secret value appears in any output
