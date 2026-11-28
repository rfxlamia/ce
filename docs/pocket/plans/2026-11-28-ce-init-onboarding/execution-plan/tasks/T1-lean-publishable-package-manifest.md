# Task T1 — Lean, publishable package manifest

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Lean, publishable package manifest [prereq]

## OBJECTIVE
Make `packages/ce` pack into a lean, runnable tarball with complete npm metadata.

Steps:
1. Write failing test for: package manifest declares publishable metadata and a lean build
   Test file: `packages/ce/src/package-manifest.test.ts`
   Level: unit
   Test intent: Given `packages/ce/package.json` and `packages/ce/tsconfig.build.json` read from disk / When parsed / Then `repository` is `{ type: "git", url: "git+https://github.com/rfxlamia/ce.git", directory: "packages/ce" }`, `homepage`, `bugs.url` and a non-empty `keywords` exist; `scripts.build` is `tsc -p tsconfig.build.json`; `scripts.prepack` removes `dist` then runs the build; `scripts.typecheck` still uses the full `tsconfig.json`; `bin.ce` is `./dist/cli.js`; tsconfig.build.json `extends` `./tsconfig.json` and its `exclude` covers `**/*.test.ts`, `**/*.testsupport.ts`, `**/*arbitraries.ts`, `src/scripts/**`; `packages/ce/README.md` and `packages/ce/LICENSE` exist and LICENSE equals the root LICENSE text; `src/cli.ts` first line is `#!/usr/bin/env node`
   Exercise through: file reads of the manifest files (the package's public contract)
   Test doubles: none
   Expected RED: tsconfig.build.json, README, LICENSE and the new manifest fields do not exist
2. Run test — verify FAIL: `cd packages/ce && npx vitest run src/package-manifest.test.ts`
3. Implement: create `tsconfig.build.json` (extends + exclude list above); in `package.json` set `"build": "tsc -p tsconfig.build.json"`, `"prepack": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && npm run build"`, add `repository`, `homepage` (`https://github.com/rfxlamia/ce#readme`), `bugs` (`https://github.com/rfxlamia/ce/issues`), `keywords` (e.g. `verification`, `evidence`, `ci`, `playwright`, `cli`); keep `version` 0.1.0 and `files: ["dist"]`. Copy root `LICENSE` to `packages/ce/LICENSE`. Write `packages/ce/README.md` (npm page): one-paragraph what CE is, Quick start (`npm i -D continuous-evidence && npx ce init`, `npx continuous-evidence init`), the bare-`npx ce` warning, link to repo README/SPEC. Run test → PASS.
4. Verify tarball manually: `npm pack --workspace continuous-evidence --dry-run --json` from repo root → zero paths matching `\.test\.|testsupport|arbitraries|/scripts/`, `dist/cli.js` present. Then `npm run build && npm run typecheck && npm test` at root stay green.
5. Commit: `git commit -m "chore(ce): ship a lean, publishable continuous-evidence package (#13)"`

## REFERENCES LOADED
docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md — rules D1, D2, D3; scenario "clean-checkout pack is lean and runnable"
packages/ce/package.json, packages/ce/tsconfig.json, packages/ce/vitest.config.ts, LICENSE
npm scripts lifecycle (Context7 /npm/cli scripts.md): prepack runs on `npm pack` and `npm publish`

## WHY THIS APPROACH
Complexity: lightweight
Justification: config files only, one manifest test; no branching logic.

## SANDWICH CONTEXT
[CRITICAL: Do not change `typecheck` to the build config — tests must stay type-checked; do not add dependencies]
You are implementing the packaging prerequisite for `ce init` + npm distribution.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: Option A — separate `tsconfig.build.json` (rejected: `files` negation globs)
Files in scope: packages/ce/tsconfig.build.json, packages/ce/package.json, packages/ce/README.md, packages/ce/LICENSE, packages/ce/src/package-manifest.test.ts
Available after: none (prereq)
Architecture rule: action/ resolves CE from source; nothing else consumes packages/ce/dist
[RESTATE: Do not change `typecheck` to the build config; no new dependencies]

## DELIVERABLE
Given a checkout with no packages/ce/dist, When `npm pack --workspace continuous-evidence`, Then the tarball has dist/cli.js with the shebang and zero *.test.* / testsupport / arbitraries / scripts files
[derived] Given package.json, When read, Then repository (with directory packages/ce), homepage, bugs, keywords are present and version is 0.1.0

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written before implementation
  - prepack cleans dist so stale files never ship
  - Root `npm run build`, `npm run typecheck`, `npm test` still pass
Must-not-have:
  - Running `npm publish`
  - Editing action/ files or the run pipeline
  - Adding `README.md`/`LICENSE` to `files` (npm includes them automatically)
Open question risks:
  - none identified
Rollback note:
  - Revert the commit; build change only narrows emitted files
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Must-not behavior implemented → STOP

## STOP CONDITIONS
Done when: manifest test passes, dry-run pack shows zero test artifacts, root build/typecheck/test green
Uncertain when: some runtime module imports a file excluded by tsconfig.build.json (build fails) → NEEDS_CONTEXT
Escalate when: the action build or tests break
