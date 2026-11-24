# Continuous Evidence SPEC
v0.1
License MIT

## 1. Introduction & Conformance

### 1.1 Purpose

Continuous Evidence (CE) is an approach to automated verification that produces
evidence about the runtime behavior influenced by software changes, in cases
where existing checks do not already provide sufficient evidence.

Two principles are deliberately emphasized:

1. **Evidence must be inspectable.** CE produces artifacts that can be examined
   and evaluated, not opaque claims.
2. **CE must not duplicate adequate verification.** When existing checks already
   provide sufficient evidence for a change, CE does not re-verify them.

### 1.2 Problem Statement

In software development, a change can pass builds, tests, and various automated
checks, yet its behavior when actually executed may remain unproven. On the
other hand, requiring developers to manually verify every change is inefficient.
Running an AI agent to verify every change is also not an ideal solution, as it
adds cost, latency, and complexity.

The core problem CE addresses is the gap between software changes that pass
existing checks and the runtime evidence available to assess those changes.
CE aims to fill that gap selectively, not to replace verification methods that
are already effective.

### 1.3 Scope and Target Audience

CE v0 is deliberately scoped to a primary audience:

> **Primary target:** software developers and engineering teams, including
> individual developers, open-source maintainers, code reviewers, and
> engineering teams that need to verify software changes.

Related groups and their relationship to CE:

| Group | Relationship to CE |
| --- | --- |
| Developers and engineering teams | Primary users who need evidence |
| Developer tools and automation authors | Parties who may implement or integrate the CE specification |
| QA engineers | Potential users who may consume the evidence |
| Compliance teams and auditors | Potential future consumers, not a v0 target |

CE intentionally does not target compliance and auditing as a primary audience.
Although the term *evidence* is common in audit contexts, promising
audit-grade evidence would introduce additional expectations regarding trust,
traceability, retention, and assurance that are not necessarily relevant to the
goals of CE v0. CE may prove useful to auditors later, without defining itself
as a compliance framework from the start.

### 1.4 What CE Provides — and What It Does Not

CE does not promise that every change is correct. CE promises a mechanism for
obtaining additional, relevant evidence when it is needed.

### 1.5 Conformance

CE adopts BCP 14 normative requirement language ([RFC 2119] and [RFC 8174]).
The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and
**OPTIONAL** in this document are to be interpreted as described in BCP 14
when, and only when, they appear in all capitals, as shown here.

| Keyword | Meaning with respect to conformance |
| --- | --- |
| MUST | Required for conformance. |
| MUST NOT | Absolute prohibition. Violation means non-conformant. |
| SHOULD | Strongly recommended. May be excepted with valid reasons and a full understanding of the implications. |
| SHOULD NOT | Strongly discouraged. Exceptions require valid and careful consideration. |
| MAY | Optional. Not implementing it does not affect conformance. |

An implementation is conformant when it satisfies all applicable **MUST** and
**MUST NOT** requirements of this specification. Deviations from **SHOULD** and
**SHOULD NOT** requirements are permitted when justified and their implications
have been carefully considered. CE does not impose any additional obligation to
formally document such deviations.

[RFC 2119]: https://www.rfc-editor.org/rfc/rfc2119
[RFC 8174]: https://www.rfc-editor.org/rfc/rfc8174



## 2. Terminology and Definitions

> **Placeholder.** This section will be completed at the end, once the
> specification is final and the terms that require precise definitions are
> known.

## 3. Core Model

### 3.1 Overview

> The CE Core Model consists of six conceptual entities: **Change**,
> **Subject**, **Claim**, **Check**, **Assessment**, and **Evidence**.
>
> A Change provides the context for identifying the Subject under verification,
> the behavioral Claims associated with it, and existing Checks.
>
> An Assessment determines whether additional runtime Evidence is warranted.
> When required, Evidence is produced through runtime observation and
> associated with the relevant Claims.
>
> Claims may be derived from existing change descriptions, documentation, or
> code context without requiring explicit declarations. Not every Change
> requires additional Evidence, and CE does not mandate any particular
> invocation platform or verification tool.

The six entities are conceptual. They do not all need to be materialized or
made available from the start of an implementation; together, however, they
represent the context of a change, the verification need, and the evidence
produced.

### 3.2 Fundamental Entities

| Entity | Definition | Role |
| --- | --- | --- |
| Change | The software change that is the reason verification is performed. | Primary context |
| Subject | The software, component, or runtime behavior that is the object of observation. | Verification target |
| Claim | A statement about the behavior expected from the change. | Proposition to be evidenced |
| Check | A verification that already exists, such as unit tests, integration tests, builds, or other automated checks. | Existing verification context |
| Assessment | A determination of whether the change requires additional runtime evidence. | The CE need decision |
| Evidence | Proof obtained from runtime observation that can be inspected to evaluate a Claim. | Primary CE output |

### 3.3 Relationships Between Entities

The entities relate as follows:

- **Change** provides context for the **Subject**, the **Claims**, and the
  existing **Checks**. A single change may involve multiple behaviors that need
  to be evidenced.
- **Subject** identifies what will be observed. It does not assume the
  existence of a pull request, Git, or any particular platform.
- **Claim** expresses the intent of the change. It may be found in a pull
  request summary, description, docstring, code comments, or other context.
  Developers are not required to write Claims in any special format.
- **Check** represents existing verification. CE considers it in order not to
  duplicate work that has already proven adequate.
- **Assessment** considers this context to determine whether additional
  evidence is needed.
- **Evidence** is produced when verification is performed, and is associated
  with the relevant Claims.

### 3.4 Worked Example

Consider a pull request titled *"Fix dropdown clipping inside modal"*.

| Entity | Representation |
| --- | --- |
| Change | Styling changes to the dropdown and modal. |
| Subject | The dropdown rendered inside the modal. |
| Claim | The dropdown is no longer clipped when the modal is open. |
| Check | Build and unit tests pass, but they do not show the actual rendered result. |
| Assessment | Additional runtime evidence is required. |
| Evidence | A screenshot of the rendered result showing the dropdown open without clipping. |

Conversely, a change to calculation logic that is already adequately verified
by deterministic tests may produce an Assessment of `not required`, so no
additional Evidence is produced.

An Assessment is a valid CE outcome even when it concludes that Evidence is
not needed.

### 3.5 Explicitly Out of the Core Model

The following are important but are deliberately not fundamental entities in
v0:

- **Source / Provenance.** Provenance is part of the relationships between
  entities. For example, a Claim originates from a pull request summary or a
  docstring, and Evidence originates from runtime observation. The ability to
  trace where information came from MUST be preserved, but it does not need to
  be materialized as a dedicated `Source` entity.
- **Verdict / Judgment.** A verdict is an interpretation of the sufficiency or
  meaning of Evidence. For now, CE does not require it as an entity, and the
  `Assessment` decision MUST NOT be conflated with a verdict about the
  correctness of the software.
- **Classifier.** A classifier (such as Jev in CE v0) is a mechanism used to
  produce an `Assessment`; it is not part of the conceptual definition of an
  Assessment itself.

### 3.6 Guiding Principles

The Core Model is governed by three principles:

1. **Context over ceremony.** CE uses information that already exists about a
   change, without requiring developers to manually write Claims or special
   metadata.
2. **Evidence only when warranted.** CE does not require Evidence for every
   Change. A decision to not run additional verification is a valid outcome.
1. **Context over ceremony.** CE uses information that already exists about a
   change, without requiring developers to manually write Claims or special
   metadata.
2. **Evidence only when warranted.** CE does not require Evidence for every
   Change. A decision to not run additional verification is a valid outcome.
3. **Independent of invocation source.** A pull request is one rich source of
   context, but the Core Model MUST remain valid when CE is invoked from a
   CLI, a skill, a plugin, or any other automation.

## 4. Architecture

### 4.1 Architectural Positioning

> CE v0 adopts a lightweight, invocation-driven, and capability-based
> architecture.
>
> Its core responsibilities are context resolution, applicability assessment,
> runtime verification, and evidence production.
>
> Jev serves as the required decision engine in v0, responsible for determining
> whether additional runtime evidence is warranted and supporting bounded
> decisions within available verification capabilities.
>
> Runtime observation and execution are performed through reusable, generic
> capabilities rather than a mandatory generative agent harness or
> application-specific verification scripts.
>
> CE operates as an independently invocable process that can be integrated
> into developer workflows through CLI, CI, skills, plugins, or other
> automation interfaces.
>
> CE is designed to complement existing verification systems without replacing
> them or requiring changes to their fundamental operation. Evidence storage,
> publication, and enforcement policies may be delegated to integrating
> systems.
>
> The architecture does not mandate a particular programming language,
> execution platform, CI provider, or centralized infrastructure.

CE is not an AI-powered CI, not a general-purpose coding agent, and not a new
testing framework. It is a system that uses automation and generic runtime
capabilities to produce additional evidence only when it is needed.

### 4.2 Core Responsibilities

CE v0 defines four primary architectural responsibilities:

| Component | Responsibility |
| --- | --- |
| Context Resolver | Collects information about the Change, Subject, Claims, and Checks from the available context. |
| Assessment Engine | Uses Jev to determine whether additional runtime evidence is required. |
| Capability Runtime | Observes the runtime, provides generic actions, and executes Jev decisions to collect evidence. |
| Evidence Output | Packages observation results together with their context and provenance so that they can be inspected or published. |

Jev is used within two distinct responsibilities: determining applicability
(whether additional evidence is warranted) and making bounded decisions during
runtime verification (selecting actions within available capabilities).

The interaction pattern **Observe → Decide → Execute** serves as the primary
inspiration for the Capability Runtime. However, CE MUST limit its
verification to capabilities that are actually supported; it MUST NOT claim to
be able to automatically verify all kinds of software.

### 4.3 Invocation Model

CE operates as an on-demand process, not as a background service or a platform
that must remain always active.

For the reference implementation, the most practical form is a TypeScript CLI
based on Node.js, with a core that can also be used programmatically. The same
CE program can be invoked from a terminal, a CI workflow, an agent skill, or a
plugin. The only difference is where the context is provided from and who
initiates the execution. Implementations do not need to build separate runtime
variants for each invocation source.

Systems such as Git and CI act as **context providers**, not as mandatory
architectural dependencies. CE MAY use diffs, pull request descriptions, or
test results when they are available, but it MUST NOT be required to manage
Git, run a full CI pipeline, or provide its own editor integration.

For v0, a Jev API key is a required dependency, consistent with the agreed MVP
boundaries. Alternative classifiers and keyless modes are not part of the
initial target.

TypeScript, Node.js, and the specific packaging form are decisions of the
reference implementation; they are not conformance requirements of this
specification.

### 4.4 Relationship to Existing Verification and CI/CD

CE runs independently and can be integrated non-invasively with existing
workflows.

- CE does not replace builds, unit tests, integration tests, or deployments.
- CE does not automatically run runtime verification for every change. An
  Assessment may conclude that available checks are adequate and that no
  additional evidence is needed.
- When evidence is needed but a required capability is not available, CE MUST
  be able to distinguish that condition from a decision that evidence is not
  needed.

Users MAY integrate CE as a step in CI, invoke it locally, or run it through
other automation. This specification does not mandate CE as a merge gate or a
deployment gate.

### 4.5 Design Properties

CE is characterized by three properties. These describe how CE relates to its
environment without mandating a specific deployment pattern; "sidecar" may be
used as an informal analogy, but it is not an architectural requirement:

1. **Non-invasive.** CE complements existing verification systems without
   requiring changes to their fundamental operation.
2. **Composable.** CE can be combined with other tools and workflows; storage,
   publication, and enforcement of evidence MAY be delegated to integrating
   systems.
3. **Invocation-agnostic.** The same CE program is invocable from a terminal,
   CI, a skill, a plugin, or other automation interfaces.

## 5. Capabilities

### 5.1 Overview

> CE v0 adopts a minimal, browser-first capability catalog.
>
> Browser navigation and interaction, DOM/UI state observation, and screenshot
> capture are REQUIRED capabilities.
>
> Process lifecycle management and runtime log capture are RECOMMENDED, while
> network and API observation are OPTIONAL for v0.
>
> Capabilities are generic and reusable rather than tied to
> application-specific verification scenarios.
>
> Implementations are not required to invoke every capability during a CE run.
> Capability usage is determined by the verification needs identified through
> Assessment.

The scope requirements for capabilities are as follows: a capability with a
**MUST** level MUST be available in the default v0 catalog. **MUST** here means
the capability is required to be *available* in the catalog; it does not mean
the capability MUST be used in every CE run. A capability with a **SHOULD**
level is RECOMMENDED in the default catalog, and a capability with a **MAY**
level is OPTIONAL.

### 5.2 Capability Catalog for v0

| Capability | Level | Rationale |
| --- | --- | --- |
| Browser Navigation & Interaction | MUST | CE needs to open pages, click, type, and change application state. |
| DOM / UI State Observation | MUST | Jev needs information about available elements and state in order to decide. |
| Screenshot Capture | MUST | Produces visual evidence that can be inspected without re-running the application. |
| Process Lifecycle | SHOULD | Useful for running local applications, but CE MUST also be able to use already-running applications. |
| Log Capture | SHOULD | Enriches evidence with stdout/stderr and runtime information. |
| Network / API Observation | MAY | Useful for verifying network behavior, but not required for the MVP. |

### 5.3 Why Navigation, Observation, and Screenshot Together

A screenshot alone captures state at a single point in time. For evidence to be
relevant, CE typically needs a chain such as:

```
Navigate → Observe DOM → Interact
    ↑                        ↓
    └────── Observe new state ──────→ Capture screenshot
```

For example, for a change fixing a dropdown inside a modal:

- Without **Interaction**, the developer would have to arrange the application
  state to be captured themselves.
- Without **DOM Observation**, Jev loses the structured information needed to
  select elements and actions.

Browser navigation and interaction, DOM/UI state observation, and screenshot
capture therefore form one coherent browser verification capability, not three
independent features.

### 5.4 Runtime Access and Process Lifecycle

Running an application and verifying an application are different
responsibilities. In many realistic situations, a suitable runtime already
exists:

- A developer already runs the application on `localhost:3000`.
- A GitHub Actions workflow has started the application in an earlier step.
- CE is pointed at an available staging environment.

In these situations CE does not need to start a new process. CE MUST therefore
be able to use a runtime that is already available, while the ability to manage
the runtime lifecycle itself (start and stop the application) is a **SHOULD**.
This preserves the non-invasive principle established in Section 4.

### 5.5 Scope Consequences of the Browser-First Decision

With this catalog, CE v0 focuses on web application runtime verification. This
does not mean CE is browser-only forever; it means v0 selects one domain with
relatively mature observation and execution capabilities, in order to prove
that a complete verification flow can run from start to evidence.

For backend-only changes, Android, or desktop native applications, CE v0 may
not yet have relevant capabilities. This is a v0 support limitation, not a
statement that such changes do not require evidence.

### 5.6 Capabilities Do Not Establish Correctness

> A capability makes observation possible; it does not, by itself, establish
> the correctness of a claim.

A screenshot, for example, can be evidence that a particular view appears, but
it is not necessarily sufficient to prove all behavior behind that view.
Evidence obtained through capabilities is material for evaluating Claims; the
meaning and sufficiency of Evidence are determined through evaluation, not by
the mere act of observation.

## 6. Relationship to Existing Verification Approaches

> **This section is informative.** It explains the position of CE relative to
> established verification approaches and acknowledges its trade-offs. It does
> not introduce additional conformance requirements.

### 6.1 Overview

> Continuous Evidence does not aim to replace established software verification
> approaches. It complements them by identifying when additional runtime
> evidence is warranted and producing that evidence through available
> automation capabilities.
>
> CE prioritizes existing deterministic verification, avoids unnecessary
> duplication, and does not require a general-purpose generative agent harness.
>
> Its value lies in selective, change-aware, evidence-oriented verification
> rather than universal verification coverage.

> The value of Continuous Evidence is not how much verification it performs,
> but how much meaningful evidence it adds.

By this principle, a CE run that concludes no additional verification is
needed can be exactly as successful as one that produces evidence.

### 6.2 Comparison with Existing Approaches

| Approach | Relationship to CE | Priority |
| --- | --- | --- |
| Deterministic verification / CI checks | CE complements checks that do not yet produce adequate evidence, rather than repeating them. | Primary |
| Traditional E2E / UI testing | CE can leverage tools such as Playwright, but selects verification based on the change context without requiring dedicated test scripts for every scenario. | Primary |
| Generative AI agent verification | CE v0 chooses bounded decisions and generic capabilities over relying on a generative agent to plan the entire verification. | Primary |
| Manual verification | CE reduces repetitive verification work, but does not replace human judgment for cases that require interpretation. | Supporting |
| Production observability | CE examines changes in a verification context; observability primarily observes the behavior of a system that is already operating. | Scope boundary |

The first three are discussed in depth because they are closest to CE; the
last two are acknowledged briefly.

**Deterministic verification / CI checks.** Deterministic checks such as unit
and integration tests are, and remain, the first line of verification. CE
exists precisely because of them: it acts only where existing checks do not
already provide sufficient runtime evidence. For changes that are well covered
by deterministic tests, CE may decide that no additional evidence is needed —
and that is intended behavior, not a design weakness.

**Traditional E2E / UI testing.** CE may use the same underlying tools (for
example, browser automation via Playwright). The difference is that CE selects
what to verify based on the change context, rather than requiring a manually
authored test script for every scenario.

**Generative AI agent verification.** CE v0 deliberately uses bounded
decisions through Jev and generic capabilities, rather than delegating the
planning of the entire verification to a generative agent. This reduces cost,
latency, and complexity.

### 6.3 Differentiating Characteristics

Three characteristics, taken together, differentiate CE:

1. **Selective verification.** CE does not assume that every change must
   undergo additional runtime checks. The Assessment determines whether
   evidence is needed, based on the change, its claims, and the checks that
   are available.
2. **Change-aware runtime verification.** CE uses the change context to
   determine which runtime behavior is relevant. This differs from simply
   running an entire E2E suite or observing an application without change
   context.
3. **Evidence-oriented output.** The goal of CE is not merely to perform
   actions or obtain a `pass/fail` result, but to provide inspectable runtime
   observation evidence that can be associated with a change.

None of these characteristics is unique in isolation: Playwright can produce
screenshots and traces, CI systems can perform selective testing, and agents
can understand changes. The differentiation of CE lies in the combination of
the three as one approach, not in a claim of entirely new verification
technology.

### 6.4 Acknowledged Trade-offs

CE v0 has deliberate limitations, and this specification acknowledges them
explicitly:

- **Compared to deterministic tests:** CE can be slower, more expensive, and
  less repeatable, because it uses a model-based classifier and runtime
  interaction.
- **Compared to manually authored E2E tests:** CE may not match the precision
  and depth of testing scenarios designed specifically for an application.
- **Compared to generative agents:** bounded decisions reduce the need for
  generative reasoning, but they also limit CE's ability to handle conditions
  that are not supported by its available capabilities.
- **Compared to manual verification:** CE does not necessarily understand
  visual quality, user experience, or subjective context as well as a human.

This specification aims to show when CE is useful, when CE is limited, and
when another approach is more appropriate — rather than positioning CE as a
replacement for existing verification methods.

## 7. Execution Outcomes & Evidence Requirements

### 7.1 Execution Outcomes

Every CE run MUST resolve to exactly one execution outcome. The outcome is a
semantic contract that is observable by users and by integrating systems.

| Outcome | Meaning |
| --- | --- |
| SKIPPED | The Assessment determined that additional evidence is not required. |
| EVIDENCED | Runtime evidence was successfully collected. |
| UNSUPPORTED | Evidence was required, but the available capabilities were insufficient. |
| ERROR | The CE process failed to complete. |

`SKIPPED` and `UNSUPPORTED` MUST NOT be treated as the same condition. Not
producing evidence because it is not needed is fundamentally different from
being unable to produce evidence.

### 7.2 Minimum Evidence Requirements

When a CE run produces evidence, the result MUST at minimum allow a user to
determine:

- the change and the claim the evidence relates to,
- the subject or runtime that was observed,
- the verification actions that were performed,
- the observations that were obtained, and
- where the evidence can be inspected.

If no claim can be identified from the change context, the evidence MUST state
that a claim could not be identified; CE MUST NOT fabricate a claim in order
to satisfy this contract.

This section defines only the observable behavioral contract. It does not
specify representation formats, field names, directory structures, exit codes,
or storage mechanisms; those are decisions for implementations.




