# Task T7 — OIDC release workflow

**Phase:** 2
**Depends:** T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
