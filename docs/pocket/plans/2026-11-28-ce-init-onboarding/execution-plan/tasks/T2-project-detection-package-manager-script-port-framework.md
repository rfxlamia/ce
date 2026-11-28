# Task T2 — Project detection (package manager, script, port, framework)

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
