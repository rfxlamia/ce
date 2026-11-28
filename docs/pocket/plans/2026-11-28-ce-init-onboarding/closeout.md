# Pocket Closeout — `ce init` and npm distribution (issue #13)

- **Plan:** docs/pocket/plans/2026-11-28-ce-init-onboarding
- **Type:** phased
- **Started:** 2026-11-28
- **Baseline:** `7c8d274`

This journal records phase outcomes as they are closed. Each section separates verified work, review evidence, documented obstacles and decisions, and optional recommendations. Read the phase sections for current progress.

## Phase 1 of 2 — Packaging and `ce init` building blocks
<!-- pocket-closeout:phase-1 -->

**Status:** Complete — `REVIEW` → `DONE`
**Closed:** 2026-11-28T00:35:56Z

### What was completed

- **T1 — Lean, publishable package manifest:** the `continuous-evidence` package now builds from a separate `tsconfig.build.json` that leaves test files out, cleans `dist` before packing, and carries repository, homepage, bugs, keywords, README and LICENSE (`6b7fc3f`).
- **T2 — Project detection:** a pure detector reads `package.json` text and lockfile names and reports the package manager, the dev/start script, the port and any framework hint, or a fallback reason (`ce8213f`).
- **T3 — Commented ce.yml template:** renders a `ce.yml` that passes the real config reader and schema, with detection hints sanitised into single-line comments and the target commented out in fallback cases (`24b1ef6`).
- **T4 — Next-steps text and workflow snippet:** prints the onboarding steps (API key, Chromium, `.gitignore`, run command) and a GitHub workflow snippet whose install step depends on the package manager, without ever echoing secret values (`4c33a47`).

### Review and verification

- Task verdicts: all current verdicts are REVIEW_PASS (T1 at `6b7fc3f`; T2–T4 at correction `60ccbaf`).
- Phase-level review: PHASE_PASS_RESOLVED.
- Corrections: 1 — `60ccbaf` (attributed to T2, also affecting T3 and T4).
- Recorded checks: root typecheck and `npm test` passed after T4; `src/init` suite (91 tests) and `tsc --noEmit` passed after the correction; the dry-run pack listed 246 files (previously 970) with no test artifacts and `dist/cli.js` carrying the shebang.

### Obstacles and resolution

- The T4 workflow snippet used a bare `pnpm/action-setup@v4`, which fails when `package.json` has no `packageManager` field. In-loop fix `4c33a47` adds `version: 10` in that case only, and spec rule C2 was amended (`754e837`).
- The phase-level pass found that an unreadable `package.json` was reported as "not found", contrary to spec A8. Correction `60ccbaf` adds an `unreadable` reason, makes the fallback next step name the actual config file, and removes a duplicated default-port constant.

### Decisions

- User: haiku subagents for easy tasks, sonnet otherwise, opus for phase-level passes (user instruction, 2026-11-28).
- Implementation: pin pnpm `version: 10` with a "match your pnpm version" comment when `packageManager` is absent (T4 audit, cycle 1).

### Suggestions

- Suggestion: T5 must set `packageJsonUnreadable` when reading `package.json` fails with anything other than ENOENT (T2 correction-audit Minor).
- Suggestion: consider stripping quotes and parentheses from explicit port captures, and requiring `serve` after `ng` (T2 review Minors).

### Next

Phase 2 — `ce init` command, smoke test, release workflow, README and live verification — is `WAITING` and continues under the same end-to-end authorization.
