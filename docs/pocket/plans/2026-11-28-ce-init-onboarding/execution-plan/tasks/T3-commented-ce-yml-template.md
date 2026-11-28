# Task T3 — Commented ce.yml template

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
