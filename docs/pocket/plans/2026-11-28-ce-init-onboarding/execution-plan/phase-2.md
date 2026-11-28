# `ce init` and npm distribution (issue #13) — `ce init` command, overwrite guard and CLI wiring (Phase 2 of 2)

**Date:** 2026-11-28
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T5, T6, T7, T8, T9}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

- **T5:** `ce init` command, overwrite guard and CLI wiring [depends: T3, T4] → [tasks/T5-ce-init-command-overwrite-guard-and-cli-wiring.md](tasks/T5-ce-init-command-overwrite-guard-and-cli-wiring.md)
- **T6:** Tarball smoke test script and CI job [depends: T1, T5] [test-risk] → [tasks/T6-tarball-smoke-test-script-and-ci-job.md](tasks/T6-tarball-smoke-test-script-and-ci-job.md)
- **T7:** OIDC release workflow [depends: T6] → [tasks/T7-oidc-release-workflow.md](tasks/T7-oidc-release-workflow.md)
- **T8:** README Quick start and Releasing runbook [depends: T7] → [tasks/T8-readme-quick-start-and-releasing-runbook.md](tasks/T8-readme-quick-start-and-releasing-runbook.md)
- **T9:** Done-when verification (keyed live run and timing) [depends: T6, T8] → [tasks/T9-done-when-verification-keyed-live-run-and-timing.md](tasks/T9-done-when-verification-keyed-live-run-and-timing.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
