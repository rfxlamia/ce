# Task T8 — README Quick start and Releasing runbook

**Phase:** 2
**Depends:** T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
