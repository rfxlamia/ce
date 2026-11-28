# Task T9 — Done-when verification (keyed live run and timing)

**Phase:** 2
**Depends:** T6, T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
