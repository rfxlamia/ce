# Requirements Document

## Introduction

This feature is a testing spike and knowledge foundation for building Continuous Evidence (CE). It implements GitHub issue #3 in rfxlamia/ce, "[M0] Spike: Jev via OpenRouter — response shape and latency" (milestone M0 Fondasi Kiro, label `spike`). The issue goal is to confirm assumptions before the Jev gateway is built.

CE depends on Jev, accessed through OpenRouter by default, as the classifier for assessment and for bounded runtime decisions (`docs/journal/v0.0/design.md` sections 1, 4, and 5). The design rests on assumptions that have not been tested against the live service: that the TypeSafe SDK works against the OpenRouter base URL, that `choice`, `noul`, and `score` answers match the SDK types, that one request can mix text and image state with `noul` and `box` questions, and that per-step latency is acceptable for the Observe, Decide, Execute loop. Design section 12 lists the response-shape and latency check as the one open question.

The spike produces measured facts and a findings document. It does not build the Jev gateway (`jev/gateway.ts`), the question catalog, or any other production CE component. The findings are the knowledge foundation that later specs for the gateway, the fake gateway, and the runtime loop derive from.

The normative source is `SPEC.md`. The derived design is `docs/journal/v0.0/design.md` and `docs/journal/v0.0/requirements.md`. `SPEC.md` takes precedence when they disagree. Related requirements in the journal are R11 (Jev usage) and R7 (bounded verification loop).

## Glossary

- **Spike**: The time-boxed investigation defined by this spec, which answers the questions of GitHub issue #3 with measurements.
- **Spike_Harness**: The scripts, kept outside `packages/ce/src/`, that send requests to Jev and record the results.
- **Jev**: TypeSafe's System One classifier, as defined in the CE journal.
- **Process_Environment**: The environment variables of the running Spike_Harness process, which may be populated from the Env_File.
- **Env_File**: The file `.env` at the repository root, which holds the local credential values for `OPENROUTER_API_KEY` and optionally `TYPESAFE_API_KEY`. The Env_File is never committed.
- **Env_Example_File**: The committed file `.env.example` at the repository root, which lists the credential variable names with empty values.
- **OpenRouter_Route**: The access path that uses the TypeSafe SDK (`@typesafe-ai/sdk`) with `baseURL` set to `https://openrouter.ai/api` and the credential read from `OPENROUTER_API_KEY` in the Process_Environment.
- **Dotenv_Package**: The npm package `dotenv`, used by the Spike_Harness to load the Env_File into the Process_Environment.
- **Primitive**: One of the Jev question types used by CE: `choice`, `noul`, `score`, or `box`.
- **SDK_Types**: The TypeScript types exported by the installed TypeSafe SDK for Primitive requests and responses.
- **Mixed_State_Request**: A single Jev request whose state is an array of text parts and `image_url` parts, containing a `noul` question and a `box` question.
- **Model_Id**: The model identifier string that the API returns in a response, as opposed to the identifier requested.
- **Pinned_Model**: The model requested by the Spike, `typesafe/jev-1.14`.
- **Next_Action_Request**: A text-only request shaped like `runtime.next_action` in the question catalog, with approximately 100 options.
- **Final_Image_Request**: A request shaped like the final-state request of design section 5, containing a screenshot image and the `runtime.state_reached` and `runtime.locate_subject` questions.
- **Latency_Sample**: The wall-clock time in milliseconds from sending one request to receiving the complete response.
- **Findings_Document**: The file `docs/journal/v0.0/spike-jev-openrouter.md`.
- **Design_Document**: The file `docs/journal/v0.0/design.md`.
- **Raw_Sample**: A recorded request/response pair from the Spike, with credentials removed, stored for later use as a fixture.
- **SPEC_File**: The file `SPEC.md` at the repository root.

## Requirements

### Requirement 1: Primitive compatibility through OpenRouter

**User Story:** As a CE developer, I want to know whether `choice`, `noul`, and `score` work through the OpenRouter route with the SDK as typed, so that the gateway can be written against the SDK types without workarounds.

#### Acceptance Criteria

1. WHEN the Spike_Harness sends a `choice` question through the OpenRouter_Route with the Pinned_Model, THE Spike_Harness SHALL record the full response body and whether it conforms to the SDK_Types.
2. WHEN the Spike_Harness sends a `noul` question through the OpenRouter_Route with the Pinned_Model, THE Spike_Harness SHALL record the full response body and whether it conforms to the SDK_Types.
3. WHEN the Spike_Harness sends a `score` question through the OpenRouter_Route with the Pinned_Model, THE Spike_Harness SHALL record the full response body and whether it conforms to the SDK_Types.
4. WHEN a response differs from the SDK_Types, THE Spike_Harness SHALL record each differing field by name together with the expected type and the observed value.
5. IF an OpenRouter_Route request fails, THEN THE Spike_Harness SHALL record the error class, the HTTP status when present, and the error message, and SHALL continue with the remaining checks.

### Requirement 2: Mixed text and image state

**User Story:** As a CE developer, I want to know whether one request can carry text and image state with `noul` and `box` questions, so that the final-state step in design section 5 can be one request.

#### Acceptance Criteria

1. WHEN the Spike_Harness sends a Mixed_State_Request to the Pinned_Model through the OpenRouter_Route, THE Spike_Harness SHALL record the full response body and whether the `noul` answer and the `box` answer are both present.
2. THE Spike_Harness SHALL use a screenshot of `examples/demo-app` as the image part of the Mixed_State_Request.
3. WHEN the `box` answer is returned, THE Spike_Harness SHALL record the box coordinates, the coordinate convention (origin and units), and whether the box encloses the intended subject in the screenshot.
4. WHEN the Spike_Harness sends the same question set with the image removed, THE Spike_Harness SHALL record whether the response shape changes.
5. IF the Mixed_State_Request fails or the `box` answer is absent, THEN THE Spike_Harness SHALL record the failure and SHALL record which of the following alternatives was tried and its result: sending the `noul` and `box` questions as separate requests, and sending the request to the `typesafe` provider with `TYPESAFE_API_KEY`.

### Requirement 3: Latency measurement

**User Story:** As a CE developer, I want measured p50 and p95 latency for the loop request and the final request, so that I can set step budgets and timeouts from data.

#### Acceptance Criteria

1. THE Spike_Harness SHALL collect at least 20 Latency_Samples for the Next_Action_Request with approximately 100 options, sent sequentially to the Pinned_Model.
2. THE Spike_Harness SHALL collect at least 20 Latency_Samples for the Final_Image_Request, sent sequentially to the Pinned_Model.
3. THE Spike_Harness SHALL compute and record the p50 and p95 of each set of Latency_Samples, together with the minimum, the maximum, and the sample count.
4. THE Spike_Harness SHALL record, for each set of Latency_Samples, the number of options in the request, the size of the state in tokens as reported by the API, and the number of failed requests.
5. THE Spike_Harness SHALL exclude failed requests from the percentile computation and SHALL report them separately.
6. WHEN a response carries a `retry-after` value or a rate-limit error, THE Spike_Harness SHALL record the value and the request in which it occurred.
7. THE Findings_Document SHALL state whether the measured p95 of the Next_Action_Request fits within a stated per-step time budget, and SHALL state the budget used for the comparison.

### Requirement 4: Model identification

**User Story:** As a CE developer, I want the exact model id the API returns, so that run bundles can record the model that actually answered.

#### Acceptance Criteria

1. THE Spike_Harness SHALL record the Model_Id returned in the response of every request type it sends.
2. WHEN the Model_Id differs from the Pinned_Model, THE Findings_Document SHALL state both values.
3. WHEN the Model_Id differs between requests of the same type within one Spike run, THE Findings_Document SHALL list each distinct Model_Id and the number of requests that returned it.
4. THE Findings_Document SHALL state in which response field the Model_Id is found.

### Requirement 5: Findings document

**User Story:** As a future contributor, I want one document that states what was tested, what was observed, and what it means for the design, so that I do not repeat the spike.

#### Acceptance Criteria

1. THE Spike SHALL deliver the Findings_Document at `docs/journal/v0.0/spike-jev-openrouter.md`.
2. THE Findings_Document SHALL contain one section for each of the following checks, in this order: primitive compatibility, mixed text and image state, latency, and model identification.
3. THE Findings_Document SHALL state, for each check, the method, the result as measured or observed, and a status of `confirmed`, `confirmed with differences`, or `not confirmed`.
4. THE Findings_Document SHALL state the date of the run, the version of the TypeSafe SDK, the Node.js version, and the Pinned_Model.
5. THE Findings_Document SHALL end with a list of consequences for the design, each naming the affected section of the Design_Document or the affected journal requirement, or stating that no change is needed.
6. THE Findings_Document SHALL state the limits of the measurements, including sample count, time of day, network location, and the single-run nature of the data.
7. THE Findings_Document SHALL NOT contain credentials or Env_File contents, and SHALL NOT contain state contents beyond the synthetic and demo-app inputs listed in the document.

### Requirement 6: Design reconciliation

**User Story:** As the CE maintainer, I want the design to match what was measured, so that later specs derive from facts and not from assumptions.

#### Acceptance Criteria

1. WHEN a check in the Findings_Document has the status `confirmed with differences` or `not confirmed`, THE Spike SHALL update the affected sections of the Design_Document to match the observed behavior.
2. WHEN the Spike updates the Design_Document, THE Spike SHALL keep the update consistent with SPEC_File, and SHALL leave SPEC_File unchanged unless a normative statement is contradicted by the findings.
3. WHEN all checks have the status `confirmed`, THE Spike SHALL mark the open question in Design_Document section 12 as resolved and SHALL reference the Findings_Document.
4. WHEN the Spike updates the Design_Document, THE Spike SHALL list each changed section in the Findings_Document consequences list.
5. IF a finding contradicts a normative statement in SPEC_File, THEN THE Spike SHALL report the contradiction in the Findings_Document and SHALL NOT edit SPEC_File without a decision from the maintainer.

### Requirement 7: Reusable samples for the fake gateway

**User Story:** As a CE developer, I want the recorded responses kept as fixtures, so that the fake Jev gateway and the CI tests can replay real response shapes without an API key.

#### Acceptance Criteria

1. THE Spike SHALL store one Raw_Sample for each request type it sends: `choice`, `noul`, `score`, Mixed_State_Request, Next_Action_Request, and Final_Image_Request.
2. THE Spike SHALL remove credentials and authorization headers from every Raw_Sample before it is stored, and SHALL NOT include Env_File contents in any Raw_Sample.
3. THE Spike SHALL store Raw_Samples as JSON files in a directory that the Findings_Document names.
4. THE Spike SHALL store, with each Raw_Sample, the Latency_Sample of that request and the Model_Id returned.
5. WHERE a Raw_Sample contains an image, THE Spike SHALL store the image as a separate file and reference it from the sample.

### Requirement 8: Safe and reproducible execution

**User Story:** As a developer, I want to rerun the spike with my own key and get the same checks, so that the findings can be verified and refreshed when the model changes.

#### Acceptance Criteria

1. WHEN the Spike_Harness starts, THE Spike_Harness SHALL load the Env_File with the Dotenv_Package and SHALL then read the credentials from the variables `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` in the Process_Environment.
2. THE Spike_Harness SHALL NOT write a credential value or Env_File contents to a file, to standard output, or to a log.
3. IF `OPENROUTER_API_KEY` is not set in the Process_Environment after the Env_File is loaded, THEN THE Spike_Harness SHALL exit with a message that names the variable and SHALL send no request.
4. IF `TYPESAFE_API_KEY` is not set in the Process_Environment after the Env_File is loaded, THEN THE Spike_Harness SHALL skip the `typesafe` provider alternative of Requirement 2 and SHALL record that it was skipped.
5. THE Spike_Harness SHALL be runnable from the repository root with one documented command, and THE documentation of that command SHALL state that `OPENROUTER_API_KEY` is placed in the Env_File.
6. THE Spike_Harness SHALL reside outside `packages/ce/src/`, so that the Spike adds no production code to the CE package.
7. THE Spike_Harness SHALL NOT be part of `npm test`, so that CI runs need no API key.
8. WHEN the Spike_Harness is rerun, THE Spike_Harness SHALL write its outputs to a new, dated location and SHALL NOT overwrite earlier Raw_Samples.
9. WHERE a variable is already set in the Process_Environment before the Spike_Harness starts, THE Spike_Harness SHALL use the Process_Environment value and SHALL NOT override it with the Env_File value.
10. IF the Env_File does not exist, THEN THE Spike_Harness SHALL continue without an error from the loading step, and the rules of criteria 3 and 4 SHALL apply to the Process_Environment.
11. THE Spike SHALL declare the Dotenv_Package as a devDependency in the root `package.json` or in the package that holds the Spike_Harness.
12. THE Spike SHALL NOT declare the Dotenv_Package in the dependencies of `packages/ce`, and THE Spike SHALL NOT import the Dotenv_Package from `packages/ce/src/`.
13. THE repository `.gitignore` SHALL cause Git to ignore the Env_File while keeping the Env_Example_File tracked.
14. THE Spike SHALL provide a committed Env_Example_File that lists `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` with empty values and contains no real credential.
15. THE Spike SHALL NOT commit the Env_File, and THE Spike SHALL NOT copy the Env_File into any Raw_Sample directory, output directory, or the Findings_Document.

### Requirement 9: Completion criteria

**User Story:** As the CE maintainer, I want an unambiguous definition of done, so that issue #3 can be closed.

#### Acceptance Criteria

1. THE Spike SHALL be complete only WHEN the Findings_Document is committed to the repository and every Design_Document change required by Requirement 6 is committed.
2. THE Spike SHALL be complete only WHEN each of the four checks of issue #3 has a status in the Findings_Document: primitive compatibility, mixed text and image state, latency, and model identification.
3. IF a check cannot be run because of an external cause such as an unavailable service or missing credential, THEN THE Findings_Document SHALL record the check as `not confirmed` with the cause, and SHALL NOT infer a result.
4. THE Spike SHALL add no production CE code and SHALL NOT change SPEC_File without the decision required by Requirement 6. The Dotenv_Package devDependency, the Env_Example_File, and the Spike_Harness are spike tooling and do not count as production CE code.
