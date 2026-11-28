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

## Phase 2 of 2 — `ce init` command, smoke test, release workflow, README and live verification
<!-- pocket-closeout:phase-2 -->

**Status:** Complete — `REVIEW` → `DONE`
**Closed:** 2026-11-28T01:20:40Z

### What was completed

- **T5 — `ce init` command and CLI wiring:** `ce init [--force]` reads `package.json` and lockfiles, refuses to overwrite `ce.yml`/`.ce.yml` without `--force`, replaces atomically with `--force`, and prints next steps (`9d430dc`).
- **T6 — Tarball smoke test:** `scripts/smoke-pack.mjs` packs, installs into a temp git app, and checks the bin, `init`, the overwrite guard and a keyless run; a `smoke-pack` CI job runs it (`09617dd`).
- **T7 — OIDC release workflow:** `release.yml` publishes `continuous-evidence` with npm trusted publishing on semver tags `vX.Y.Z`, guarded by `scripts/release-tag.mjs` (tag must equal the package version; prereleases go to `next`) (`818bc0b`).
- **T8 — README:** Quick start with the bare `npx ce` warning, and a maintainer Releasing runbook (`19a54ea`, correction `a1dc69d`).
- **T9 — Done-when verification:** a keyed live run in a fresh vite app took 15 s from `npm i -D` to the first `ce run` result (Chromium cached), with localhost readiness confirmed (`4b02781`).

### Review and verification

- Task verdicts: all current verdicts are REVIEW_PASS (T5 at correction `b3f63fb`, T8 at correction `a1dc69d`, T6/T7/T9 at their done SHAs).
- Phase-level review: PHASE_PASS_RESOLVED.
- Corrections: 2 — `b3f63fb` (T5, Action bundle rebuild) and `a1dc69d` (T8, `v0` tag step).
- Recorded checks: root `npm run typecheck` and `npm test` exit 0 after corrections (1489 + 63 + 163 tests); `node scripts/smoke-pack.mjs` SMOKE OK; keyed live run Outcome EVIDENCED in `verification.md`.

### Obstacles and resolution

- T5's audit flagged an over-long `runInitCommand` and several fs edge cases; in-loop refactor `9d430dc` split it into helpers and hardened them.
- The phase-level pass found `action/dist` stale after T5 changed `cli.ts`, which broke `npm test` and would have failed the release workflow's Test step. Correction `b3f63fb` rebuilt the bundle.
- The README implied one tag also updates `rfxlamia/ce@v0` users; correction `a1dc69d` adds a step moving the `v0` major tag.

### Decisions

- User: first npm publish is manual by the maintainer after merge; later releases use `release.yml` with OIDC trusted publishing and no token.
- User: release tags are semver `vX.Y.Z`.
- User: approved one keyed live run for the T9 timing.
- Implementation: the runbook bumps the package version before the first tag, because 0.1.0 is published by hand (T8, confirmed by audit).

### Suggestions

- Suggestion: move `v0` only after the release workflow succeeds, and never for prerelease tags (T8 correction audit, P2-F4).
- Suggestion: the generated `ce.yml` header points at `schemas/ce.schema.json`, which is not shipped; link the repository URL instead (phase-2 pass note, Phase 1 carry-over).
- Suggestion: measure a cold Chromium download once to confirm the 2-minute budget without a cache (P2-F3).
- Suggestion: set `package-manager-cache: false` on setup-node in `release.yml` for parity with npm's example (T7 review).

### Next

All phases are complete.

## Plan complete
<!-- pocket-closeout:plan -->

**Closed:** 2026-11-28 — 2 phases, 9 tasks, all REVIEW_PASS; 3 corrections (`60ccbaf`, `b3f63fb`, `a1dc69d`).

Issue #13's acceptance criteria are covered: `ce init` detection and commented `ce.yml`, the `--force` guard, next steps with the key env var and workflow snippet, a lean `continuous-evidence` package with a shebanged `dist/cli.js`, the tarball smoke test, the publish command and OIDC release workflow, the README Quick start with the bare `npx ce` warning, and a measured 15 s install-to-first-run. The first npm publish remains a manual maintainer step after merge (see README → Releasing).
