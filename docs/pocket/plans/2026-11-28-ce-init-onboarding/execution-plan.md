# EXECUTION PLAN — `ce init` and npm distribution (issue #13)

**Date:** 2026-11-28
**Spec:** docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
**Status:** approved
**Total tasks:** 9

---

## Preflight Summary

```
PREFLIGHT COMPLETE
Codebase scanned: packages/ce/src/cli.ts, src/run/command.ts (pure command pattern),
  src/config/{file,load,schema,index}.ts, src/runtime/target.ts, src/index.ts (exports loadConfig),
  packages/ce/{package.json,tsconfig.json,vitest.config.ts}, action/{readme,workflow}.test.ts,
  .github/workflows/{ci,ce}.yml, README.md, scripts/
Test framework: vitest 5 (per-workspace `vitest run`), fast-check 4 for properties
  (`*.property.test.ts`), tests co-located next to source as `<name>.test.ts`, real temp dirs via
  mkdtempSync(os.tmpdir()) + rmSync in afterEach (src/config/file.test.ts), CLI child-process tests
  via tsx (src/cli.env.test.ts). Workflow/README structure tests live in action/workflow.test.ts and
  action/readme.test.ts (parse YAML with `yaml`).
File conventions: ESM + NodeNext `.js` import suffixes; commands are pure `runXCommand(argv, deps)`
  returning an exit code, writing through injected `stdout`/`stderr` `{ write(text) }`; header comment
  cites requirement ids; English everywhere.
Existing helpers: readAndParseConfigFile + discoverConfigFile (src/config/file.ts), ConfigSchema
  (src/config/schema.ts), loadConfig (src/config/load.ts; exported from src/index.ts),
  ConfigDefaults (src/config/defaults.ts — source of default values for commented examples).
Library docs checked:
  - Node.js v22 fs (Context7 /websites/nodejs_latest-v22_x_api): flag 'wx' fails if path exists
    (EEXIST; O_EXCL also errors on a symlink, even dangling); rename overwrites a file and raises
    when newPath is a directory.
  - npm CLI 11.x (Context7 /npm/cli): prepack runs on `npm pack` and `npm publish`; npx picks the
    single bin entry. Empirical: npm 11.20.0 `npm pack --workspace continuous-evidence` works.
  - npm trusted publishing (Context7 /websites/npmjs, docs.npmjs.com/trusted-publishers): needs
    `id-token: write`, GitHub-hosted runner, Node 24 / npm >= 11.5.1, a matching `repository`; no
    first publish via OIDC (npm/cli#8544).
  - yaml@2, zod@4, vitest@5, fast-check@4: existing repo usage only, no new API surface.
Key findings:
  - action/workflow.test.ts asserts ci.yml text does NOT contain "rfxlamia/ce" → the smoke job must
    not mention that string.
  - action/readme.test.ts treats the FIRST README ```yaml block containing "rfxlamia/ce@" as the
    Action example → Quick start must not add such a block before the GitHub Action section.
  - dist currently ships 726 test artifacts; *arbitraries.ts import fast-check (devDependency).
  - vitest config already excludes dist/**.
Unverified areas: trusted-publisher 48 h expiry (secondary source) → affects T8 runbook wording only;
  localhost vs 127.0.0.1 → verified by T9 keyed run.
```

## SPEC PARSED

```
SPEC PARSED: ce init and npm distribution
Design: Option A — pure detector + string template + separate build tsconfig
Constraints: new src/init/**; pure command with injected deps; no run-pipeline / ConfigSchema /
  action-bundle changes; no new dependencies
Rules: 25 (A1–A8, A2a, B0–B6, C1–C3, D1–D6) | GWT coverage: all rules have GWT or are covered by
  a sibling scenario; D3 (package.json fields) derived; 4 negative (B1, B2, C3, A6)
Open questions: 7 (all resolved/assumed in spec; tag namespace decided: semver vX.Y.Z)
Rollback plan: present
Conflicts: none
```

---

## Execution Overview

### Recommended Order
```
T1, T2 (parallel) → T3, T4 (parallel, after T2) → T5 → T6 → T7 → T8 → T9
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T2 | start |
| Group B | T3, T4 | T2 completes |

### Constraints Reminder
**Architecture:** `ce init` lives in `packages/ce/src/init/**`; `runInitCommand(argv, deps)` is pure (no `process.*`); generated YAML values come only from fixed tokens + validated integer port; no edits to the run pipeline, `ConfigSchema` semantics, or `action/src` / `action/dist`; no new dependencies.
**Out-of-scope:** running `npm publish`; non-JS detection; wizard/prompts; writing `.gitignore`/`.env`/workflow files; `init` running network commands; fixing the README Action snippet; monorepo detection.
**Assumptions at risk:** `localhost` URL (T9 verifies); Chromium download time within the 2-minute budget (T9 measures).
**Sequencing:** Dependency order shown is recommended only — pocket enforces actual blocking rules.

### File Structure Map

```
Rule: D1–D3 packaging (lean tarball, prepack, metadata)
  Create: packages/ce/tsconfig.build.json            (created by: T1)
  Create: packages/ce/README.md                      (created by: T1)
  Create: packages/ce/LICENSE                        (created by: T1)
  Modify: packages/ce/package.json
  Test:   packages/ce/src/package-manifest.test.ts   (created by: T1)

Rule: A1–A3, A2a, A8 detection
  Create: packages/ce/src/init/detect.ts             (created by: T2)
  Test:   packages/ce/src/init/detect.test.ts        (created by: T2)
  Test:   packages/ce/src/init/detect.property.test.ts (created by: T2)

Rule: A4–A7 template
  Create: packages/ce/src/init/template.ts           (created by: T3)
  Test:   packages/ce/src/init/template.test.ts      (created by: T3)
  Test:   packages/ce/src/init/template.property.test.ts (created by: T3)

Rule: C1–C3 next steps + workflow snippet
  Create: packages/ce/src/init/next-steps.ts         (created by: T4)
  Test:   packages/ce/src/init/next-steps.test.ts    (created by: T4)

Rule: B0–B6 command, overwrite guard, CLI wiring
  Create: packages/ce/src/init/command.ts            (created by: T5)
  Create: packages/ce/src/init/index.ts              (created by: T5)
  Modify: packages/ce/src/cli.ts                     (switch case + help text)
  Test:   packages/ce/src/init/command.test.ts       (created by: T5)
  Test:   packages/ce/src/cli.init.test.ts           (created by: T5)

Rule: D2, D4 smoke test + CI job
  Create: scripts/smoke-pack.mjs                     (created by: T6)
  Create: scripts/smoke-pack-checks.mjs              (created by: T6)
  Create: action/smoke-pack.test.ts                  (created by: T6)
  Modify: .github/workflows/ci.yml                   (new job `smoke-pack`)
  Modify: action/workflow.test.ts                    (ci.yml smoke-job assertions)

Rule: D5 release workflow
  Create: scripts/release-tag.mjs                    (created by: T7)
  Create: .github/workflows/release.yml              (created by: T7)
  Create: action/release-tag.test.ts                 (created by: T7)
  Modify: action/workflow.test.ts                    (release.yml assertions)

Rule: D6 README
  Modify: README.md
  Modify: action/readme.test.ts                      (Quick start + Releasing assertions)

Rule: Done-when timing + localhost verification
  Create: docs/pocket/plans/2026-11-28-ce-init-onboarding/verification.md   (created by: T9; copied into PR body)
```

---

## Pocket Packets

---

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

---

### Task 2: Project detection (package manager, script, port, framework) [prereq]

## OBJECTIVE
Create the pure detector `packages/ce/src/init/detect.ts` and its exported result type, used by T3/T4/T5.

Exported contract (shared interface for later tasks):
`detectProject(input: { packageJsonText: string | null; files: ReadonlySet<string> }): Detection`
where `files` holds the cwd entry names that matter (lockfiles) and `Detection` is
`{ status: 'detected'; pm: 'npm'|'pnpm'|'yarn'|'bun'; pmMajor: number | null; script: 'dev'|'start'; port: number; portSource: 'explicit'|'framework'|'unknown'; framework: string | null; hasLockfile: boolean; ceInstalled: boolean; scriptText: string }`
or `{ status: 'fallback'; reason: 'missing'|'unparseable'|'not-object'|'no-script'; pm; pmMajor; hasLockfile; ceInstalled: boolean }`.

Steps:
1. Write failing test for: vite with npm
   Test file: `packages/ce/src/init/detect.test.ts`
   Level: unit
   Test intent: Given packageJsonText `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6"}}` and files {package-lock.json} / When detectProject / Then status detected, pm npm, script dev, port 5173, portSource framework, framework "vite", hasLockfile true, ceInstalled false
   Exercise through: `detectProject`
   Test doubles: none (pure)
   Expected RED: module `src/init/detect.ts` does not exist
2. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/detect.test.ts`
3. Implement minimal detector → PASS. Commit `feat(init): detect vite dev server`.
4. Write failing test for: explicit ports and earliest-match rule (A3)
   Test file: `packages/ce/src/init/detect.test.ts`
   Level: unit
   Test intent: Given dev "next dev -p 4000" + pnpm-lock.yaml / When detect / Then pm pnpm, port 4000 explicit. Given "vite --port=8080" → 8080. Given "PORT=5000 node server.js" → 5000 explicit, framework null. Given "PORT=4100 vite --port 4200" → 4100. Given "vite --port 70000" → 5173 framework. Given "vite --port 0" / "--port $PORT" / "PORT=abc vite" → 5173 framework
   Exercise through: `detectProject`
   Test doubles: none
   Expected RED: explicit-port parsing not implemented
5. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/detect.test.ts -t "explicit"`
6. Implement port parsing (earliest position across patterns, integer 1–65535) and the framework table (vite/@sveltejs/kit 5173, next 3000, nuxt/nuxi 3000, astro 4321, @angular/cli `ng serve` 4200, react-scripts 3000, gatsby 8000; script command tokens first, then dependencies) → PASS → refactor while green. Commit `feat(init): detect explicit and framework ports`.
7. Write failing test for: script and package-manager selection (A1, A2, A2a)
   Test file: `packages/ce/src/init/detect.test.ts`
   Level: unit
   Test intent: Given only start "react-scripts start" → script start, port 3000, framework react-scripts. Given dev "  " and start "vite" → script start. Given dev "node server.js" → port 3000, portSource unknown. Given packageManager "yarn@4.1.0" + package-lock.json → pm yarn, pmMajor 4. Given packageManager 42 + pnpm-lock.yaml → pm pnpm. Given yarn.lock only → yarn, pmMajor null. Given bun.lock → bun; bun.lockb → bun. Given devDependencies {"continuous-evidence":"^0.1.0"} → ceInstalled true; Given dependencies "x" (string) → treated as empty, no throw
   Exercise through: `detectProject`
   Test doubles: none
   Expected RED: start fallback / packageManager / ceInstalled handling missing
8. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/detect.test.ts -t "selection"`
9. Implement → PASS → refactor while green. Commit `feat(init): choose script and package manager`.
10. Write failing test for: fallback cases (A8) and BOM
    Test file: `packages/ce/src/init/detect.test.ts`
    Level: unit
    Test intent: Given packageJsonText null → fallback reason missing. Given "{ not json" → unparseable. Given "[]" or "42" → not-object. Given {"scripts":"x"} or {"scripts":{}} → no-script. Given "﻿" + {"scripts":{"dev":"vite"}} → detected, port 5173
    Exercise through: `detectProject`
    Test doubles: none
    Expected RED: fallback branches / BOM stripping missing
11. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/detect.test.ts -t "fallback"`
12. Implement → PASS → refactor while green. Commit `feat(init): fall back when package.json is unusable`.
13. Write failing test for: detector never throws and port is always valid (property)
    Test file: `packages/ce/src/init/detect.property.test.ts`
    Level: unit (property)
    Test intent: Given arbitrary strings / JSON values as packageJsonText and arbitrary subsets of lockfile names / When detectProject / Then it returns without throwing; when detected, port is an integer in 1..65535, script ∈ {dev,start}, pm ∈ {npm,pnpm,yarn,bun}
    Exercise through: `detectProject`
    Test doubles: none
    Expected RED: fails if any input path throws (e.g. non-string script values)
14. Run test — verify: `cd packages/ce && npx vitest run src/init/detect.property.test.ts`; fix any counterexample, refactor while green, commit `test(init): property-check project detection`.

## REFERENCES LOADED
Spec — rules A1, A2, A2a, A3, A8; scenarios vite with npm, explicit -p with pnpm, --port= form, PORT env prefix, earliest explicit port wins, invalid explicit port, start script with react-scripts, empty dev script, unknown server, packageManager field wins, wrong-typed packageManager, no package.json, malformed package.json, BOM-prefixed package.json
packages/ce/src/run/command.ts (pure-function conventions), packages/ce/src/context/candidates.properties.test.ts (fast-check style)

## WHY THIS APPROACH
Complexity: standard
Justification: branching parsing rules with precedence and boundary values.

## SANDWICH CONTEXT
[CRITICAL: detectProject is pure — no fs, no process.*; it returns data, never YAML text]
You are implementing project detection for `ce init`.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: Option A — pure detector; no package-manager-detector dependency
Files in scope: packages/ce/src/init/detect.ts, detect.test.ts, detect.property.test.ts
Available after: none (prereq)
Architecture rule: the Detection type is the shared contract for T3, T4, T5 — keep it exported and stable
[RESTATE: pure — no fs, no process.*, no new dependencies]

## DELIVERABLE
Given package.json {"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6"}} and package-lock.json, When detect, Then npm / dev / 5173 / vite
Given scripts.dev "next dev -p 4000" and pnpm-lock.yaml, Then pnpm / 4000
Given "vite --port=8080" → 8080; "PORT=5000 node server.js" → 5000; "PORT=4100 vite --port 4200" → 4100; "vite --port 70000" → 5173
Given only start "react-scripts start" → start / 3000 / react-scripts; dev "  " + start "vite" → start
Given "node server.js" → 3000 unknown; packageManager "yarn@4.1.0" → yarn; packageManager 42 + pnpm lock → pnpm
Given no / malformed / non-object package.json or no usable script → fallback with reason; BOM tolerated
[must-not] Given any input, When detect, Then it must NOT throw

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests before implementation; one RED cycle per scenario group
  - `scriptText` returned raw (sanitising is T3's job) — document that in a comment
Must-not-have:
  - Reading the filesystem
  - Monorepo/workspace detection
Open question risks:
  - Unknown port → 3000 assumption
Rollback note:
  - Additive module; revert the commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: all detect tests and the property test pass
Uncertain when: a spec scenario contradicts another (e.g. port precedence) → NEEDS_CONTEXT
Escalate when: implementation needs fs access or a dependency

---

### Task 3: Commented ce.yml template [depends: T2]

## OBJECTIVE
Create `packages/ce/src/init/template.ts`: `renderConfig(detection: Detection): string` producing the commented `ce.yml`.

Steps:
1. Write failing test for: detected vite project renders a valid target block
   Test file: `packages/ce/src/init/template.test.ts`
   Level: unit
   Test intent: Given the Detection for vite/npm/5173 / When renderConfig, then the text is written to a temp dir as ce.yml and read through `readAndParseConfigFile` + `ConfigSchema.safeParse` / Then it succeeds and the parsed value has target.start "npm run dev", target.url "http://localhost:5173", target.ready.path "/"; the text starts with a header comment linking the repo docs and `schemas/ce.schema.json`; a comment line mentions vite; the text contains commented example lines `# context:`, `# assessment:`, `# runtime:`, `# output:` and parsed config has none of those keys
   Exercise through: `renderConfig` + the real config reader/schema
   Test doubles: none
   Expected RED: module `src/init/template.ts` does not exist
2. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/template.test.ts`
3. Implement the template: fixed header; `version: 0`; `target:` with start `<pm> run <script>`, url `http://localhost:<port>`, `ready.path: /`, commented `ready.timeout: 30s`; commented examples for `context`, `assessment`, `runtime`, `output` using values from `ConfigDefaults`; detection hint comment `# Detected: <framework> (script "<script>": "<sanitised text>")`. → PASS. Commit `feat(init): render commented ce.yml`.
4. Write failing test for: unknown port and fallback rendering (A5, A8)
   Test file: `packages/ce/src/init/template.test.ts`
   Level: unit
   Test intent: Given Detection portSource unknown → url port 3000 and a comment containing "port not detected" and "check". Given each fallback reason → file parses + validates, has no active `target` key, the target block is present but commented out, and a comment explains the reason (missing / could not be parsed / no dev or start script)
   Exercise through: `renderConfig` + reader/schema
   Test doubles: none
   Expected RED: unknown/fallback branches not rendered
5. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/template.test.ts -t "fallback"`
6. Implement → PASS → refactor while green. Commit `feat(init): render unknown-port and fallback templates`.
7. Write failing test for: hostile script text cannot inject YAML (A6)
   Test file: `packages/ce/src/init/template.test.ts`
   Level: unit
   Test intent: Given Detection with scriptText "vite\nassessment: {thresholds: {claim: 9}}  # x" (and variants with \r,  , NUL, very long text) / When renderConfig / Then the output validates, parsed `assessment` is undefined, and the hint comment is a single line ≤ 120 chars of text after `# `
   Exercise through: `renderConfig` + reader/schema
   Test doubles: none
   Expected RED: unsanitised text splits the comment and injects a key (or schema fails)
8. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/template.test.ts -t "inject"`
9. Implement sanitiser (replace CR, LF, U+2028/U+2029 and other control chars with a space; cap 120 chars) → PASS → refactor while green. Commit `fix(init): sanitise detection hints in ce.yml comments`.
10. Write failing test for: every generated file is valid (property)
    Test file: `packages/ce/src/init/template.property.test.ts`
    Level: unit (property)
    Test intent: Given arbitrary package.json shapes (incl. scripts with newlines, '#', quotes, long text) and arbitrary lockfile subsets fed through `detectProject` / When renderConfig / Then `readAndParseConfigFile` + `ConfigSchema` accept the output, and when detected the parsed target.url is loopback `http://localhost:<1..65535>` paired with target.start
    Exercise through: `detectProject` → `renderConfig` → reader/schema
    Test doubles: none
    Expected RED: fails on any generated invalid file
11. Run test — verify: `cd packages/ce && npx vitest run src/init/template.property.test.ts`; fix counterexamples, refactor while green, commit `test(init): property-check generated ce.yml validity`.

## REFERENCES LOADED
Spec — rules A4, A5, A6, A7, A8; scenarios hostile script text cannot inject YAML, every generated file is valid, unknown server, no package.json, malformed package.json
packages/ce/src/config/file.ts (readAndParseConfigFile), src/config/schema.ts (ConfigSchema), src/config/defaults.ts (ConfigDefaults), schemas/ce.schema.json, src/runtime/target.ts (loopback rule)
packages/ce/src/init/detect.ts (created by: T2)

## WHY THIS APPROACH
Complexity: standard
Justification: security-relevant sanitising plus schema validity guarantees.

## SANDWICH CONTEXT
[CRITICAL: YAML values come only from fixed tokens (pm, script name) and the validated integer port — raw script text appears only inside a sanitised single-line comment]
You are implementing the ce.yml template for `ce init`.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: Option A — string template (rejected: yaml Document API)
Files in scope: packages/ce/src/init/template.ts, template.test.ts, template.property.test.ts
Available after: T2 (Detection type, detectProject)
Architecture rule: do not change ConfigSchema; the template must satisfy it as-is
[RESTATE: raw script text never becomes a YAML value]

## DELIVERABLE
Given vite/npm/5173 detection, When renderConfig, Then valid ce.yml with start "npm run dev", url "http://localhost:5173", ready.path "/", vite comment
Given unknown port, Then 3000 + "port not detected; check it" comment
Given any fallback reason, Then valid file with target commented out and a reason comment
[must-not] Given hostile script text, When renderConfig, Then output must NOT contain an injected key
Property: every generated file passes readAndParseConfigFile + ConfigSchema

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests before implementation; validation through the real reader + schema
  - Commented examples use ConfigDefaults values (no duplicated literals drifting from defaults where avoidable)
Must-not-have:
  - Editing ConfigSchema or defaults
  - Reimplementing detection logic (import from detect.ts)
Open question risks:
  - localhost assumption (T9 verifies) → if wrong, NEEDS_CONTEXT
Rollback note:
  - Additive; revert
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: template unit + property tests pass
Uncertain when: a commented example cannot be expressed without violating schema → NEEDS_CONTEXT
Escalate when: schema change seems required

---

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

---

### Task 5: `ce init` command, overwrite guard and CLI wiring [depends: T3, T4]

## OBJECTIVE
Create `packages/ce/src/init/command.ts` with `runInitCommand(argv, deps): Promise<number>` (or sync number) and `src/init/index.ts` re-export; route `init` in `src/cli.ts` and the help text.

Deps contract: `{ cwd: string; env: Record<string,string|undefined>; stdout: Writable; stderr: Writable; fs?: InitFs }` where `InitFs` = `{ lstat, stat, readFile, writeFile(path, data, { flag }), rename, unlink }` (sync, node:fs-compatible), defaulting to `node:fs` — injected only to simulate write failures.

Steps:
1. Write failing test for: init writes a detected config end to end (cross-unit: detect → template → next steps → fs)
   Test file: `packages/ce/src/init/command.test.ts`
   Level: integration
   Test intent: Given a temp dir with package.json {"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6"}} and package-lock.json / When runInitCommand([], deps with real fs) / Then exit 0, `ce.yml` exists and `loadConfig({ cwd, flags: {}, env: {} }).ok` is true with target.url http://localhost:5173, stdout contains next steps, stderr empty
   Exercise through: `runInitCommand`
   Test doubles: stdout/stderr capture objects only
   Expected RED: module does not exist
2. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/command.test.ts`
3. Implement the happy path only: read package.json, collect lockfile names, detect → render, create with `wx`, print next steps. Do NOT yet add argv validation, --force, read-error/unparseable notes or existence checks (each gets its own RED cycle below). → PASS → refactor while green. Commit `feat(init): add ce init command`.
4. Write failing test for: overwrite guard (B0, B1, B2, repeat run)
   Test file: `packages/ce/src/init/command.test.ts`
   Level: integration
   Test intent: Given ce.yml with custom content / When init / Then exit 1, file byte-identical, stderr "ce.yml already exists; re-run with --force to overwrite". Given only .ce.yml → exit 1, no ce.yml created, stderr names .ce.yml. Given init succeeded once, second run → exit 1, byte-identical. Given ce.yml is a directory → exit 1 with the same "already exists" message. Given a dangling symlink ce.yml → exit 1 "already exists". Given an injected fs whose `wx` write throws EEXIST (file appeared after the lstat check) → exit 1 with the same message, no overwrite
   Exercise through: `runInitCommand`
   Test doubles: injected `fs` only for the EEXIST race case
   Expected RED: the `.ce.yml`-only case creates a new ce.yml today (wx does not protect it), and no case prints the exact "already exists; re-run with --force to overwrite" message (wx surfaces a raw EEXIST)
5. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/command.test.ts -t "guard"`
6. Implement lstat-based existence check → PASS → refactor while green. Commit `feat(init): refuse to overwrite existing config`.
7. Write failing test for: --force semantics and atomic replace (B3, B5)
   Test file: `packages/ce/src/init/command.test.ts`
   Level: integration
   Test intent: Given ce.yml exists, `--force` → ce.yml replaced with generated content, exit 0. Given only .ce.yml, `--force` → .ce.yml rewritten, no ce.yml. Given both files, `--force` → ce.yml rewritten and stderr notes .ce.yml stays ignored. Given ce.yml directory + .ce.yml file, `--force` → .ce.yml rewritten, exit 0. Given ce.yml directory only, `--force` → exit 1, stderr names ce.yml and EISDIR, no temp file left in cwd. Given ce.yml exists and injected fs `rename` throws ENOSPC → original byte-identical, temp file removed, exit 1, stderr names ce.yml + ENOSPC, stdout has no success text. Given injected `writeFile` throws EACCES on create (no --force) → exit 1 with EACCES
   Exercise through: `runInitCommand`
   Test doubles: injected `fs` for ENOSPC / EACCES only
   Expected RED: --force not implemented
8. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/command.test.ts -t "force"`
9. Implement target selection via stat-isFile (mirrors discoverConfigFile), temp file `.<name>.<random>.tmp` in cwd, rename, cleanup on error → PASS → refactor while green. Commit `feat(init): replace config atomically under --force`.
10. Write failing test for: argv contract and fallback/stdout-stderr split (B4, B6, A8)
    Test file: `packages/ce/src/init/command.test.ts`
    Level: integration
    Test intent: Given `--bogus` or a positional `foo` → usage on stderr, exit 1, no file. Given empty dir → exit 0, template written, next steps start with "edit target in ce.yml". Given package.json "{ not json" → exit 0, stderr contains "package.json could not be parsed", stdout has next steps. Given package.json is a directory (unreadable) → exit 0, template written, stderr notes package.json could not be read. Given deps.env OPENROUTER_API_KEY "sk-test-123" with a vite project → exit 0 and neither captured stdout nor stderr contains "sk-test-123" (C3 through the command path)
    Exercise through: `runInitCommand`
    Test doubles: none
    Expected RED: today `--bogus` and positional args are ignored and a file is written (exit 0), and no stderr note is printed for unparseable or unreadable package.json
11. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/command.test.ts -t "argv"`
12. Implement → PASS → refactor while green. Commit `feat(init): handle usage errors and unusable package.json`.
13. Write failing test for: CLI routes `ce init`
    Test file: `packages/ce/src/cli.init.test.ts`
    Level: integration (child process via tsx, as src/cli.env.test.ts)
    Test intent: Given a temp dir with a vite package.json / When `tsx src/cli.ts init` / Then exit 0 and ce.yml exists; When `tsx src/cli.ts --help` / Then help lists `ce init [--force]`; When `tsx src/cli.ts init` again / Then exit 1. Given a fresh temp dir that also has `.env` containing `OPENROUTER_API_KEY=sk-or-DOTENV-0123456789abcdef` and the child env has no key / When `tsx src/cli.ts init` / Then exit 0, stdout/stderr contain no `sk-or-DOTENV` text, and the next steps do NOT say the key is already set (init does not load .env)
    Exercise through: the CLI entry `src/cli.ts`
    Test doubles: none (OPENROUTER_API_KEY removed from child env)
    Expected RED: "Unknown command: init"
14. Run test — verify FAIL: `cd packages/ce && npx vitest run src/cli.init.test.ts`; then add the `case 'init'` (no .env loading) + help line → PASS; run full `cd packages/ce && npx vitest run` and `npm run typecheck`; commit `feat(cli): route ce init`.

## REFERENCES LOADED
Spec — rules B0–B6, A8, C1; scenarios existing ce.yml is protected, existing .ce.yml is protected, second run is a no-op, --force replaces ce.yml, --force rewrites .ce.yml in place, unknown flag, ce.yml is a directory (both), directory ce.yml beside .ce.yml, write fails mid --force, malformed package.json
packages/ce/src/cli.ts, src/run/command.ts (USAGE/parse pattern), src/config/file.ts (discoverConfigFile isFile rule), src/config/load.ts (loadConfig), src/cli.env.test.ts (child-process pattern)
Node.js v22 fs docs (Context7): 'wx' → EEXIST (also on symlinks), rename overwrites files, errors on directory target
packages/ce/src/init/{detect,template,next-steps}.ts (created by: T2, T3, T4)

## WHY THIS APPROACH
Complexity: standard
Justification: file-system edge cases, atomicity, and cross-unit composition.

## SANDWICH CONTEXT
[CRITICAL: never overwrite an existing config without --force; under --force, the original must survive any write failure]
You are implementing the `ce init` command for issue #13.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: Option A — pure command with injected deps
Files in scope: packages/ce/src/init/command.ts, src/init/index.ts, src/init/command.test.ts, src/cli.ts, src/cli.init.test.ts
Available after: T3 (renderConfig), T4 (renderNextSteps)
Architecture rule: runInitCommand uses no process.*; only cli.ts reads process.argv/cwd/env
[RESTATE: never overwrite without --force; original survives failed --force writes]

## DELIVERABLE
Given vite project, When `ce init`, Then ce.yml written, loadConfig ok, exit 0
Given ce.yml or .ce.yml (file, dir or symlink) exists, When `ce init`, Then exit 1, unchanged, stderr names file + --force
Given --force, Then the discovered file is replaced atomically; directory target → EISDIR exit 1; rename failure → original intact, no temp file
Given unknown flag/positional, Then usage, exit 1, no file
Given empty dir / malformed package.json, Then template written, exit 0 (+ stderr note when malformed)
[must-not] Given a file appears between check and create, Then it must NOT be overwritten

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Import detect/template/next-steps; no duplicated logic
  - Success text on stdout, errors/notes on stderr
Must-not-have:
  - .env loading for init; network commands; writing .gitignore/.env/workflows
  - Changing discoverConfigFile or run behaviour
Open question risks:
  - none identified
Rollback note:
  - Revert; command is additive
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: command + CLI tests pass; full packages/ce test suite and typecheck green
Uncertain when: platform rename semantics differ (Windows) → DONE_WITH_CONCERNS noting it
Escalate when: guard behaviour conflicts with discoverConfigFile

---

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

---

### Task 7: OIDC release workflow [depends: T6]

## OBJECTIVE
Create `scripts/release-tag.mjs` (tag/version guard + dist-tag decision) and `.github/workflows/release.yml`.

`release-tag.mjs <tag>`: reads `packages/ce/package.json` version; if tag ≠ `v<version>` → stderr names both, exit 1; else prints `latest` or `next` (prerelease when version contains `-`) to stdout, exit 0.

Steps:
1. Write failing test for: version mismatch blocks release / prerelease goes to next
   Test file: `action/release-tag.test.ts`
   Level: unit (child process `node scripts/release-tag.mjs`)
   Test intent: Given a temp copy layout or a `--package <path>` arg pointing to a package.json with version 0.1.0 / When run with tag v0.2.0 → exit 1, stderr names v0.2.0 and 0.1.0; with v0.1.0 → stdout "latest"; with version 0.2.0-rc.1 and tag v0.2.0-rc.1 → stdout "next"; with tag "v0" → exit 1; with tag "v0.1.0abc" (matches the trigger glob) → exit 1
   Exercise through: the script CLI
   Test doubles: temp package.json files
   Expected RED: script does not exist
2. Run test — verify FAIL: `cd action && npx vitest run release-tag.test.ts`
3. Implement script (default package path `packages/ce/package.json`, optional `--package`) → PASS. Commit `ci: add release tag guard`.
4. Write failing test for: release workflow shape
   Test file: `action/workflow.test.ts`
   Level: unit (workflow structure)
   Test intent: Given release.yml parsed / Then trigger is only `push.tags: ['v[0-9]+.[0-9]+.[0-9]+*']` (no pull_request, pull_request_target, issue_comment); permissions `id-token: write`, `contents: read`; runs-on ubuntu-latest; setup-node node 24 with `registry-url: https://registry.npmjs.org` and no cache; step order: release-tag guard is the first run step after checkout/setup-node, then npm ≥ 11.5.1 ensure step, `npm ci`, `npx playwright install --with-deps chromium`, typecheck, test, build, `node scripts/smoke-pack.mjs`, then `npm publish --workspace continuous-evidence --access public --tag <guard output>`; no `NODE_AUTH_TOKEN` / `secrets.NPM_TOKEN` anywhere; file text has no "rfxlamia/ce@". Tag filter semantics: translate the `push.tags` pattern with GitHub filter rules (`*` = zero or more non-`/` chars, `+` = one or more of the preceding char/class, `[0-9]` class, `.` literal) into a regex and assert `v0`, `v1`, `latest`, `release-1` do NOT match while `v0.1.0`, `v0.2.0-rc.1`, `v10.20.30` match. Guard→publish seam: the guard step has `id: tag` and writes `dist-tag=` to `$GITHUB_OUTPUT`; the publish step uses `--tag ${{ steps.tag.outputs.dist-tag }}`; the guard step index is lower than npm ci, playwright install, test, smoke and publish
   Exercise through: the parsed workflow file
   Test doubles: none
   Expected RED: release.yml does not exist
5. Run test — verify FAIL: `cd action && npx vitest run workflow.test.ts -t "release"`
6. Implement release.yml (actions pinned to the same SHAs as ci.yml; guard step `id: tag` writes `dist-tag=$(node scripts/release-tag.mjs "$GITHUB_REF_NAME")` to `$GITHUB_OUTPUT`; npm step: `npm --version` compared to 11.5.1, `npm install -g npm@^11.5.1` only when older) → PASS. Commit `ci: publish continuous-evidence via npm trusted publishing (#13)`.

## REFERENCES LOADED
Spec — rule D5; scenarios version mismatch blocks release, prerelease goes to next; Open Questions row "Release tag namespace" (user decision: semver vX.Y.Z)
docs.npmjs.com/trusted-publishers (Context7 /websites/npmjs): id-token write, Node 24, registry-url, no cache
.github/workflows/ci.yml (pinned action SHAs), action/workflow.test.ts
scripts/smoke-pack.mjs (created by: T6)

## WHY THIS APPROACH
Complexity: standard
Justification: security-sensitive CI; logic extracted to a testable script.

## SANDWICH CONTEXT
[CRITICAL: release.yml must never trigger on floating tags (v0), pull_request, pull_request_target or issue_comment, and must use no stored npm token]
You are implementing the release workflow for continuous-evidence.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: OIDC trusted publishing for releases after the manual first publish
Files in scope: scripts/release-tag.mjs, .github/workflows/release.yml, action/release-tag.test.ts, action/workflow.test.ts
Available after: T6 (smoke script)
Architecture rule: workflows must not touch action/dist
[RESTATE: semver-only trigger; no stored npm token]

## DELIVERABLE
Given tag v0.2.0 and package.json 0.1.0, When release.yml runs, Then it fails before npm publish
Given tag v0.2.0-rc.1 matching package.json, When publishing, Then `--tag next`
[must-not] Given the floating tag v0 is moved, Then release.yml must NOT run
[derived] Given release.yml, Then no NODE_AUTH_TOKEN/NPM_TOKEN secret is referenced

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Guard runs first so a mismatch fails in seconds
  - Chromium installed before tests
Must-not-have:
  - Running the workflow or publishing
Open question risks:
  - The workflow cannot be exercised end-to-end until the first manual publish + trusted publisher setup
Rollback note:
  - Delete or disable release.yml; publishing falls back to the manual runbook
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: release-tag and workflow tests pass
Uncertain when: GitHub tag-filter glob semantics reject the pattern → NEEDS_CONTEXT
Escalate when: a token-based publish seems required

---

### Task 8: README Quick start and Releasing runbook [depends: T7]

## OBJECTIVE
Update root `README.md` with a Quick start, the bare-`npx ce` warning and a maintainer Releasing runbook.

Steps:
1. Write failing test for: README Quick start and runbook content
   Test file: `action/readme.test.ts`
   Level: unit (document structure)
   Test intent: Given README.md / Then a `## Quick start` section precedes `## GitHub Action` and contains `npm i -D continuous-evidence`, `npx ce init`, `npm i -g continuous-evidence && ce init`, `npx continuous-evidence init`, and a warning naming bare `npx ce` and the unrelated `ce` package; Quick start contains no ```yaml block with "rfxlamia/ce@" (so the existing Action-example test still finds the Action section block first); a `## Releasing` section contains `npm login`, `npm publish --workspace continuous-evidence --access public`, "trusted publisher", `release.yml`, the semver tag form `vX.Y.Z`, and a note that one tag releases the Action and npm together; existing README tests stay green
   Exercise through: README text
   Test doubles: none
   Expected RED: sections absent
2. Run test — verify FAIL: `cd action && npx vitest run readme.test.ts`
3. Edit README: replace "Run the CE CLI (stub for now)" guidance with real usage; add Quick start (install, `npx ce init`, set key, `npx playwright install chromium`, `npx ce run`); warning; Releasing runbook steps 1–5 from spec D6 (first publish manual after merge; configure trusted publisher, then tag promptly — config may expire if unused; optionally "Require 2FA and disallow tokens"). → PASS. Commit `docs(readme): add Quick start and release runbook (#13)`.

## REFERENCES LOADED
Spec — rule D6; Open Questions rows (tag namespace, 48 h expiry — secondary source, phrase as "may expire")
README.md, action/readme.test.ts
.github/workflows/release.yml (created by: T7)

## WHY THIS APPROACH
Complexity: lightweight
Justification: documentation with structural assertions.

## SANDWICH CONTEXT
[CRITICAL: do not place a yaml block containing "rfxlamia/ce@" before the GitHub Action section, and do not change the existing Action example]
You are updating the README for issue #13.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: README carries Quick start + runbook; publish stays manual for the first release
Files in scope: README.md, action/readme.test.ts
Available after: T7
Architecture rule: existing README tests must keep passing unchanged
[RESTATE: no new rfxlamia/ce@ yaml block before the Action section; Action example untouched]

## DELIVERABLE
Given README, Then Quick start shows npm i -g continuous-evidence && ce init, npx continuous-evidence init, and the bare npx ce warning
Given README, Then Releasing documents the exact first-publish command and the OIDC release flow

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - English prose, concise
Must-not-have:
  - Fixing the existing Action snippet (out of scope)
Open question risks:
  - none identified
Rollback note:
  - Revert
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: readme tests pass (old and new)
Uncertain when: none
Escalate when: existing README tests must change to pass

---

### Task 9: Done-when verification (keyed live run and timing) [depends: T6, T8]

## OBJECTIVE
Measure "fresh repo → first `ce run` < 2 minutes" and verify the `localhost` assumption, then record the result for the PR body. [no-tdd — structural task]

Steps:
1. Ask the user for explicit approval to use their `OPENROUTER_API_KEY` (from the root `.env`) for one live run. Without approval, record "keyed run not performed" and the unkeyed smoke timing only.
2. With approval: in a scratch dir, `npm pack --workspace continuous-evidence`; create a git repo with a minimal vite app (package.json `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6"}}`, `index.html`, one commit, one change on a branch); time `npm i -D <tgz>` → `npx playwright install chromium` → `npx ce init` → `npx ce run --claim "<simple visible claim>"` with the key passed via env (never printed). Verify: exit outcome is not a config/target ERROR, target readiness on http://localhost:5173 succeeded.
3. If readiness fails on localhost → stop, report NEEDS_CONTEXT with the evidence (spec says switch template to 127.0.0.1 + `--host` guidance).
4. Record elapsed times per step and total into `docs/pocket/plans/2026-11-28-ce-init-onboarding/verification.md` for the PR body; commit `docs(pocket): record ce init onboarding timing (#13)`.

## REFERENCES LOADED
Spec — Acceptance Criteria "Done-when timing"; Open Questions rows localhost and Chromium download time
.github/workflows/ce.yml (127.0.0.1 precedent), scripts/smoke-pack.mjs (created by: T6)

## WHY THIS APPROACH
Complexity: lightweight
Justification: measurement only; behaviour already covered by tests.

## SANDWICH CONTEXT
[CRITICAL: never use or print the API key without explicit user approval in this session]
You are verifying the issue #13 "Done when" criterion.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: measurement recorded in PR body
Files in scope: docs/pocket/plans/2026-11-28-ce-init-onboarding/verification.md, scratch dir
Available after: T6, T8
Architecture rule: no code changes in this task
[RESTATE: key use requires explicit approval; never print it]

## DELIVERABLE
Given a fresh vite repo, When install → chromium → init → run, Then total time is recorded and compared to 2 minutes
Given the generated localhost URL, When ce run starts the dev server, Then readiness succeeds (or NEEDS_CONTEXT with evidence)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - [no-tdd — structural task]
  - Times reported honestly, including network-dependent Chromium download
Must-not-have:
  - Code changes; committing the key or run artifacts
Open question risks:
  - localhost resolves to ::1 while vite binds 127.0.0.1 → NEEDS_CONTEXT
Rollback note:
  - n/a
Red flags:
  - Key appears in any output → STOP

## STOP CONDITIONS
Done when: verification.md records the measured run (or the documented reason it was skipped)
Uncertain when: total exceeds 2 minutes mainly due to network → DONE_WITH_CONCERNS with breakdown
Escalate when: localhost readiness fails

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Lean, publishable package manifest | prereq | lightweight | dry-run pack has 0 test artifacts |
| T2 | Project detection | prereq | standard | vite/npm → 5173; never throws |
| T3 | Commented ce.yml template | T2 | standard | every output passes ConfigSchema; no injection |
| T4 | Next-steps text + workflow snippet | T2 | standard | install table; key never echoed |
| T5 | `ce init` command + CLI wiring | T3, T4 | standard | guard, --force atomicity, CLI routes init |
| T6 | Tarball smoke test + CI job | T1, T5 | standard | pack → install → init → run(no key) |
| T7 | OIDC release workflow | T6 | standard | version guard; semver-only trigger |
| T8 | README Quick start + runbook | T7 | lightweight | readme tests |
| T9 | Done-when verification | T6, T8 | lightweight | measured keyed run < 2 min |
