# `ce init` and npm distribution (issue #13) — Execution Index

**Date:** 2026-11-28
**Spec:** docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
**Source Plan:** ../execution-plan.md
**source-sha256:** 78cdfa81afb06880b5246fe005fe41c2173b4c3065fea50bc275dd3f7e6848aa
**Total Tasks:** 9
**Total Phases:** 2

---

## Execution Flow

```
T1,T2(PARALLEL)→T3,T4(PARALLEL)→T5→T6→T7→T8→T9
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Lean, publishable package manifest (T1, T2, T3, T4)
- **Phase 2:** [phase-2.md](phase-2.md) — `ce init` command, overwrite guard and CLI wiring (T5, T6, T7, T8, T9)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Lean, publishable package manifest | Phase 1 | [T1-lean-publishable-package-manifest.md](tasks/T1-lean-publishable-package-manifest.md) | [prereq] |
| T2 | Project detection (package manager, script, port, framework) | Phase 1 | [T2-project-detection-package-manager-script-port-framework.md](tasks/T2-project-detection-package-manager-script-port-framework.md) | [prereq] |
| T3 | Commented ce.yml template | Phase 1 | [T3-commented-ce-yml-template.md](tasks/T3-commented-ce-yml-template.md) | [depends: T2] |
| T4 | Next-steps text and workflow snippet | Phase 1 | [T4-next-steps-text-and-workflow-snippet.md](tasks/T4-next-steps-text-and-workflow-snippet.md) | [depends: T2] [parallel: T3] |
| T5 | `ce init` command, overwrite guard and CLI wiring | Phase 2 | [T5-ce-init-command-overwrite-guard-and-cli-wiring.md](tasks/T5-ce-init-command-overwrite-guard-and-cli-wiring.md) | [depends: T3, T4] |
| T6 | Tarball smoke test script and CI job | Phase 2 | [T6-tarball-smoke-test-script-and-ci-job.md](tasks/T6-tarball-smoke-test-script-and-ci-job.md) | [depends: T1, T5] [test-risk] |
| T7 | OIDC release workflow | Phase 2 | [T7-oidc-release-workflow.md](tasks/T7-oidc-release-workflow.md) | [depends: T6] |
| T8 | README Quick start and Releasing runbook | Phase 2 | [T8-readme-quick-start-and-releasing-runbook.md](tasks/T8-readme-quick-start-and-releasing-runbook.md) | [depends: T7] |
| T9 | Done-when verification (keyed live run and timing) | Phase 2 | [T9-done-when-verification-keyed-live-run-and-timing.md](tasks/T9-done-when-verification-keyed-live-run-and-timing.md) | [depends: T6, T8] |
