# Requirements Document

## Introduction

This feature implements the Jev gateway layer of Continuous Evidence (CE): GitHub issue #5 in rfxlamia/ce, "[M1] Jev gateway, question catalog, fake and call log" (label `core`, milestone M1). It implements R11 of `docs/journal/v0.0/requirements.md`, section 4 (question catalog), section 10 (error handling) and section 12 (open questions) of `docs/journal/v0.0/design.md`, and the decision in `.kiro/steering/jev-gateway-decision.md`. `SPEC.md` is normative and wins on any conflict.

The issue has two parts, and both are in scope:

1. **Gateway code** (issue items 1 to 9): the `JevGateway` interface and `HybridJevGateway` with two transports, provider and pinned model selection, `JevImageError`, recording the dated model id, `jev/catalog.ts`, request pacing and rate-limit handling, `jev/fake.ts`, `jev-calls.jsonl`, and the missing-credential path.
2. **Image verification left open by the spike** (issue items under "Image verification"): final-image latency (p50 and p95 over 20 samples), the `image_url` array form, and the direct `typesafe` provider. These three items need a real API key and live calls. They cannot run in CI. They are delivered as a manually run verification script plus a findings document. The implementer runs the script itself, with no user step. Each item is complete when it is answered and recorded. A negative answer (for example "the `image_url` form is rejected") counts as answered. A missing key does not allow a fabricated answer (Requirement 18). `OPENROUTER_API_KEY` is required for the latency and `image_url` items. `TYPESAFE_API_KEY` is optional: the direct provider item (Requirement 17) may be answered with the status `not tested (blocked: TYPESAFE_API_KEY not set)` plus a linked follow-up issue, and that status does not block the pull request (Requirements 17.8, 18.8, 20.9, 20.11). This is a deliberate narrowing of the "Done when" line of issue #5 for the direct provider only, and the pull request body states it.

Three items of the issue are already checked and are satisfied by existing evidence: one raw JSON request with `noul` and `box` on the same image works, the `TypeSafe-Danger-Zone-Images` header is not needed on the JSON path, and the upstream report is filed as typesafe-ai/typesafe-sdk-js#27. This spec keeps them true in code (Requirement 3 criterion 5) and cites the evidence in the pull request (Requirement 20).

Code lives in `packages/ce/src/jev/`: `gateway.ts`, `transport-sdk.ts`, `transport-json.ts`, `catalog.ts`, `fake.ts`, `log.ts`, `hash.ts`, `errors.ts`, `probe.ts`. The shared `StageError` lives in `packages/ce/src/errors.ts`. The manual script lives in `packages/ce/src/scripts/verify-jev-image.ts` and may import only `jev/probe.ts` (Requirement 14). Tests use vitest and fast-check and need no API key.

Assumptions (the issue and the journal leave these open):

- One `JevGateway` instance serves one CE run. "One image request per run" is enforced per gateway instance.
- `StageError` and `RateLimitError` do not exist yet. `StageError(stage, cause)` is defined in `packages/ce/src/errors.ts` because it is shared by all stages (design section 10). The gateway-level `RateLimitError` is defined in `jev/errors.ts` and wraps the SDK error of the same name, so no module outside `jev/` imports the SDK.
- The stage names are the four pipeline stages of SPEC section 4.2 and design section 1: `context`, `assessment`, `runtime`, `evidence`. Claim extraction (`assessment/claims.ts`) belongs to the `assessment` stage.
- The default concurrency limit is 4 requests in flight. The default timeout of a text request is 10 000 ms per attempt (the SDK default). The default timeout of the image request is 30 000 ms. The default number of retries is 2 for rate limits (`maxRateLimitRetries`) and 2 for transient failures of Text_Requests (`maxTransientRetries`). All of these are constructor options of the gateway and are not `ce.yml` keys, because the Config_Schema is closed and its keys are owned by the ce-config-loader spec.
- Facts of `@typesafe-ai/sdk` 0.7.0 that the requirements rely on, checked in `spike/jev-openrouter/node_modules`: the SDK retries by default (`maxRetries` 2, statuses 408, 429 and 500 to 599, connection errors and timeouts), so the gateway sets `retry: { maxRetries: 0 }` and owns all retries. The SDK default log level is `warn`, it reads `TYPESAFE_LOG_LEVEL` when no `logLevel` option is given, and at level `debug` it logs request bodies. The SDK default compression is zstd only when the runtime has it (Node 22.15 or newer) and applies to bodies of 1024 bytes or more. Every `image()` object carries a random reference `<image:` plus 32 hex digits `>` that `withAssets` puts into the state text.
- The gateway exports `JevUsageError` and `FakeRecordingMissingError` publicly, because callers and tests must be able to tell them from run failures (Requirement 13 criterion 7).
- Until Requirement 17 is answered, the pinned model of the direct `typesafe` provider is `typesafe/jev-1.14`, marked unverified in code. Requirement 17 replaces it with the recorded answer.
- The Fixture_Image for verification is the demo-app screenshot `spike/jev-openrouter/fixtures/demo-app-screenshot.png` (1280 by 800). It is copied into `packages/ce/fixtures/jev/` so the script does not depend on the throwaway spike directory.
- The findings are recorded in a new file, `docs/journal/v0.0/jev-gateway-verification.md`. The existing `design.md`, `requirements.md` and `spike-jev-openrouter.md` are not edited, per the steering rule that the journal is not edited. The new file states that it answers open items 1 and 2 of design section 12.

Out of scope: the CE run pipeline and `outcome/resolve.ts` (the gateway never decides an Outcome), the evidence bundle writer and `run.json` (the gateway only supplies the model id and the log), the runtime loop and `runtime/decide.ts`, the claim and assessment logic, adopting the `image_url` array form in the gateway (Requirement 16 only records whether it works), and changes to the Config_Schema.

## Glossary

- **Jev_Gateway**: The TypeScript interface in `packages/ce/src/jev/gateway.ts` through which every other CE module asks Jev questions. It has one method, `ask`.
- **Hybrid_Gateway**: The class `HybridJevGateway` that implements Jev_Gateway with the SDK_Transport and the JSON_Transport, chosen per request.
- **SDK_Transport**: The transport that calls `client.systemOne` of `@typesafe-ai/sdk` 0.7.0. It lives in `jev/transport-sdk.ts`.
- **JSON_Transport**: The transport that sends a raw `fetch` `POST` to `<base URL>/v1/systemone` with the image in `assets` as `data_base64`. It lives in `jev/transport-json.ts`.
- **Text_Request**: A Jev_Request whose state, question content and assets contain no image.
- **Image_Request**: A Jev_Request whose state, question content or assets contain at least one image.
- **Final_Image_Request**: The single Image_Request of a run: the questions `runtime.state_reached` (noul) and `runtime.locate_subject` (box) on the final screenshot (design section 5).
- **Jev_Request**: The input of `ask`: a stage name, a state, and a set of named questions built with the Question_Catalog.
- **Jev_Response**: The result of `ask`: the answers keyed by question name, the Returned_Model_Id, the token usage and the State_Hash.
- **Provider**: One of `openrouter` or `typesafe`, the value of `jev.provider` in the Effective_Config.
- **Pinned_Model**: The model name that CE requests for a Provider when `jev.model` was not set by the user. For `openrouter` it is `typesafe/jev-1.14`.
- **Returned_Model_Id**: The dated model id in the `model` field of an API response, for example `typesafe/jev-1.14-20261014`.
- **Question_Catalog**: The module `packages/ce/src/jev/catalog.ts`. It holds all question text and builds questions with the SDK helpers.
- **Catalog_Entry**: One question of the Question_Catalog, identified by an id and a version, written `id@version`, for example `claim.is_behavior@1`.
- **State_Hash**: The lowercase hexadecimal SHA-256 digest that identifies a state, defined in Requirement 10. It does not depend on the random reference strings of image assets.
- **Fake_Gateway**: The class `FakeJevGateway` in `jev/fake.ts` that implements Jev_Gateway from Recordings and makes no network call.
- **Recording**: One recorded answer of the Fake_Gateway, keyed by the versioned Catalog_Entry (`id@version`), the State_Hash and the question name.
- **Call_Log**: The file `jev-calls.jsonl`, with one JSON object per line (a Call_Log_Entry) for each Jev call.
- **Call_Log_Entry**: One line of the Call_Log. Its fields are defined in Requirement 12.
- **JevImageError**: The error class in `jev/errors.ts` raised when an Image_Request fails for any reason other than a rejected credential (HTTP 401 or 403). It includes a persistent rate limit (reason `rate_limited`), so that the run can fall back to text signals.
- **RateLimitError**: The error class in `jev/errors.ts` raised for HTTP 429 on a Text_Request after retries are exhausted. It carries `retryAfterMs` when the server sent a delay.
- **JevUsageError**: The error class in `jev/errors.ts` raised when the caller misuses the gateway, for example a second Image_Request on one gateway instance.
- **AskOptions**: The second parameter of `ask`, an object with an optional `signal` of type `AbortSignal`.
- **Transient_Failure**: For a Text_Request, an HTTP 408, an HTTP status 500 to 599, a connection failure or a timeout of one attempt.
- **StageError**: The error class `StageError(stage, cause)` in `packages/ce/src/errors.ts`, where `stage` is one of `context`, `assessment`, `runtime`, `evidence`.
- **Credential_Check**: The existing function `requireJevCredentials(loaded, env)` of the ce-config-loader spec.
- **Gateway_Factory**: The function `createJevGateway(loaded, env, options)` that validates credentials and the model, then returns a Hybrid_Gateway.
- **Probe_Library**: The module `jev/probe.ts`. It is the only entry point of the Verification_Script into `jev/`. It holds the verification logic (statistics, request shapes, result records) and the Probe_Functions. Its pure logic is testable without a network.
- **Probe_Functions**: The functions `sendText`, `sendFinalImage`, `sendSdkImage` and `sendImageUrlForm` exported by the Probe_Library. Each builds its own gateway or transport from `jev/` and returns a result record.
- **Verification_Script**: The manually run script `packages/ce/src/scripts/verify-jev-image.ts`. It imports only the Probe_Library.
- **Follow_Up_Issue**: A GitHub issue titled "Verify direct typesafe provider" that tracks Requirement 17 when `TYPESAFE_API_KEY` is not available.
- **Verification_Item**: One of the three open items: final-image latency (Requirement 15), the `image_url` array form (Requirement 16), the direct `typesafe` provider (Requirement 17).
- **Findings_Document**: The file `docs/journal/v0.0/jev-gateway-verification.md`.
- **Fixture_Image**: The PNG screenshot used by the Verification_Script.
- **Answer_Status**: One of `confirmed`, `not supported`, `not tested (blocked: <reason>)`, the status written for each Verification_Item in the Findings_Document.
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR` (SPEC.md section 7.1).
- **Effective_Config**, **Loaded_Config**, **Validation_Error**: As defined in the ce-config-loader spec.
- **Issue_Checklist**: The acceptance checklist of issue #5, reproduced in Requirement 20.

## Requirements

### Requirement 1: Gateway interface and per-request transport routing

**User Story:** As a pipeline developer, I want one gateway interface that picks the right transport for each request, so that callers never know that two transports exist.

#### Acceptance Criteria

1. THE Jev_Gateway SHALL declare one method `ask` that takes a Jev_Request and optional AskOptions and returns a promise of a Jev_Response.
2. THE Hybrid_Gateway SHALL implement the Jev_Gateway interface.
3. WHEN the Hybrid_Gateway receives a Text_Request, THE Hybrid_Gateway SHALL send the request through the SDK_Transport.
4. WHEN the Hybrid_Gateway receives an Image_Request, THE Hybrid_Gateway SHALL send the request through the JSON_Transport.
5. THE Hybrid_Gateway SHALL choose the transport separately for each request, from the content of that request only.
6. THE Hybrid_Gateway SHALL send all questions of one Jev_Request in one HTTP request.
7. THE SDK_Transport and the JSON_Transport SHALL return a Jev_Response of the same TypeScript type, with answers of the SDK types `NoulResponse`, `ChoiceResponse`, `ScoreResponse` and `BoxResponse`.
8. THE Hybrid_Gateway SHALL accept the transports as constructor parameters, so that tests can substitute stub transports.
9. FOR ALL Jev_Requests, THE Hybrid_Gateway SHALL call exactly one transport exactly once per attempt, and the transport called SHALL be the JSON_Transport if and only if the request is an Image_Request (routing property).
10. WHEN `AskOptions.signal` is already aborted when `ask` is called, THE Hybrid_Gateway SHALL make no network call and SHALL fail as Requirement 6 criterion 18 states.
11. WHEN `AskOptions.signal` aborts while a request or a backoff wait is in progress, THE Hybrid_Gateway SHALL cancel the HTTP request or the wait, SHALL NOT start another attempt, and SHALL fail as Requirement 6 criterion 18 states.
12. THE Fake_Gateway SHALL accept the same AskOptions and SHALL apply criteria 10 and 11 before it returns a Recording.

### Requirement 2: Question construction and answer types

**User Story:** As a pipeline developer, I want questions built with the SDK helpers in both paths, so that both transports accept and return the same shapes.

#### Acceptance Criteria

1. THE Question_Catalog SHALL build every question with the SDK helpers `noul`, `choice`, `score` and `box`.
2. THE Question_Catalog SHALL build every image asset with the SDK helper `image`, and SHALL build every state that carries an asset with the SDK helper `withAssets`. No other module SHALL call `image` or `withAssets`.
3. WHEN the JSON_Transport sends a Jev_Request, THE JSON_Transport SHALL serialize the questions that the Question_Catalog built, without changing the question type, instructions or criteria.
4. WHEN the JSON_Transport serializes an image asset, THE JSON_Transport SHALL write the asset as `{ "type": "image", "format": <png or jpeg>, "data_base64": <base64 of the bytes> }` under the reference string of the asset.
5. THE JSON_Transport SHALL determine `format` from the magic bytes of the image: `png` for `89 50 4E 47`, `jpeg` for `FF D8 FF`.
6. IF the image bytes match neither magic number, THEN THE JSON_Transport SHALL raise a JevImageError with reason `invalid_image` and SHALL NOT send any network request.
7. FOR ALL Jev_Requests with a set of questions, THE JSON_Transport body SHALL contain exactly the question names of the request (serialization property).

### Requirement 3: JSON transport

**User Story:** As a maintainer, I want a small raw JSON transport for image requests, so that image requests work on OpenRouter, which rejects the SDK multipart upload.

#### Acceptance Criteria

1. THE JSON_Transport SHALL send an HTTP `POST` to `<base URL>/v1/systemone` with the headers `Content-Type: application/json` and `Authorization: Bearer <API key of the Provider>`.
2. THE JSON_Transport SHALL send a body with the fields `model`, `state`, `questions` and `assets`.
3. THE JSON_Transport SHALL use the global `fetch` of Node.js, or a `fetch` function passed as a constructor parameter.
4. THE JSON_Transport SHALL read the response fields `model`, `answers` and `usage` into the Jev_Response.
5. WHILE the Provider is `openrouter`, THE JSON_Transport SHALL NOT send the header `TypeSafe-Danger-Zone-Images`.
6. WHEN the response status is not in the range 200 to 299, THE JSON_Transport SHALL raise an error that carries the HTTP status and a sanitized message and SHALL NOT include the API key, the Authorization header or the request body in the error.
7. THE JSON_Transport SHALL NOT be imported or called by any module outside `packages/ce/src/jev/`. The Verification_Script is outside `jev/` and SHALL reach the JSON_Transport only through the Probe_Library, which is inside `jev/`.
8. THE JSON_Transport SHALL be the only module that calls `fetch` for Jev.
9. THE SDK import boundary SHALL be as Requirement 13 criterion 1 states, and THE restriction on which module calls the SDK helpers SHALL be as Requirement 13 criterion 8(b) states.

### Requirement 4: Providers and pinned models

**User Story:** As a developer, I want to switch between OpenRouter and the direct TypeSafe API by configuration only, so that I can use whichever key I have.

#### Acceptance Criteria

1. WHILE `jev.provider` is `openrouter`, THE Gateway_Factory SHALL create transports with the base URL `https://openrouter.ai/api` and the API key from `OPENROUTER_API_KEY`.
2. WHILE `jev.provider` is `typesafe`, THE Gateway_Factory SHALL create transports with the base URL `https://api.typesafe.ai` and the API key from `TYPESAFE_API_KEY`.
3. THE Gateway_Factory SHALL pass the base URL, the API key, the `logLevel`, the `compression` and the `retry` options to the SDK client explicitly, so that the SDK does not read `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_API_KEY` or `TYPESAFE_LOG_LEVEL` from the process environment on its own.
4. THE Gateway_Factory SHALL read the API key only from the `env` parameter and SHALL NOT read `process.env` when `env` is given.
5. THE Jev gateway module SHALL define a constant table `PINNED_MODELS` with one entry per Provider, where `openrouter` is `typesafe/jev-1.14`.
6. WHEN the `meta.sources['jev.model']` of the Loaded_Config is `default`, THE Gateway_Factory SHALL request the `PINNED_MODELS` entry of the Provider.
7. WHEN the `meta.sources['jev.model']` of the Loaded_Config is `flag`, `env` or `file`, THE Gateway_Factory SHALL request the configured `jev.model` value.
8. IF `jev.provider` is `openrouter` and `jev.model` does not match the form `typesafe/<name>` or `~typesafe/<name>`, THEN THE Gateway_Factory SHALL return a failure result with a Validation_Error whose `path` is `jev.model`, whose `value` is the configured model, whose `source` is `meta.sources['jev.model']` and whose `expected` field states the form `typesafe/<name>` and that `jev-preview` is not valid on OpenRouter.
9. THE Gateway_Factory SHALL send the same requested model name in every request of the gateway instance.
10. THE Gateway_Factory SHALL require no code change to switch between Providers.
11. WHILE `jev.provider` is `typesafe`, THE Gateway_Factory SHALL NOT reject any `jev.model` value for its form, because the valid model form of the direct provider is unknown until Requirement 17 is answered. WHEN Requirement 17 is answered with an accepted model form, THE Gateway_Factory MAY validate that form, and the Findings_Document SHALL record the form.

### Requirement 5: Credentials

**User Story:** As a developer, I want a clear error that names the missing environment variable, so that I can fix a missing key without reading code.

#### Acceptance Criteria

1. WHEN the Gateway_Factory is called, THE Gateway_Factory SHALL call the Credential_Check `requireJevCredentials(loaded, env)` before it constructs a transport.
2. IF the Credential_Check returns a failure result, THEN THE Gateway_Factory SHALL return that failure result unchanged (`{ ok: false, errors }`), with a Validation_Error whose `expected` field names `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`, and SHALL NOT construct a transport and SHALL NOT make a network call.
3. THE Gateway_Factory SHALL NOT decide an Outcome. This criterion is a contract for the pipeline issue and not an acceptance item of issue #5, because `run()` does not exist yet: WHEN the Gateway_Factory returns a failure result, THE run pipeline SHALL resolve the run to the Outcome `ERROR` through the existing mechanism of Requirement 6 criterion 15 of the ce-config-loader spec (`reportConfigFailure`, exit code `1`). The tests of this spec cover only that the factory returns the failure result unchanged.
4. THE Gateway_Factory SHALL NOT include the value of an API key in a result, a Validation_Error, an error message, a log line or a Call_Log_Entry.
5. IF `jev.provider` is `openrouter` and `OPENROUTER_API_KEY` is empty or unset, THEN THE failure result of the Gateway_Factory SHALL name `OPENROUTER_API_KEY` and not `TYPESAFE_API_KEY`. IF `jev.provider` is `typesafe` and `TYPESAFE_API_KEY` is empty or unset, THEN THE failure result SHALL name `TYPESAFE_API_KEY` and not `OPENROUTER_API_KEY`.
6. WHEN the key for the selected Provider is set, THE Gateway_Factory SHALL return `{ ok: true, gateway }` where `gateway` is a Hybrid_Gateway.
7. THE Fake_Gateway SHALL NOT require any API key.

### Requirement 6: Error taxonomy

**User Story:** As a pipeline developer, I want separate errors for a failed image, a rate limit and a failed stage, so that the final step can fall back to text signals without hiding a real failure.

#### Acceptance Criteria

1. THE `jev/errors.ts` module SHALL export the classes `JevImageError`, `RateLimitError` and `JevUsageError`, and THE `packages/ce/src/errors.ts` module SHALL export the class `StageError`.
2. THE JevImageError SHALL NOT be an instance of RateLimitError, and THE RateLimitError SHALL NOT be an instance of JevImageError.
3. THE JevImageError SHALL carry a `reason` field with one of the values `bad_request`, `rate_limited`, `timeout`, `connection`, `server`, `invalid_image`, `invalid_response`, `client`, SHALL carry the HTTP `status` if and only if an HTTP status exists (WHEN no HTTP status exists, THE JevImageError SHALL NOT carry a `status` field), and SHALL carry `retryAfterMs` when the reason is `rate_limited` and the server sent a delay.
4. WHEN an Image_Request receives HTTP 400, 413 or 422, THE Hybrid_Gateway SHALL raise a JevImageError with reason `bad_request` and the status.
5. WHEN an Image_Request receives a response with a status of 500 or higher, THE Hybrid_Gateway SHALL raise a JevImageError with reason `server` and the status.
6. WHEN an Image_Request does not complete within the image timeout, THE Hybrid_Gateway SHALL raise a JevImageError with reason `timeout`.
7. WHEN an Image_Request fails at the connection level (DNS, TLS, closed connection), THE Hybrid_Gateway SHALL raise a JevImageError with reason `connection`.
8. IF an Image_Request succeeds with HTTP 200 but the answers lack a requested question name, THEN THE Hybrid_Gateway SHALL raise a JevImageError with reason `invalid_response`.
9. WHEN an Image_Request receives HTTP 429, THE Hybrid_Gateway SHALL treat the response as a rate limit under Requirement 7. IF the rate limit persists after the retries of Requirement 7, THEN THE Hybrid_Gateway SHALL raise a JevImageError with reason `rate_limited` and status 429, and SHALL NOT raise a StageError or a RateLimitError, so that a rate-limited image step never fails the run.
10. WHEN a Jev_Request receives HTTP 401 or 403, THE Hybrid_Gateway SHALL raise a StageError whose `cause` is the authentication error, for both Text_Requests and Image_Requests.
11. WHEN a rate limit of a Text_Request persists after the retries of Requirement 7, THE Hybrid_Gateway SHALL raise a StageError whose `stage` is the stage of the Jev_Request and whose `cause` is a RateLimitError.
12. WHEN a Text_Request fails for any other reason (HTTP 4xx other than 429, a Transient_Failure that persists after the retries of Requirement 7 criterion 16, a local SDK `TypeSafeError`), THE Hybrid_Gateway SHALL raise a StageError whose `stage` is the stage of the Jev_Request and whose `cause` is the underlying error.
13. THE Hybrid_Gateway SHALL NOT wrap a JevImageError in a StageError, so that the caller can recover from it.
14. THE Hybrid_Gateway SHALL NOT decide an Outcome, SHALL NOT import `outcome/resolve.ts` and SHALL NOT produce an Outcome value.
15. THE error messages of JevImageError, RateLimitError and StageError SHALL NOT contain the API key, the Authorization header, the state text or the image bytes.
16. FOR ALL failure kinds of an Image_Request, THE error that the Hybrid_Gateway raises SHALL be a JevImageError or, for HTTP 401 and 403 only, a StageError for authentication, and never a RateLimitError, a StageError for any other cause, an uncaught SDK error or a `fetch` error (classification property).
17. WHEN an Image_Request fails with an HTTP status 4xx that criteria 4 and 9 do not cover (including 404 and 409), or with a local SDK `TypeSafeError` that is not an API error (for example a validation error), THE Hybrid_Gateway SHALL raise a JevImageError with reason `client` and the status when one exists. WHEN an Image_Request receives HTTP 408, THE Hybrid_Gateway SHALL raise a JevImageError with reason `timeout` and status 408.
18. WHEN the `AskOptions.signal` of a Jev_Request aborts, THE Hybrid_Gateway SHALL raise a JevImageError with reason `timeout` for an Image_Request, and a StageError whose `cause` is the abort reason of the signal for a Text_Request. THE Hybrid_Gateway SHALL NOT retry after an abort.
19. THE JevUsageError SHALL be the error of the second Image_Request of Requirement 7 criterion 11, SHALL be neither a JevImageError nor a StageError, and SHALL be exported from the package index (Requirement 13 criterion 7).

### Requirement 7: Request pacing, retries and rate limits

**User Story:** As a pipeline developer, I want one request per state, bounded concurrency, one owner of all retries and honoured retry delays, so that CE stays inside the provider rate limits and the attempt count is exact.

#### Acceptance Criteria

1. THE Hybrid_Gateway SHALL send one HTTP request per Jev_Request attempt, so that all questions about one state share one request.
2. THE Hybrid_Gateway SHALL accept a `maxConcurrent` constructor option, a positive integer with the default 4.
3. IF `maxConcurrent` is not a positive integer, THEN THE Hybrid_Gateway constructor SHALL throw a `RangeError` that names the option.
4. THE Hybrid_Gateway SHALL keep the number of requests in flight at or below `maxConcurrent`, and SHALL start each waiting request in submission order when a slot is free.
5. WHEN a response has HTTP 429, THE Hybrid_Gateway SHALL wait for the delay in the `retry-after-ms` header, or else the `Retry-After` header (delta-seconds or HTTP date), before the next attempt.
6. IF a 429 response has neither header, THEN THE Hybrid_Gateway SHALL wait for an exponential backoff that starts at 500 ms, doubles per attempt and does not exceed 5000 ms.
7. THE Hybrid_Gateway SHALL accept a `maxRateLimitRetries` constructor option, a non-negative integer with the default 2, where 0 disables rate-limit retries, and SHALL retry a rate-limited request at most `maxRateLimitRetries` times. IF `maxRateLimitRetries` is not a non-negative integer, THEN THE Hybrid_Gateway constructor SHALL throw a `RangeError` that names the option.
8. IF a `Retry-After` delay exceeds 60 000 ms, THEN THE Hybrid_Gateway SHALL stop retrying and raise the persistent-rate-limit error of its request kind at once: the RateLimitError inside a StageError for a Text_Request (Requirement 6 criterion 11), and a JevImageError with reason `rate_limited` for an Image_Request (Requirement 6 criterion 9).
9. THE RateLimitError and a JevImageError with reason `rate_limited` SHALL carry `retryAfterMs` equal to the server delay in milliseconds, or `undefined` when no valid delay was sent.
10. THE Hybrid_Gateway SHALL NOT retry an Image_Request after a 400, a 5xx, a timeout, a connection failure or an abort. An Image_Request is retried only after a 429, so that the single final-screenshot request stays inside its time budget and fails over to text signals quickly.
11. THE Hybrid_Gateway SHALL send at most one Image_Request per gateway instance. IF a second Image_Request is submitted, THEN THE Hybrid_Gateway SHALL reject it with a `JevUsageError` and SHALL NOT send a network request.
12. THE Hybrid_Gateway SHALL accept a `sleep` function as a constructor option, with a default that uses real timers, so that tests wait for no real time.
13. THE Hybrid_Gateway SHALL configure the SDK client with `logLevel: 'off'` set explicitly and no logger, so that no state text reaches the console, and so that the SDK does not read `TYPESAFE_LOG_LEVEL` (the SDK logs request bodies at level `debug`).
14. FOR ALL sets of N concurrent Jev_Requests and limits L, THE number of requests in flight at any time SHALL NOT exceed L, and all N requests SHALL complete (concurrency property).
15. FOR ALL `Retry-After` header values in delta-seconds or HTTP-date form, THE delay parser SHALL return the delay in milliseconds, non-negative and rounded to a whole number, and SHALL return `undefined` for text that is neither form (retry-after parsing property).
16. THE Hybrid_Gateway SHALL accept a `maxTransientRetries` constructor option, a non-negative integer with the default 2 (a `RangeError` that names the option otherwise), and SHALL retry a Text_Request after a Transient_Failure at most `maxTransientRetries` times, using the delay rules of criteria 5 and 6 (a `Retry-After` header when present, else the exponential backoff).
17. THE Hybrid_Gateway SHALL construct the SDK client with `retry: { maxRetries: 0 }`, so that the SDK never retries and the Hybrid_Gateway is the only owner of retries. The SDK default (`maxRetries` 2 for 408, 429, 5xx, connection errors and timeouts) would otherwise multiply with the gateway retries.
18. THE Call_Log `attempts` of a call SHALL equal the number of HTTP requests that the Hybrid_Gateway sent for that call, and SHALL be at most 1 plus `maxRateLimitRetries` plus `maxTransientRetries` for a Text_Request, and at most 1 plus `maxRateLimitRetries` for an Image_Request.
19. THE Hybrid_Gateway SHALL construct the SDK client with `compression: false` set explicitly, so that behaviour does not depend on whether the Node.js runtime supports zstd (Node.js 22.15 or newer), because `engines.node` is `>=22.12`.
20. FOR ALL sequences of HTTP outcomes of one Text_Request, THE number of HTTP requests sent SHALL NOT exceed 1 plus `maxRateLimitRetries` plus `maxTransientRetries`, and THE number sent for an Image_Request SHALL NOT exceed 1 plus `maxRateLimitRetries` (attempt-bound property).

### Requirement 8: Model id recording

**User Story:** As a reviewer, I want the dated model id that the API returned, so that a run can be traced to an exact model version.

#### Acceptance Criteria

1. THE Jev_Response SHALL contain the Returned_Model_Id, read from the `model` field of the API response, and not the requested model name.
2. THE Hybrid_Gateway SHALL expose a method `modelIds()` that returns the list of distinct Returned_Model_Ids seen by the gateway instance, in order of first appearance.
3. THE Hybrid_Gateway SHALL expose the requested model name through a property `requestedModel`.
4. IF an API response contains no `model` field or an empty one, THEN THE Hybrid_Gateway SHALL raise a StageError for a Text_Request and a JevImageError with reason `invalid_response` for an Image_Request. THIS rule applies only to Text_Requests and Image_Requests, and any other request kind is out of scope of this criterion.
5. WHEN the Returned_Model_Ids of one gateway instance contain more than one value, THE `modelIds()` method SHALL return all of them, so that the evidence bundle writer can record the change.
6. THE Call_Log_Entry of every successful call SHALL contain the Returned_Model_Id (Requirement 12).
7. FOR ALL sequences of responses with model ids, THE result of `modelIds()` SHALL contain each distinct id exactly once, in order of first appearance (order-preserving set property).

### Requirement 9: Question catalog

**User Story:** As a maintainer, I want all Jev question text in one versioned file, so that a change to a question is visible and reviewed.

#### Acceptance Criteria

1. THE Question_Catalog SHALL define exactly the eight Catalog_Entries of design section 4: `claim.is_behavior`, `assess.runtime_observable`, `assess.checks_adequate`, `assess.surface`, `runtime.next_action`, `runtime.state_reached_dom`, `runtime.state_reached` and `runtime.locate_subject`.
2. THE Question_Catalog SHALL give every Catalog_Entry an integer version, starting at 1, and SHALL expose the entry as `id@version`.
3. THE Question_Catalog SHALL give every Catalog_Entry the type of design section 4: Noul for `claim.is_behavior`, `assess.runtime_observable`, `assess.checks_adequate`, `runtime.state_reached_dom` and `runtime.state_reached`; Choice for `assess.surface` (six labels) and `runtime.next_action`; Box for `runtime.locate_subject`.
4. THE `assess.surface` Catalog_Entry SHALL offer the six labels `browser_ui`, `http_api`, `cli`, `backend_internal`, `native_app` and `non_runtime`.
5. THE `runtime.next_action` Catalog_Entry SHALL take a list of options and SHALL add the two options `done` and `give_up`.
6. IF the list of options of `runtime.next_action` has more than 240 items, THEN THE Question_Catalog SHALL throw a `RangeError` that names the limit 240, because ranking and truncation belong to the runtime.
7. THE Question_Catalog SHALL mark `runtime.state_reached` and `runtime.locate_subject` as requiring an image, and SHALL mark every other entry as text only.
8. THE Question_Catalog SHALL be the only module that contains question text. No other module, including both transports, SHALL call the SDK helpers `noul`, `choice`, `score`, `box`, `image` or `withAssets`.
9. THE Question_Catalog SHALL return, for each entry, the question together with its id, version, type and a flag `labelsFixed`, so that the Call_Log can record ids without question text. THE flag SHALL be true for entries whose option labels are constants of the catalog (`assess.surface`, and the labels `done` and `give_up`) and false for entries whose labels come from the observed page (`runtime.next_action`).
10. WHEN the text of a Catalog_Entry changes and its version does not change, THE test suite SHALL fail with a message that names the entry and states that the version must be incremented. THE committed file `packages/ce/src/jev/catalog.snapshot.json` SHALL hold, per `id@version`, the SHA-256 digest of the built question for fixed sample inputs.
11. FOR ALL option lists with 1 to 240 items, THE `runtime.next_action` question SHALL contain exactly the given option labels plus `done` and `give_up`, with no label lost or duplicated (option preservation property).
12. THE hash stored under an existing `id@version` key of `catalog.snapshot.json` SHALL never change. THE snapshot update script SHALL only add keys for new `id@version` values, SHALL fail when the digest it computes for an existing key differs from the stored digest, and SHALL never remove or overwrite a key. THE test suite SHALL fail when an `id@version` of the catalog has no snapshot key, and SHALL fail when a snapshot digest differs from the built question.
13. THE Question_Catalog SHALL export a builder `finalImageQuestions(claim, pngBytes)` that returns the Jev_Request of the Final_Image_Request: the state text with the image built by `image(pngBytes)` and `withAssets`, and the questions `runtime.state_reached` and `runtime.locate_subject`. THE runtime and the Probe_Library SHALL call this builder and SHALL NOT build image requests themselves.

### Requirement 10: State hash

**User Story:** As a maintainer, I want a stable hash of each state, so that the fake can replay answers and the log can identify a state without storing it.

#### Acceptance Criteria

1. THE `jev/hash.ts` module SHALL export `stateHash(state)` that returns the lowercase hexadecimal SHA-256 digest of the canonical encoding of the state.
2. THE canonical encoding of a state SHALL start with the domain prefix `ce-state-v1` followed by the byte `0x00`, and SHALL continue with the UTF-8 bytes of the state text. THE canonical encoding of a text-only state SHALL end there.
3. THE canonical encoding of a state with image assets SHALL replace every asset reference of the SDK form `<image:` plus 32 lowercase hex digits `>` in the text with a positional placeholder `<image:0>`, `<image:1>` and so on, numbered in order of first appearance in the text, and SHALL then append, for each image in that order, a separator byte `0x00` and the SHA-256 digest of the image bytes. Assets that the text does not reference SHALL be numbered after the referenced ones, in asset order. The random reference of an asset SHALL NOT influence the State_Hash. THE reference format that this criterion relies on SHALL be guarded by the test of criterion 9.
4. FOR ALL states, THE `stateHash` function SHALL return the same value on every call (determinism property).
5. FOR ALL pairs of distinct text states, THE `stateHash` values SHALL differ (distinctness property, tested on generated strings).
6. THE `stateHash` function SHALL return exactly 64 hexadecimal characters.
7. THE `stateHash` function SHALL NOT depend on the question set, the stage or the model.
8. FOR ALL texts and image byte arrays, THE `stateHash` of two states built from two separately constructed Image objects with the same bytes and the same surrounding text SHALL be equal, and the `stateHash` of two states with different image bytes SHALL differ (image-determinism property).
9. THE test suite SHALL include a keyless unit test that constructs an image with the real SDK helper `image` and asserts that its reference string matches the regular expression `^<image:[0-9a-f]{32}>$` exactly, so that an SDK upgrade that changes the reference format fails this test and does not silently make the State_Hash unstable. THE test SHALL construct the image through the Question_Catalog or a file excluded from the architecture test of Requirement 13 criterion 8, and SHALL NOT use a stub of the SDK.

### Requirement 11: Fake gateway

**User Story:** As a maintainer, I want a fake gateway that replays recorded answers, so that all tests and the eval run without an API key.

#### Acceptance Criteria

1. THE Fake_Gateway SHALL implement the Jev_Gateway interface.
2. THE Fake_Gateway SHALL be constructed from a list of Recordings, each with a versioned Catalog_Entry `id@version`, a State_Hash, a question name, an answer, and optionally a model id and usage.
3. WHEN the Fake_Gateway receives a Jev_Request, THE Fake_Gateway SHALL compute the State_Hash of the state and SHALL return, for each question, the answer of the Recording whose `id@version`, State_Hash and question name all match. THE question name SHALL be part of the key, so that two questions of one request with the same Catalog_Entry do not collide.
4. IF a requested question has no matching Recording, including when only a Recording of another version of the same Catalog_Entry exists, THEN THE Fake_Gateway SHALL throw a `FakeRecordingMissingError` that names the `id@version`, the question name and the State_Hash, and SHALL NOT return a default answer. THE FakeRecordingMissingError SHALL be exported from the package index.
5. THE Fake_Gateway SHALL make no network call, SHALL NOT call `fetch` and SHALL NOT read any environment variable.
6. THE Fake_Gateway SHALL return a Jev_Response of the same type as the Hybrid_Gateway, with a model id (default `typesafe/jev-1.14-fake`) and usage.
7. THE Fake_Gateway SHALL support a scripted failure for a Recording: `image-multipart-400`, `image-timeout`, `image-rate-limit`, `rate-limit` and `unauthorized`.
8. WHEN a Recording has the scripted failure `image-multipart-400`, THE Fake_Gateway SHALL raise a JevImageError with reason `bad_request`, status 400 and the message `invalid content-type: multipart/form-data`, the same error that the Hybrid_Gateway raises for a real multipart 400.
9. WHEN a Recording has the scripted failure `rate-limit`, THE Fake_Gateway SHALL raise a StageError whose `cause` is a RateLimitError. WHEN a Recording has the scripted failure `image-rate-limit`, THE Fake_Gateway SHALL raise a JevImageError with reason `rate_limited` and status 429.
10. THE Fake_Gateway SHALL write one Call_Log_Entry per call to the same Call_Log interface as the Hybrid_Gateway, with transport `fake` and latency 0.
11. THE test suite SHALL include a fixture file `packages/ce/src/jev/fixtures/recordings.json` with Recordings derived from the spike samples for `choice`, `noul`, `score`, `next_action` and the raw JSON `box` answer, and SHALL replay them through the Fake_Gateway.
12. FOR ALL Recordings and Jev_Requests whose `id@version`, question names and State_Hash match the Recordings, THE answer that the Fake_Gateway returns SHALL equal the recorded answer (replay round-trip property).

### Requirement 12: Call log

**User Story:** As a reviewer, I want a log of every Jev call without the state contents, so that I can audit the calls without leaking the change or the screenshot.

#### Acceptance Criteria

1. THE `jev/log.ts` module SHALL export a `CallLog` interface with one method `append(entry)` and a function `createJsonlCallLog(path)` that appends one JSON object per line to the file at `path`.
2. THE Hybrid_Gateway and THE Fake_Gateway SHALL append one Call_Log_Entry for every call, successful or failed, after the call ends. One call is one `ask`, including all of its attempts.
3. THE Call_Log_Entry SHALL contain the fields `timestamp` (ISO 8601 UTC), `stage`, `transport` (`sdk`, `json` or `fake`), `provider`, `requestedModel`, `model` (the Returned_Model_Id, or `null` on failure), `questions` (a list of `{ id, version, type }`), `answers` (per question: the noul probability, the choice `probabilities`, the score `probabilities`, or the box coordinates with `confidence`), `latencyMs`, `usage` (`input_tokens`, `output_tokens`), `stateHash`, `status` (`ok` or `error`), `attempts`, and on failure `errorKind` and `httpStatus`. THE `timestamp` SHALL be the time at which the first attempt of the call was sent. THE `latencyMs` SHALL be the elapsed milliseconds from that moment to the end of the last attempt, including the backoff waits between attempts and excluding the wait for a free concurrency slot. THE `attempts` SHALL be as Requirement 7 criterion 18 states. THE `errorKind` SHALL be the JevImageError reason, `rate_limit`, `auth`, `abort` or `other`.
4. THE Call_Log_Entry SHALL NOT contain the state text, the image bytes, the question instructions, the option descriptions, the API key or the Authorization header.
5. THE Call_Log_Entry MAY contain question names and the labels of a Catalog_Entry whose `labelsFixed` flag is true. For a Catalog_Entry whose `labelsFixed` flag is false (`runtime.next_action`), THE Call_Log_Entry SHALL record each choice probability under the zero-based index of the option in the request, and SHALL record the two added options under the fixed keys `done` and `give_up`, and SHALL NOT record the option label text, because the labels come from page text and may contain values of `runtime.fixtures`.
6. THE Call_Log SHALL use the schema `CallLogEntrySchema` (zod) in `jev/log.ts`, and `append` SHALL reject an entry that does not match the schema before writing.
7. IF the Call_Log cannot be written, THEN THE Hybrid_Gateway SHALL raise a StageError with the stage of the request and the write error as `cause`. WHEN a call fails AND the append of its error Call_Log_Entry also fails, THE Hybrid_Gateway SHALL raise this StageError for the log write failure, superseding the original call error, and SHALL attach the original call error to the StageError in a field `callError` so that the original failure stays diagnosable. THE `callError` field SHALL be subject to Requirement 6 criterion 15.
8. WHEN a call fails, THE Hybrid_Gateway SHALL append the Call_Log_Entry with `status: "error"` before it raises the error.
9. THE `createJsonlCallLog` function SHALL create the parent directory of `path` when the directory does not exist.
10. FOR ALL Call_Log_Entries, parsing the written line as JSON and validating it with `CallLogEntrySchema` SHALL succeed and SHALL give an object equal to the entry (round-trip property).
11. FOR ALL generated states, option labels of `runtime.next_action`, secrets and calls, THE serialized Call_Log SHALL contain neither any generated state text of 8 or more characters, nor any generated option label of 8 or more characters, nor the API key as a substring (no-contents property).
12. THE `createJsonlCallLog` function SHALL serialize appends through a queue, so that every line is written whole and lines never interleave while the Hybrid_Gateway runs with `maxConcurrent` greater than 1, and SHALL write the lines in the order in which `append` was called.
13. FOR ALL sets of N Call_Log_Entries appended concurrently, THE file SHALL contain exactly N lines, each line SHALL parse as JSON and validate with `CallLogEntrySchema`, and the multiset of parsed entries SHALL equal the multiset of the appended entries (concurrent-append property).

### Requirement 13: Module boundaries and public API

**User Story:** As a contributor, I want the two transports and the SDK confined to `jev/`, so that deleting the JSON transport later changes nothing outside `jev/`.

#### Acceptance Criteria

1. THE codebase SHALL import `@typesafe-ai/sdk` only in files under `packages/ce/src/jev/`.
2. THE codebase SHALL call `fetch` for Jev only in `packages/ce/src/jev/transport-json.ts`. Files outside `packages/ce/src/jev/` (for example `runtime/target.ts`) MAY call `fetch` for other purposes.
3. THE codebase SHALL NOT inject a custom `fetch` into the SDK client, and SHALL NOT rewrite multipart requests.
4. THE `jev/gateway.ts` module SHALL contain a header comment that states the exit plan: when the SDK can send images as JSON or OpenRouter accepts multipart, delete `transport-json.ts`, route all requests through the SDK_Transport and keep the Jev_Gateway interface.
5. THE transport routing SHALL live in `jev/gateway.ts`, so that deleting `transport-json.ts` and its route changes no file outside `jev/`.
6. THE `packages/ce/package.json` SHALL declare the dependency `"@typesafe-ai/sdk": "0.7.0"` as an exact version, without a range.
7. THE `packages/ce/src/index.ts` module SHALL export the `JevGateway` type, the `AskOptions` type, `createJevGateway`, `FakeJevGateway`, `FakeRecordingMissingError`, `JevImageError`, `RateLimitError`, `JevUsageError` and `StageError`, and SHALL NOT export either transport or the Probe_Library. `JevUsageError` and `FakeRecordingMissingError` are public because callers and tests must tell a misuse or a missing recording from a run failure.
8. THE test suite SHALL include an architecture test that scans `packages/ce/src` and fails when (a) a file outside `jev/` imports `@typesafe-ai/sdk`, (b) a file other than `jev/catalog.ts` calls the SDK helpers `noul(`, `choice(`, `score(`, `box(`, `image(` or `withAssets(`, (c) a file under `jev/` other than `jev/transport-json.ts` calls `fetch(`, (d) a file under `jev/` imports `outcome/resolve`, (e) a file under `packages/ce/src/scripts/` imports any module other than `jev/probe` and Node.js built-in modules, (f) a file outside `jev/` imports `jev/transport-sdk` or `jev/transport-json`. THE architecture test SHALL exclude files that match `*.test.ts` and files under a `properties/` directory from every rule.
9. THE jev module SHALL NOT write any file other than the Call_Log, SHALL NOT read Git and SHALL NOT write to the target application.

### Requirement 14: Verification tooling

**User Story:** As a maintainer, I want a manual script for the live verification, so that the three open items are measured with the real gateway code and recorded.

#### Acceptance Criteria

1. THE Verification_Script SHALL accept a command `latency`, `image-url`, `typesafe` or `all`, and the options `--samples <n>` (default 20), `--image <path>` (default the Fixture_Image) and `--out <dir>`.
2. THE Verification_Script SHALL read API keys only from `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` in the process environment, including variables that the `--env-file-if-exists` flag of criterion 9 loads from the repository `.env`, and SHALL NOT accept a key as a command-line argument. A variable that is already set in the process environment SHALL win over the same variable in `.env`.
3. THE Verification_Script SHALL NOT be run by `npm test`, SHALL NOT match the vitest test file pattern and SHALL NOT be called from any test.
4. WHEN the environment variable `CI` is `true` and the option `--allow-ci` is absent, THE Verification_Script SHALL exit with code 2 immediately, before it reads or validates any API key or other environment variable and without any network call, so that it never reaches the exit-code-3 path of criterion 5.
5. IF the key that a command needs is unset or empty, THEN THE Verification_Script SHALL exit with code 3, print the name of the environment variable, and record the item as `not tested (blocked: <variable> not set)` without printing a measured value.
6. THE Verification_Script SHALL import only the Probe_Library from `jev/` (and Node.js built-in modules), SHALL reach the gateway and the transports only through the Probe_Functions, and SHALL NOT call `fetch` itself. THE Probe_Functions SHALL use the real Hybrid_Gateway and the real transports, so that the measurement covers the production code path.
7. THE Verification_Script SHALL write one raw sample file per call under `--out` (default `docs/journal/v0.0/samples/<UTC timestamp>-gateway/`), containing the status, latency, Returned_Model_Id, usage, question names and sanitized error text, and SHALL NOT write the image bytes, the API key or the Authorization header.
8. THE Probe_Library SHALL hold the logic that does not need a network: the percentile statistics, the request shapes, the result records and the Answer_Status text, so that the logic is tested without a key.
9. THE `packages/ce/package.json` SHALL contain the script `verify:jev-image` with the value `tsx --env-file-if-exists=../../.env src/scripts/verify-jev-image.ts`, so that the keys in the gitignored repository `.env` are loaded when the file exists and no variable that is already set is overridden.
10. THE Verification_Script SHALL print a summary of each Verification_Item as a Markdown block that the implementer can paste into the Findings_Document.
11. THE Fixture_Image SHALL be committed at `packages/ce/fixtures/jev/demo-app-screenshot.png`.
12. THE Probe_Library SHALL export the Probe_Functions with these behaviours: `sendText(options)` sends one Text_Request through a new Hybrid_Gateway; `sendFinalImage(options)` builds a new Hybrid_Gateway with `maxRateLimitRetries` 0, builds the request with `finalImageQuestions` and sends it, so that each sample uses its own gateway instance (Requirement 7 criterion 11); `sendSdkImage(options)` sends one Image_Request through the SDK_Transport directly, bypassing the routing of the Hybrid_Gateway, to test whether the provider accepts the SDK multipart upload; `sendImageUrlForm(options)` sends the array-form request of Requirement 16 through the JSON_Transport. THE options of every Probe_Function SHALL include the Provider, the API key, the model, the image bytes and, for the JSON_Transport, a boolean `dangerZoneHeader` that defaults to false.
13. THE Probe_Functions SHALL return a result record with the status, the latency, the Returned_Model_Id, the usage and the sanitized error text, and SHALL NOT throw for an HTTP failure.

### Requirement 15: Verification item, final-image latency

**User Story:** As a maintainer, I want the measured latency of the final image request over the JSON transport, so that the design can state whether the final step fits its time budget.

#### Acceptance Criteria

1. WHEN the command `latency` runs with `OPENROUTER_API_KEY` set, THE Verification_Script SHALL send 20 Final_Image_Requests one after another, on the Pinned_Model of `openrouter`, with the Fixture_Image, the questions `runtime.state_reached` and `runtime.locate_subject`, and with rate-limit retries disabled (`maxRateLimitRetries` 0), by calling `probe.sendFinalImage` once per sample.
2. THE Verification_Script SHALL start each request after the previous one has ended.
3. THE Probe_Library SHALL compute p50, p95, minimum, maximum, success count and failure count over the latency of the successful requests only, using the nearest-rank method (`sorted[ceil(p / 100 * n) - 1]`).
4. THE Probe_Library SHALL return `NaN` for the percentiles of an empty sample list, and SHALL NOT throw.
5. THE Findings_Document SHALL record for the latency item: the date, the number of requests sent, the success and failure counts, p50, p95, minimum and maximum in milliseconds, the Returned_Model_Id, the Provider, the transport, and the statement whether p95 is below the per-step budget of 7500 ms (design section 5).
6. IF no request of the 20 succeeds, THEN THE Findings_Document SHALL record the Answer_Status `not supported`, the HTTP status and the sanitized error text of the failures, and SHALL NOT record a percentile.
7. FOR ALL non-empty lists of latencies, THE statistics SHALL satisfy minimum ≤ p50 ≤ p95 ≤ maximum, and SHALL NOT change when the list is reordered (percentile property).

### Requirement 16: Verification item, image_url array form

**User Story:** As a maintainer, I want to know whether an image and a text state can go in one request through the `image_url` array form, so that the design can decide whether to keep image and text states separate.

#### Acceptance Criteria

1. WHEN the command `image-url` runs with `OPENROUTER_API_KEY` set, THE Verification_Script SHALL send one request, by calling `probe.sendImageUrlForm`, over the JSON_Transport whose state is the array form that combines a text part and an `image_url` part carrying the Fixture_Image, with one `noul` question that depends on both parts.
2. THE Probe_Library SHALL build the request body for the array form from the shape in the TypeSafe API reference (`https://docs.typesafe.ai/api.md`), and the Findings_Document SHALL record the shape used. THE implementer SHALL NOT edit `design.md` (Requirement 18 criterion 6).
3. THE Findings_Document SHALL record for the `image_url` item: the date, the request shape, the HTTP status, the sanitized error text when rejected, the answer when accepted, and whether the answer used both parts.
4. WHEN the request is accepted and the answer uses both parts, THE Findings_Document SHALL record the Answer_Status `confirmed`.
5. WHEN the request is rejected, or accepted but the answer ignores one part, THE Findings_Document SHALL record the Answer_Status `not supported` with the evidence.
6. THE Verification_Script SHALL NOT change the request shape of the Hybrid_Gateway. IF the form is confirmed, THEN adopting it SHALL be a separate decision recorded in the Findings_Document as a recommendation.

### Requirement 17: Verification item, direct typesafe provider

**User Story:** As a maintainer, I want to know whether the direct `typesafe` provider works with the gateway, so that R11 criterion 6 is verified for both providers.

#### Acceptance Criteria

1. WHEN the command `typesafe` runs with `TYPESAFE_API_KEY` set, THE Verification_Script SHALL send, with `jev.provider` `typesafe`, by calling the Probe_Functions: one Text_Request through the SDK_Transport (`probe.sendText`), one Image_Request through the JSON_Transport (`probe.sendFinalImage`, first without the header `TypeSafe-Danger-Zone-Images` and, only when that request is rejected, once more with `dangerZoneHeader` true), and one Image_Request through the SDK_Transport (`probe.sendSdkImage`).
2. THE Findings_Document SHALL record for the direct provider: the date, the model name that the API accepted, the Returned_Model_Id, the status and latency of each of the three requests, whether the SDK multipart image request is accepted, and whether the JSON_Transport needs the header `TypeSafe-Danger-Zone-Images`.
3. WHEN the SDK multipart image request is accepted by the direct provider, THE Findings_Document SHALL record that the SDK_Transport is sufficient for the direct provider, as input to the exit plan.
4. WHERE the Findings_Document records that the direct provider requires the header `TypeSafe-Danger-Zone-Images` on the JSON path, THE JSON_Transport SHALL send the header while the Provider is `typesafe` and SHALL NOT send it while the Provider is `openrouter`.
5. WHEN the direct provider accepts a model name that differs from `typesafe/jev-1.14`, THE `PINNED_MODELS` entry of `typesafe` SHALL be changed to the accepted name, and the code comment that marks the entry unverified SHALL be removed.
6. WHEN the direct provider accepts the model name `typesafe/jev-1.14`, THE code comment that marks the `typesafe` entry unverified SHALL be removed.
7. IF the direct provider rejects every request, THEN THE Findings_Document SHALL record the Answer_Status `not supported` with the HTTP status and sanitized error text, and the `typesafe` entry of `PINNED_MODELS` SHALL keep the unverified comment and a pointer to the Findings_Document.
8. IF `TYPESAFE_API_KEY` is not set in the process environment and not in the repository `.env`, THEN THE implementer SHALL NOT ask the user, SHALL run no probe for this item, and SHALL record directly the Answer_Status `not tested (blocked: TYPESAFE_API_KEY not set)` in the Findings_Document, SHALL create the Follow_Up_Issue itself with `gh issue create --repo rfxlamia/ce` and the title "Verify direct typesafe provider" (body: what to verify, the three requests of criterion 1, a link to issue #5 and a link to the Findings_Document), SHALL link the Follow_Up_Issue in the Findings_Document and in the code comment of the `typesafe` entry of `PINNED_MODELS` (which keeps the unverified marker and a pointer to the Findings_Document), and the task for this Verification_Item SHALL then be complete. THE implementer SHALL NOT invent, estimate or copy any result for this item (Requirement 18 criteria 4 and 5). IF `TYPESAFE_API_KEY` is set, THEN THE implementer SHALL run the probes of criterion 1 and record the measured results.
9. THE code path of the direct provider SHALL be covered keyless by tests with stub transports and an injected `fetch`: the base URL `https://api.typesafe.ai`, the variable name `TYPESAFE_API_KEY`, the missing-key failure result, and the rule of criterion 4 for the header (Requirements 4, 5 and 19 criterion 7).

### Requirement 18: Findings document and no fabricated results

**User Story:** As the project owner, I want each live verification recorded honestly, so that the journal can be trusted.

#### Acceptance Criteria

1. THE Findings_Document SHALL be created at `docs/journal/v0.0/jev-gateway-verification.md`, SHALL link to `spike-jev-openrouter.md` and issue #5, and SHALL state that it answers open items 1 and 2 of `design.md` section 12.
2. THE Findings_Document SHALL contain one section per Verification_Item, each with an Answer_Status.
3. THE Findings_Document SHALL contain only values that were measured by a run of the Verification_Script, with the path of the raw samples directory for each item.
4. THE implementer SHALL run the Verification_Script for Requirements 15 and 16 itself (`npm run verify:jev-image`), SHALL load `OPENROUTER_API_KEY` from the gitignored repository `.env` through the script flag of Requirement 14 criterion 9, SHALL check the presence of the variable by name only and SHALL NOT print, log or copy its value, and SHALL NOT ask the user to run a command or to supply a key. IF `OPENROUTER_API_KEY` is not set in the process environment and not in the repository `.env`, THEN THE implementer SHALL record the Answer_Status `not tested (blocked: OPENROUTER_API_KEY not set)` for each affected item in the Findings_Document and SHALL report the task as failed. IF the live call fails and returns no HTTP response for any request (connection failure, timeout or script error), THEN THE implementer SHALL record the sanitized real error and the Answer_Status `not tested (blocked: live call failed)` in the Findings_Document and SHALL report the task as failed. IF the provider answers with an HTTP error status, THEN that status is a real answer and Requirements 15 criterion 6 and 16 criterion 5 apply. IF `TYPESAFE_API_KEY` is not available, THEN THE implementer SHALL follow Requirement 17 criterion 8.
5. IF a key is not available or a live call fails, THEN THE implementer SHALL NOT invent, estimate or copy a result for the item that needs it, and SHALL NOT mark that Verification_Item as `confirmed` or `not supported` unless the status follows from a real HTTP response.
6. THE implementer SHALL NOT edit `docs/journal/v0.0/design.md`, `docs/journal/v0.0/requirements.md` or `docs/journal/v0.0/spike-jev-openrouter.md`.
7. THE Findings_Document SHALL NOT contain an API key, an Authorization header or the image bytes.
8. WHEN the Verification_Items of Requirements 15 and 16 have an Answer_Status of `confirmed` or `not supported`, AND the Verification_Item of Requirement 17 has an Answer_Status of `confirmed`, `not supported` or `not tested (blocked: TYPESAFE_API_KEY not set)`, THE condition `verification_items_answered` SHALL hold. THE Follow_Up_Issue link SHALL be required only when the Answer_Status of Requirement 17 is `not tested (blocked: TYPESAFE_API_KEY not set)`, and SHALL NOT be required when that status is `confirmed` or `not supported`.

### Requirement 19: Test coverage

**User Story:** As a maintainer, I want keyless tests that prove routing, errors, replay and logging, so that the gateway stays correct when the SDK or the API changes.

#### Acceptance Criteria

1. THE test suite SHALL run without any API key set, using the Fake_Gateway, stub transports and an injected `fetch` function.
2. THE test suite SHALL include unit tests that a Text_Request uses the SDK_Transport stub and an Image_Request uses the JSON_Transport stub.
3. THE test suite SHALL include a unit test that the JSON_Transport, with an injected `fetch` that returns HTTP 400 with the body `invalid content-type: multipart/form-data`, raises a JevImageError with reason `bad_request`.
4. THE test suite SHALL include a unit test that the Fake_Gateway with the scripted failure `image-multipart-400` raises a JevImageError.
5. THE test suite SHALL include unit tests for JevImageError on timeout, connection failure, HTTP 500 (not retried), HTTP 404 (reason `client`), a local SDK `TypeSafeError` (reason `client`), an abort (reason `timeout`) and an answer that lacks a requested question.
6. THE test suite SHALL include unit tests that HTTP 429 with `retry-after`, `retry-after-ms`, and without a header leads to the waits of Requirement 7, using an injected `sleep`, and that exhausted retries raise a StageError whose `cause` is a RateLimitError for a Text_Request and a JevImageError with reason `rate_limited` for an Image_Request.
7. THE test suite SHALL include unit tests for the Gateway_Factory: a missing key for each Provider returns a failure result that names the variable, a present key returns a gateway, and `jev-preview` on `openrouter` returns a Validation_Error with `path` `jev.model`. THIS criterion SHALL hold only when all three sub-tests pass together (conjunction).
8. THE test suite SHALL include unit tests for the second Image_Request (`JevUsageError`) and for `modelIds()`.
9. THE test suite SHALL include one fast-check property test per property named in Requirements 1, 2, 6, 7, 8, 9, 10, 11, 12 and 15 (including the attempt-bound property, the image-determinism property and the concurrent-append property), each with at least 100 runs, in `packages/ce/src/jev/properties/`, in the style of `packages/ce/src/config/properties/`.
10. WHEN `npm test` runs from the repository root, THE test suite SHALL pass.
11. WHEN `npm run typecheck` runs from the repository root, THE typecheck SHALL pass.
12. WHEN `npm run build` runs from the repository root, THE build SHALL pass.
13. THE test suite SHALL include unit tests that a Text_Request retries a Transient_Failure at most `maxTransientRetries` times, that the Call_Log `attempts` equals the number of stub HTTP requests, that `maxRateLimitRetries` 0 disables rate-limit retries, and that an abort before and during a request makes no further attempt.
14. THE test suite SHALL include one unit test, as a single indivisible test proposition, that the SDK transport constructs its SDK client with `retry: { maxRetries: 0 }`, `logLevel: 'off'` and `compression: false`, AND that the client ignores `TYPESAFE_LOG_LEVEL` set to `debug` in the environment. THE test SHALL pass only when both assertions hold, and SHALL NOT be split into separate tests.
15. THE test suite SHALL include unit tests of the Probe_Library that run without a network: the statistics, the request shapes, and the Probe_Functions against stub transports.
16. THE test suite SHALL include the architecture test of Requirement 13 criterion 8 and the catalog snapshot test of Requirement 9 criterion 12.
17. THE test suite SHALL include the image reference format test of Requirement 10 criterion 9.

### Requirement 20: Issue acceptance and closing the issue

**User Story:** As the project owner, I want every item of the issue #5 checklist verified and the issue closed by the merged pull request, so that the issue board reflects real state.

#### Acceptance Criteria

1. WHEN all implementation tasks are complete, THE implementer SHALL verify each item of the Issue_Checklist against the delivered code, tests and Findings_Document, and SHALL record for each item the evidence: a passing test name, a file path or a command output.
2. THE implementer SHALL produce a traceability table that maps each Issue_Checklist item to the requirement that covers it and to the task that delivers it. The table is part of this spec (`tasks.md`, section "Traceability") and part of the pull request body.
3. THE Issue_Checklist items already checked in the issue (raw JSON `noul` plus `box`, header not needed, upstream report) SHALL be verified against the existing evidence: `spike-jev-openrouter.md` Addendum, `design.md` sections 5 and 12, and typesafe-ai/typesafe-sdk-js#27. THE JSON_Transport test of Requirement 3 criterion 5 SHALL show that the code keeps the header off.
4. WHEN all implementation tasks are complete (`all_tasks_complete`), the verification items are answered (`verification_items_answered`) and the Issue_Checklist verification passes (`issue_checklist_verified`), THE implementer SHALL create a feature branch from `main`, stage only the files of this feature by name (never `.env`), commit, push the branch and open a pull request against `main` of rfxlamia/ce with `gh pr create`, without asking the user for confirmation.
5. THE pull request body SHALL contain the line `Closes #5`, so that GitHub closes issue #5 when the pull request is merged.
6. THE pull request body SHALL list every Issue_Checklist item with its recorded evidence and SHALL contain the traceability table.
7. THE implementer SHALL NOT merge the pull request, SHALL NOT force push and SHALL NOT close issue #5 by hand.
8. IF any implementation task is not complete, THEN THE implementer SHALL NOT open the pull request, even when all tests pass (`all_tasks_complete` is a hard gate, independent of the other two gates).
9. IF the Verification_Item of Requirement 15 or 16 is not answered, THEN THE implementer SHALL NOT open the pull request and SHALL report the failure, without asking the user (Requirement 18 criterion 4). IF the Verification_Item of Requirement 17 has the status `not tested (blocked: TYPESAFE_API_KEY not set)` with the Follow_Up_Issue linked, THEN THE implementer SHALL open the pull request. IF the Verification_Item of Requirement 17 has no status, THEN THE implementer SHALL NOT open the pull request.
10. THE pull request body SHALL NOT contain any API key or other secret value.
11. THE implementer SHALL verify the "Done when" condition of issue #5: all tests run keyless with the Fake_Gateway, and the final-image latency and the `image_url` shape are answered in the Findings_Document. THE direct `typesafe` provider is answered either by a measured status or by the status `not tested (blocked: TYPESAFE_API_KEY not set)` plus the linked Follow_Up_Issue. WHEN the blocked status is used, THE pull request body SHALL state explicitly that this item of the "Done when" condition is deferred to the Follow_Up_Issue, and SHALL link it.
