# `ce init` and npm distribution (issue #13) — Lean, publishable package manifest (Phase 1 of 2)

**Date:** 2026-11-28
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3, T4}
**Unlocks next:** Phase 2

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T1:** Lean, publishable package manifest [prereq] → [tasks/T1-lean-publishable-package-manifest.md](tasks/T1-lean-publishable-package-manifest.md)
- **T2:** Project detection (package manager, script, port, framework) [prereq] → [tasks/T2-project-detection-package-manager-script-port-framework.md](tasks/T2-project-detection-package-manager-script-port-framework.md)
- **T3:** Commented ce.yml template [depends: T2] → [tasks/T3-commented-ce-yml-template.md](tasks/T3-commented-ce-yml-template.md)
- **T4:** Next-steps text and workflow snippet [depends: T2] [parallel: T3] → [tasks/T4-next-steps-text-and-workflow-snippet.md](tasks/T4-next-steps-text-and-workflow-snippet.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
