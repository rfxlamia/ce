---
inclusion: always
---

# Product: Continuous Evidence (CE)

## What CE is

Continuous Evidence (CE) produces evidence about the runtime behavior a software Change influences, when existing Checks do not already provide enough evidence. Two principles apply (`SPEC.md` section 1.1):

1. Evidence must be inspectable. CE produces artifacts that can be examined, not opaque claims.
2. CE must not duplicate adequate verification. When existing Checks are sufficient, CE does not re-verify them.

CE is not an AI-powered CI, not a general-purpose coding agent, and not a new testing framework (`SPEC.md` section 4.1). It does not promise that every change is correct (`SPEC.md` section 1.4).

## The problem

A Change can pass builds, tests, and other automated Checks, yet its behavior when executed may remain unproven. Manually verifying every Change is inefficient, and running an AI agent on every Change adds cost, latency, and complexity. CE addresses the gap between Changes that pass existing Checks and the runtime Evidence available to assess them. It fills that gap selectively and does not replace verification that already works (`SPEC.md` section 1.2).

## Audience

The primary audience is software developers and engineering teams: individual developers, open-source maintainers, code reviewers, and teams that verify software changes. Compliance teams and auditors are potential future consumers, not a v0 target (`SPEC.md` section 1.3).

## Core terms

Use these six terms, one per concept, as defined in `SPEC.md` section 3.2:

- **Change**: the software change that is the reason verification is performed.
- **Subject**: the software, component, or runtime behavior that is observed.
- **Claim**: a statement about the behavior expected from the Change.
- **Check**: a verification that already exists, such as unit tests, integration tests, or builds.
- **Assessment**: the determination of whether the Change requires additional runtime Evidence. An Assessment of "not required" is a valid result.
- **Evidence**: proof obtained from runtime observation that can be inspected to evaluate a Claim. It is the primary CE output.

## Execution outcomes

Every CE run resolves to exactly one outcome (`SPEC.md` section 7.1):

| Outcome | Meaning |
| --- | --- |
| `SKIPPED` | The Assessment determined that additional Evidence is not required. |
| `EVIDENCED` | Runtime Evidence was collected. |
| `UNSUPPORTED` | Evidence was required, but the available capabilities were insufficient. |
| `ERROR` | The CE process failed to complete. |

`SKIPPED` and `UNSUPPORTED` are distinct conditions and MUST NOT be treated as the same. Not producing Evidence because it is not needed is different from being unable to produce it.

## Non-goals for v0

- Compliance-grade or audit-grade evidence.
- Capabilities other than the browser-first catalog (no backend-only, Android, or desktop-native verification).
- A keyless or alternative classifier. A Jev API key is required in v0.
- Acting as a merge gate or deploy gate by default.
- Writing to the target application or to Git. CE reads Git as a context provider and does not manage it. CE writes only its own evidence output.

These match `docs/journal/v0.0/requirements.md` ("Non-goals for v0") and `SPEC.md` sections 1.3, 4.3, 4.4, and 5.5.

## Sources of truth

- `SPEC.md` is the normative source.
- `docs/journal/v0.0/requirements.md` and `docs/journal/v0.0/design.md` are derived from it.
- When they disagree, `SPEC.md` wins.
