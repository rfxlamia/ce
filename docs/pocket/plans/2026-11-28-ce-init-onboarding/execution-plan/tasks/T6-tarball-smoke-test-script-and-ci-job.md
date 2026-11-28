# Task T6 — Tarball smoke test script and CI job

**Phase:** 2
**Depends:** T1, T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Tarball smoke test script and CI job [depends: T1, T5] [test-risk]

## OBJECTIVE
Create `scripts/smoke-pack.mjs` and a `smoke-pack` job in `.github/workflows/ci.yml` that proves the packed tarball onboards a fresh repo.

Steps:
1. Write failing test for: ci.yml runs the smoke script
   Test file: `action/workflow.test.ts`
   Level: unit (workflow structure)
   Test intent: Given ci.yml parsed with `yaml` / Then a job `smoke-pack` exists on ubuntu-latest with Node `24.x`, steps include `npm ci` and `node scripts/smoke-pack.mjs`, the job sets no `OPENROUTER_API_KEY`, and the existing assertion "ci.yml text does not contain rfxlamia/ce" still holds
   Exercise through: the parsed workflow file
   Test doubles: none
   Also assert the `node scripts/smoke-pack.mjs` step comes after the `npm ci` step.
   Expected RED: no smoke-pack job
2. Run test — verify FAIL: `cd action && npx vitest run workflow.test.ts`
3. Write failing test for: smoke checks reject bad tarballs and bad CLI behaviour (negative controls)
   Test file: `action/smoke-pack.test.ts`
   Level: unit
   Test intent: Given the pure check helpers exported by `scripts/smoke-pack-checks.mjs` / When fed a pack file list containing `dist/x.test.js`, `dist/runtime/demo-app.testsupport.js`, `dist/evidence/arbitraries.js` or `dist/scripts/a.js`, or one missing `dist/cli.js` / Then the lean-tarball check fails naming the offending path; a cli.js text without `#!/usr/bin/env node` on line 1 fails the shebang check; a step result `{ step: 'second init', code: 0 }` fails the "second init exits 1" check; a keyless-run result whose output lacks `OPENROUTER_API_KEY` or `Outcome: ERROR`, or whose exit code is 0, fails; a `--version` output differing from the packed version fails; and the valid counterparts pass
   Exercise through: the exported check functions
   Test doubles: in-memory file lists / result objects (no npm, no network)
   Expected RED: `scripts/smoke-pack-checks.mjs` does not exist
4. Run test — verify FAIL: `cd action && npx vitest run smoke-pack.test.ts`
5. Implement `scripts/smoke-pack-checks.mjs` (pure assertions returning `{ ok, message }`) → PASS → refactor while green. Commit `test(ci): add smoke-pack checks with negative controls`.
6. Implement `scripts/smoke-pack.mjs` (imports the checks) (plain Node ESM, no deps; `node:child_process` spawnSync with argv arrays, no shell interpolation; exits non-zero with a named failing step):
   a. `npm pack --workspace continuous-evidence --pack-destination <tmp>/pack --json` from repo root; assert file list has zero paths matching `\.test\.|testsupport|arbitraries|(^|/)scripts/` and includes `dist/cli.js`; extract and assert `package/dist/cli.js` starts with `#!/usr/bin/env node` (read via `tar -xzf` into tmp)
   b. temp app dir: `git init`, write package.json `{"name":"smoke-app","private":true,"scripts":{"dev":"vite"}}`, `npm i -D <tgz> --no-audit --no-fund`
   c. `npx ce --version` equals the packed version
   d. `npx ce init` exits 0; then `node --input-type=module -e "import {loadConfig} from 'continuous-evidence'; const r = loadConfig({cwd: process.cwd(), flags: {}, env: {}}); process.exit(r.ok ? 0 : 1)"` in the app dir exits 0
   e. second `npx ce init` exits 1
   f. `npx ce run` with OPENROUTER_API_KEY and TYPESAFE_API_KEY removed from the child env exits 1 and combined output contains `OPENROUTER_API_KEY` and `Outcome: ERROR`
   g. print elapsed seconds for b–f; remove temp dirs unless `--keep`
   Add job `smoke-pack` to ci.yml (checkout with pinned SHA as existing jobs, setup-node `24.x` with npm cache, `npm ci`, `node scripts/smoke-pack.mjs`, timeout 10 min). → workflow test PASS.
7. Verify script locally: `node scripts/smoke-pack.mjs` → exit 0 and prints elapsed time; then negative control: run it once with `SMOKE_PACK_BREAK=shebang` (a test-only env switch that corrupts the extracted cli.js copy before the check) and confirm exit ≠ 0 naming the shebang step.
8. Commit: `ci: smoke-test the packed continuous-evidence tarball (#13)`

## REFERENCES LOADED
Spec — rules D2, D4; scenarios fresh repo onboarding, first run without key, clean-checkout pack is lean and runnable
.github/workflows/ci.yml, action/workflow.test.ts (existing ci.yml assertions), scripts/build-action.mjs (script style)
npm CLI 11 docs (Context7): pack --workspace, prepack lifecycle, npx single-bin resolution
packages/ce/src/init/command.ts (created by: T5), packages/ce/tsconfig.build.json (created by: T1)

## WHY THIS APPROACH
Complexity: standard
Justification: real npm/network interactions; level is an end-to-end smoke rather than a unit test.

## SANDWICH CONTEXT
[CRITICAL: ci.yml must not contain the string "rfxlamia/ce"; the smoke job must not need secrets or Chromium]
You are implementing the packaging smoke test for issue #13.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: Option A — one reusable script for CI and release
Files in scope: scripts/smoke-pack.mjs, scripts/smoke-pack-checks.mjs, .github/workflows/ci.yml, action/workflow.test.ts, action/smoke-pack.test.ts
Available after: T1 (lean pack), T5 (ce init)
Architecture rule: do not modify existing ci.yml `verify` job steps
[RESTATE: no "rfxlamia/ce" text in ci.yml; no secrets]

## DELIVERABLE
Given clean checkout, When pack, Then lean tarball with shebanged dist/cli.js
Given empty git repo with {"scripts":{"dev":"vite"}}, When install tarball + `npx ce init`, Then ce.yml written and loadConfig ok
Given no key, When `npx ce run`, Then exit 1 with OPENROUTER_API_KEY and Outcome: ERROR
Given second init, Then exit 1

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - argv arrays, no shell string interpolation of paths
  - Child env explicitly strips API keys
Must-not-have:
  - npm publish; installing Chromium in the smoke job
Open question risks:
  - npm registry reachability in CI (installing tarball deps) → transient failure; job may be retried
Rollback note:
  - Remove the job; script is standalone
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: workflow test passes and `node scripts/smoke-pack.mjs` exits 0 locally
Uncertain when: `npx ce` resolves to the unrelated registry package inside the temp app → NEEDS_CONTEXT
Escalate when: the tarball cannot run without files outside dist
