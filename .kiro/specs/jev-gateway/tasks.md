# Implementation Plan: jev-gateway

## Overview

Implement the Jev gateway layer of CE (GitHub issue #5, "[M1] Jev gateway, question catalog, fake and call log") in TypeScript under `packages/ce/src/jev/`, following `design.md`. The plan has two parts, both in scope.

Part 1, gateway code: SDK dependency and fixture, shared errors, state hash, question catalog and snapshot, the two transports, the call log, the gateway (routing, classification, pacing, factory), the fake gateway and its fixtures, public exports, the architecture test, the Probe_Library and the Verification_Script.

Part 2, live verification of the three items the spike left open: final-image latency (R15), the `image_url` array form (R16) and the direct `typesafe` provider (R17). These tasks need real API keys and cannot run in CI. They end in the Findings_Document `docs/journal/v0.0/jev-gateway-verification.md`.

The last tasks verify every checkbox of issue #5 with evidence, prepare the pull request body (`Closes #5`), then push and open the pull request. The agent runs every task itself, including live verification, the follow-up issue and the pull request, with no user step. The agent never merges, never force pushes and never closes issue #5 by hand.

Conventions used by these tasks:

- Unit tests sit next to the module they test, as `<module>.test.ts` in `packages/ce/src/jev/`.
- Each correctness property is one fast-check test in its own file, `packages/ce/src/jev/properties/pNN-<name>.test.ts`, in the style of `packages/ce/src/config/properties/`, with `numRuns` of at least 100 and a comment `// Feature: jev-gateway, Property N: <title>` above the test.
- All tests run keyless, using `FakeJevGateway`, stub transports, an injected `fetch` and an injected `sleep`. No test reads a real key, and no test calls the Verification_Script.
- Nothing in `jev/` imports `outcome/resolve.ts`, and no `Outcome` value is produced in `jev/`.
- Only `jev/` imports `@typesafe-ai/sdk`. Only `jev/catalog.ts` calls `noul`, `choice`, `score`, `box`, `image` and `withAssets`. Only `jev/transport-json.ts` calls `fetch` for Jev.
- Do not edit `docs/journal/v0.0/design.md`, `docs/journal/v0.0/requirements.md` or `docs/journal/v0.0/spike-jev-openrouter.md`.
- Never write an API key into a committed file, a sample file, the Findings_Document or the pull request body. Never stage `.env`.
- Commands run from the repository root. Do not run watch-mode commands; use `vitest run` (through `npm test`).
- Existing config-loader pieces are reused: `requireJevCredentials`, `LoadedConfig` and `ValidationError` from `packages/ce/src/config/`.

## Tasks

- [x] 1. Add the SDK dependency, the fixture image and test scaffolding
  - In `packages/ce/package.json` add `"@typesafe-ai/sdk": "0.7.0"` under `dependencies` as an exact version, without a range. Keep the existing scripts and dependencies.
  - Copy `spike/jev-openrouter/fixtures/demo-app-screenshot.png` to `packages/ce/fixtures/jev/demo-app-screenshot.png` (Fixture_Image, 1280 by 800). Do not depend on the spike directory afterwards.
  - Create the empty directory targets only when a later task writes a file there. Do not add placeholder code.
  - Run `npm install` from the repository root so the lockfile updates.
  - Confirm that no test in this plan needs an API key (all tests use the fake, stubs and injected `fetch` and `sleep`).
  - _Requirements: 13.6, 14.11, 19.1_

- [x] 2. Implement the shared error classes
  - [x] 2.1 Implement `StageError` in `packages/ce/src/errors.ts`
    - Export `Stage` (`'context' | 'assessment' | 'runtime' | 'evidence'`) and `StageError(stage, cause, options?: { callError })` with the fields `stage`, `cause` and optional `callError`.
    - The `message` states the stage and the constructor name of the cause only. It never repeats the message of the cause, an API key, an Authorization header, state text or image bytes.
    - _Requirements: 6.1, 6.15, 12.7_

  - [x] 2.2 Implement `packages/ce/src/jev/errors.ts`
    - Export `JevImageError` (`reason` of `bad_request | rate_limited | timeout | connection | server | invalid_image | invalid_response | client`, optional `status` present only when an HTTP status exists, optional `retryAfterMs` only for `rate_limited`), `RateLimitError` (`retryAfterMs: number | undefined`) and `JevUsageError`.
    - None of the three extends another or extends `StageError`. Messages never contain a key, an Authorization header, state text or image bytes.
    - _Requirements: 6.1, 6.2, 6.3, 6.15, 6.19, 7.9_

  - [x] 2.3 Write unit tests for the error classes
    - File: `packages/ce/src/jev/errors.test.ts`
    - `JevImageError` is not a `RateLimitError` and the reverse; `status` is absent when not given; `retryAfterMs` is carried for `rate_limited`; `JevUsageError` is neither a `JevImageError` nor a `StageError`; `StageError` carries `cause` and `callError`; no message contains a generated secret.
    - _Requirements: 6.2, 6.3, 6.15, 6.19, 12.7_

- [x] 3. Implement the state hash
  - [x] 3.1 Implement `packages/ce/src/jev/hash.ts`
    - Export `stateHash(state: string | TextWithAssets): string` as in the design: domain prefix `ce-state-v1` plus `0x00`, the UTF-8 text with every reference matching `<image:` plus 32 lowercase hex digits plus `>` replaced by `<image:0>`, `<image:1>` and so on in order of first appearance, unreferenced assets numbered afterwards in asset order, then `0x00` plus the SHA-256 of the image bytes for each image. Return 64 lowercase hex characters. The hash does not depend on the question set, the stage or the model.
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7_

  - [x] 3.2 Write property test for hash determinism and distinctness
    - File: `packages/ce/src/jev/properties/p14-state-hash.test.ts`
    - **Property 14: `stateHash` is deterministic, fixed-length, and distinguishes different text**
    - Generate text states from a rich alphabet. Assert repeat calls are equal, the length is 64 lowercase hex characters, and two distinct texts give distinct hashes.
    - **Validates: Requirements 10.4, 10.5, 10.6**

  - [x] 3.3 Write property test for image determinism
    - File: `packages/ce/src/jev/properties/p15-state-hash-image.test.ts`
    - **Property 15: `stateHash` depends on image bytes and position, never on the asset's random reference**
    - Build two states from two separately constructed image assets with the same bytes through the catalog builder or a helper file excluded from the architecture test. Assert equal hashes. Assert that changing one image's bytes changes the hash.
    - **Validates: Requirements 10.3, 10.8**

- [x] 4. Implement the question catalog and its snapshot
  - [x] 4.1 Implement `packages/ce/src/jev/catalog.ts`
    - Define the eight Catalog_Entries (`claim.is_behavior`, `assess.runtime_observable`, `assess.checks_adequate`, `assess.surface`, `runtime.next_action`, `runtime.state_reached_dom`, `runtime.state_reached`, `runtime.locate_subject`) with integer version 1, `idVersion`, `type`, `requiresImage` and `labelsFixed`, built only with the SDK helpers.
    - `assess.surface` fixes the six labels `browser_ui`, `http_api`, `cli`, `backend_internal`, `native_app`, `non_runtime` (`labelsFixed: true`). `runtime.next_action.build(options)` adds `done` and `give_up` and throws `RangeError` naming the limit 240 for more than 240 options (`labelsFixed: false`). `runtime.state_reached` and `runtime.locate_subject` require an image.
    - Export `finalImageQuestions(claim, pngBytes)` returning the Final_Image_Request (state built with `image` and `withAssets`, questions `runtime.state_reached` and `runtime.locate_subject`). This is the only module that calls `noul`, `choice`, `score`, `box`, `image` or `withAssets`.
    - _Requirements: 2.1, 2.2, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.13_

  - [x] 4.2 Add the catalog snapshot and its test and update script
    - Create `packages/ce/src/jev/catalog.snapshot.json` with, per `id@version`, the SHA-256 hex of the built question for fixed sample inputs.
    - Create the update script `packages/ce/src/scripts/update-catalog-snapshot.ts`. It only adds keys for new `id@version` values, fails when the digest of an existing key differs, and never removes or overwrites a key. Add the npm script `update:catalog-snapshot`. It is not part of `build` or `test`, and it imports no `jev/` module other than `jev/catalog` (adjust the architecture rule of task 13.3 to allow this one script).
    - File: `packages/ce/src/jev/catalog.snapshot.test.ts`. Fail with a message naming the entry and stating the version must be incremented when a built question differs from its stored digest. Fail when an `id@version` of the catalog has no snapshot key.
    - _Requirements: 9.10, 9.12, 19.16_

  - [x] 4.3 Write property test for option preservation
    - File: `packages/ce/src/jev/properties/p13-next-action-options.test.ts`
    - **Property 13: `runtime.next_action` option construction preserves labels exactly, up to its stated limit**
    - For 1 to 240 labels assert the question holds exactly the labels plus `done` and `give_up`. For more than 240 assert a `RangeError` naming 240.
    - **Validates: Requirements 9.6, 9.11**

  - [x] 4.4 Write unit tests for the catalog and the image reference format
    - File: `packages/ce/src/jev/catalog.test.ts`: exactly eight entries with the types of design section 4, six surface labels, `done` and `give_up` added, `labelsFixed` flags, `requiresImage` flags, `finalImageQuestions` builds one request with both image questions.
    - File: `packages/ce/src/jev/image-reference.test.ts`: construct an image with the real SDK helper `image` (through the catalog or a file excluded from the architecture test, no SDK stub) and assert its reference matches `^<image:[0-9a-f]{32}>$` exactly.
    - _Requirements: 2.1, 2.2, 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 9.9, 9.13, 10.9, 19.17_

- [x] 5. Implement the two transports
  - [x] 5.1 Implement `packages/ce/src/jev/transport-json.ts`
    - Export `createJsonTransport({ baseURL, apiKey, requestedModel, provider, fetch? })`. `POST <baseURL>/v1/systemone` with `Content-Type: application/json` and `Authorization: Bearer <key>`, body `{ model, state, questions, assets }`, each asset `{ type: 'image', format, data_base64 }` under its reference string. Serialize the questions as the catalog built them.
    - Detect the format from the magic bytes (`89 50 4E 47` png, `FF D8 FF` jpeg). Any other prefix throws `JevImageError('invalid_image')` before any network call.
    - Send `TypeSafe-Danger-Zone-Images: true` only when the provider is `typesafe` and the option `dangerZoneHeader` is true, and never for `openrouter`. A non-2xx response raises an error carrying the status and a sanitized, truncated message with no key, Authorization header or request body. Read `model`, `answers` and `usage` from a success response. Use the global `fetch` unless one is injected. This is the only module that calls `fetch` for Jev.
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 13.2, 13.3, 17.4_

  - [x] 5.2 Implement `packages/ce/src/jev/transport-sdk.ts`
    - Export `createSdkTransport({ baseURL, apiKey, requestedModel, fetch? })`. Build one `TypeSafeClient` with explicit `baseURL`, `apiKey`, `retry: { maxRetries: 0 }`, `logLevel: 'off'` (no logger) and `compression: false`, so the SDK never reads `TYPESAFE_*` variables and never retries. Do not inject a custom `fetch` into the SDK client.
    - `send` calls `client.systemOne` with the requested model and a per-attempt timeout and signal, and returns `{ model, answers, usage }`. It does not retry and does not decide the final error class. The gateway wraps the SDK `RateLimitError` into the gateway `RateLimitError`, so no SDK class leaks outside `jev/`.
    - _Requirements: 3.9, 4.3, 7.13, 7.17, 7.19, 13.1, 13.3_

  - [x] 5.3 Write property test for image format detection
    - File: `packages/ce/src/jev/properties/p03-image-format.test.ts`
    - **Property 3: Image format detection from magic bytes is total and correct**
    - For any byte array exactly one of `png`, `jpeg` or `JevImageError('invalid_image')` with no `fetch` call occurs.
    - **Validates: Requirements 2.5, 2.6**

  - [x] 5.4 Write unit tests for the JSON transport
    - File: `packages/ce/src/jev/transport-json.test.ts`, with an injected `fetch`.
    - Cases: URL, method and headers; body fields; asset shape `{ type, format, data_base64 }` for png and jpeg; the header `TypeSafe-Danger-Zone-Images` is absent for `openrouter`; HTTP 400 with body `invalid content-type: multipart/form-data` leads to a `JevImageError` with reason `bad_request` once the gateway classifies it (assert the sanitized status error here and the classification in task 10.1); the error contains no key, Authorization header or request body; the global `fetch` is not called when one is injected.
    - _Requirements: 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 19.3_

  - [x] 5.5 Write the single unit test for the SDK client configuration
    - File: `packages/ce/src/jev/transport-sdk.test.ts`
    - One indivisible `it(...)` with multiple `expect` calls: the transport constructs its client with `retry: { maxRetries: 0 }`, `logLevel: 'off'` and `compression: false`, AND a client created while `TYPESAFE_LOG_LEVEL=debug` is set in the environment still ignores it. Do not split the test. Restore the environment afterwards.
    - _Requirements: 4.3, 7.13, 7.17, 7.19, 19.14_

- [x] 6. Implement the call log
  - [x] 6.1 Implement `packages/ce/src/jev/log.ts`
    - Export `CallLogEntrySchema` (zod) with the fields of Requirement 12 criterion 3 (`timestamp`, `stage`, `transport`, `provider`, `requestedModel`, `model`, `questions`, `answers`, `latencyMs`, `usage`, `stateHash`, `status`, `attempts`, optional `errorKind`, optional `httpStatus`), the type `CallLogEntry = z.infer`, the `CallLog` interface and `createJsonlCallLog(path)`.
    - `append` validates against the schema before writing and rejects an invalid entry without writing. `createJsonlCallLog` creates the parent directory and serializes appends through a promise queue so lines never interleave and keep call order. The schema has no field for state text, image bytes, instructions, option descriptions, key or Authorization header.
    - _Requirements: 12.1, 12.3, 12.4, 12.6, 12.9, 12.12_

  - [x] 6.2 Write property test for the log round-trip
    - File: `packages/ce/src/jev/properties/p17-call-log-roundtrip.test.ts`
    - **Property 17: Call_Log entries always round-trip through JSON and the schema**
    - **Validates: Requirements 12.10**

  - [x] 6.3 Write property test for concurrent appends
    - File: `packages/ce/src/jev/properties/p19-call-log-concurrent.test.ts`
    - **Property 19: Concurrent log appends never interleave, drop, or duplicate a line**
    - Use temporary directories. Assert N lines, each valid JSON that validates, equal multisets, and call order.
    - **Validates: Requirements 12.12, 12.13**

  - [x] 6.4 Write unit tests for the call log
    - File: `packages/ce/src/jev/log.test.ts`
    - Parent directory is created; an invalid entry is rejected and nothing is written; one JSON object per line; the schema has no content fields.
    - _Requirements: 12.1, 12.3, 12.4, 12.6, 12.9_

- [x] 7. Checkpoint - Ensure build, typecheck and tests pass
  - Run `npm run build`, `npm run typecheck` and `npm test` from the repository root, with no API key set. Ensure all pass, ask the user if questions arise.
  - _Requirements: 19.1, 19.10, 19.11, 19.12_

- [x] 8. Implement the gateway
  - [x] 8.1 Implement routing, classification, model ids and logging in `packages/ce/src/jev/gateway.ts`
    - Start the file with the header comment that states the exit plan (delete `transport-json.ts`, route all requests through the SDK transport, keep the `JevGateway` interface, re-check on every SDK release).
    - Export `Jev_Request`, `Jev_Response`, `AskOptions`, `JevGateway` and `HybridJevGateway` (constructor takes the two transports, the call log, `provider`, `requestedModel` and the pacing options). `ask` sends all questions of one request in one HTTP request and chooses the JSON transport if and only if the request carries an image, per request and from its content only. Both transports return the same `Jev_Response` type.
    - Classify failures: Image_Request 400, 413, 422 to `bad_request`; 5xx to `server`; timeout to `timeout`; connection failure to `connection`; missing answer or empty `model` to `invalid_response`; other 4xx and local `TypeSafeError` to `client`; 408 to `timeout` with status 408; abort to `timeout`. HTTP 401 and 403 on either kind raise a `StageError` with the authentication error as `cause`. A Text_Request failure raises a `StageError` whose `cause` is the underlying error (a gateway `RateLimitError` for an exhausted 429). Never wrap a `JevImageError` in a `StageError`. Never raise a `RateLimitError` bare, an SDK error or a `fetch` error. Never decide an Outcome and never import `outcome/resolve.ts`.
    - Honour `AskOptions.signal`: an already-aborted signal makes no network call, an abort cancels the request or wait and starts no further attempt.
    - Record the Returned_Model_Id (not the requested name). Expose `modelIds()` (distinct ids, order of first appearance) and `requestedModel`.
    - Append exactly one `CallLogEntry` per call (including all attempts), with `status: 'error'` appended before the error is raised. `timestamp` is the first attempt, `latencyMs` runs to the end of the last attempt and excludes the wait for a concurrency slot. For `runtime.next_action` record probabilities under zero-based option indexes plus `done` and `give_up`, never label text. A log write failure raises a `StageError` (stage of the request, write error as `cause`, original error as `callError` when the call had failed).
    - Keep the transport routing only in this file, so deleting `transport-json.ts` changes no file outside `jev/`. Write no file other than the call log, read no Git and do not touch the target application.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 1.11, 2.7, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 6.11, 6.12, 6.13, 6.14, 6.16, 6.17, 6.18, 7.1, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8, 13.4, 13.5, 13.9_

  - [x] 8.2 Add pacing, retries and the one-image rule to `gateway.ts`
    - `maxConcurrent` (default 4), `maxRateLimitRetries` (default 2), `maxTransientRetries` (default 2) and an injectable `sleep`. A non-positive-integer `maxConcurrent` or a negative or non-integer retry count throws a `RangeError` naming the option.
    - FIFO concurrency gate with at most `maxConcurrent` requests in flight. On HTTP 429 wait for `retry-after-ms`, else `Retry-After` (delta-seconds or HTTP date), else exponential backoff from 500 ms doubling to 5000 ms. A delay above 60 000 ms stops retrying at once. Export the delay parser (non-negative whole milliseconds, `undefined` for other text). An exhausted rate limit raises a `StageError` with a `RateLimitError` cause for a Text_Request and a `JevImageError` with reason `rate_limited`, status 429 and `retryAfterMs` for an Image_Request.
    - Retry a Text_Request after a Transient_Failure (408, 5xx, connection failure, timeout) at most `maxTransientRetries` times. Retry an Image_Request only after a 429, never after 400, 5xx, timeout, connection failure or abort. `attempts` equals the number of HTTP requests sent. Never retry after an abort.
    - Reject a second Image_Request on one gateway instance with `JevUsageError` before any network call.
    - _Requirements: 6.9, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.15, 7.16, 7.18_

  - [x] 8.3 Add `PINNED_MODELS` and `createJevGateway` to `gateway.ts`
    - `PINNED_MODELS`: `openrouter` is `typesafe/jev-1.14`; `typesafe` is `typesafe/jev-1.14` with a code comment that marks it unverified and points to the Findings_Document (task 19 updates it).
    - `createJevGateway(loaded, env, options?)` calls `requireJevCredentials(loaded, env)` first and returns its failure `{ ok: false, errors }` unchanged, with no transport and no network call. Otherwise it resolves base URL (`https://openrouter.ai/api` or `https://api.typesafe.ai`), key from `env` only (never `process.env` when `env` is given), requested model (`PINNED_MODELS[provider]` when `meta.sources['jev.model']` is `default`, else the configured value, the same name on every request), validates for `openrouter` that `jev.model` matches `typesafe/<name>` or `~typesafe/<name>` (a `ValidationError` with `path: 'jev.model'`, `value`, `source` and `expected` naming the form and `jev-preview`), builds the two transports and returns `{ ok: true, gateway }`. No `jev.model` form check for `typesafe`. No key value in any result, error, log line or log entry. The factory decides no Outcome; the run pipeline maps its failure to `ERROR` through `reportConfigFailure` (contract only, not tested here).
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 9. Write property tests for the gateway
  - [x] 9.1 Write property test for routing
    - File: `packages/ce/src/jev/properties/p01-routing.test.ts`
    - **Property 1: Transport routing is total, exclusive, and content-determined**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.9, 19.9**

  - [x] 9.2 Write property test for one request per attempt
    - File: `packages/ce/src/jev/properties/p02-one-request.test.ts`
    - **Property 2: One Jev_Request produces one HTTP request per attempt**
    - Also assert the JSON body holds exactly the given question names.
    - **Validates: Requirements 1.6, 2.7, 7.1**

  - [x] 9.3 Write property test for failure classification
    - File: `packages/ce/src/jev/properties/p07-classification.test.ts`
    - **Property 7: Failure classification is total, exclusive, and never leaks secrets**
    - Generate outcomes for Text_Requests and Image_Requests (400, 413, 422, 5xx, timeout, connection failure, 401, 403, exhausted 429, 408, other 4xx, local `TypeSafeError`, abort, missing answer, missing model). Assert the single expected error shape and that no field contains the key, state text or image bytes.
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.15, 6.16, 6.17, 6.18, 8.4**

  - [x] 9.4 Write property test for the attempt bound
    - File: `packages/ce/src/jev/properties/p08-attempt-bound.test.ts`
    - **Property 8: Retry and attempt counts are always bounded, and the bound differs by request kind**
    - Use an injected `sleep`. Assert request count, bound and `attempts` equality.
    - **Validates: Requirements 7.5, 7.6, 7.7, 7.10, 7.16, 7.18, 7.20**

  - [x] 9.5 Write property test for `Retry-After` parsing
    - File: `packages/ce/src/jev/properties/p09-retry-after.test.ts`
    - **Property 9: `Retry-After` delay parsing is total and correct**
    - **Validates: Requirements 7.15**

  - [x] 9.6 Write property test for one image per gateway
    - File: `packages/ce/src/jev/properties/p10-one-image.test.ts`
    - **Property 10: At most one Image_Request per gateway instance**
    - **Validates: Requirements 7.11**

  - [x] 9.7 Write property test for bounded concurrency
    - File: `packages/ce/src/jev/properties/p11-concurrency.test.ts`
    - **Property 11: Bounded concurrency admits all requests without exceeding the limit**
    - **Validates: Requirements 7.2, 7.4, 7.14**

  - [x] 9.8 Write property test for `modelIds()`
    - File: `packages/ce/src/jev/properties/p12-model-ids.test.ts`
    - **Property 12: `modelIds()` is an order-preserving set**
    - **Validates: Requirements 8.2, 8.5, 8.7**

  - [x] 9.9 Write property test for model resolution
    - File: `packages/ce/src/jev/properties/p04-model-resolution.test.ts`
    - **Property 4: Requested model resolution depends only on the configured source**
    - **Validates: Requirements 4.6, 4.7, 4.9**

  - [x] 9.10 Write property test for the OpenRouter model form
    - File: `packages/ce/src/jev/properties/p05-model-form.test.ts`
    - **Property 5: OpenRouter model-form validation accepts and rejects by the documented pattern**
    - **Validates: Requirements 4.8**

  - [x] 9.11 Write property test for missing credentials
    - File: `packages/ce/src/jev/properties/p06-missing-credentials.test.ts`
    - **Property 6: Missing-credential failures always name the correct variable and only that variable**
    - Assert no transport is constructed (spy on the transport factories) and the key value never appears.
    - **Validates: Requirements 5.2, 5.4, 5.5, 5.6**

  - [x] 9.12 Write property test for the no-contents rule
    - File: `packages/ce/src/jev/properties/p18-no-contents.test.ts`
    - **Property 18: The Call_Log never contains state text, option labels, or the API key**
    - Generate states, `runtime.next_action` option labels of 8 or more characters, keys and calls. Assert the serialized log contains none of them.
    - **Validates: Requirements 12.4, 12.5, 12.11**

- [x] 10. Write unit tests for the gateway and the factory
  - [x] 10.1 Write unit tests for `HybridJevGateway`
    - File: `packages/ce/src/jev/gateway.test.ts`, with stub transports, an injected `sleep` and a stub call log.
    - Cases: a Text_Request uses the SDK stub and an Image_Request the JSON stub; multipart 400 text `invalid content-type: multipart/form-data` gives `JevImageError` `bad_request`; Image_Request timeout, connection failure, HTTP 500 (one attempt, not retried), HTTP 404 (`client`), a local `TypeSafeError` (`client`), an abort (`timeout`), HTTP 408 (`timeout`, status 408) and an answer missing a requested question (`invalid_response`); HTTP 401 and 403 give `StageError` for both kinds; 429 with `retry-after-ms`, with `Retry-After` and with neither header give the waits of Requirement 7, and exhaustion gives `StageError` with `RateLimitError` for text and `JevImageError` `rate_limited` for image; a delay over 60 000 ms stops at once; a Text_Request retries a Transient_Failure at most `maxTransientRetries` times; `maxRateLimitRetries` 0 disables rate-limit retries; `attempts` equals the stub request count; an abort before and during a request makes no further attempt and no network call when aborted first; the second Image_Request gives `JevUsageError`; `modelIds()` over a fixed sequence; invalid constructor options throw `RangeError` naming the option; an empty `model` field is an error; a failed call also fails to log: the `StageError` carries `callError`; a call error log entry is appended before the error is raised; the final-image fallback case (the `JevImageError` reaches the caller unwrapped).
    - _Requirements: 1.2, 1.3, 1.4, 1.8, 1.10, 1.11, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.17, 6.18, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9, 7.11, 7.12, 7.16, 7.18, 8.2, 8.3, 8.4, 8.6, 12.7, 12.8, 19.2, 19.5, 19.6, 19.8, 19.13_

  - [x] 10.2 Write unit tests for `createJevGateway`
    - File: `packages/ce/src/jev/factory.test.ts`
    - One conjunctive `it(...)` for Requirement 19 criterion 7: a missing key for each provider returns a failure result naming `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`, a present key returns `{ ok: true, gateway }`, and `jev-preview` on `openrouter` returns a `ValidationError` with `path` `jev.model`.
    - Further cases with an injected `fetch` and `env`: base URL `https://api.typesafe.ai` and variable `TYPESAFE_API_KEY` for the direct provider; base URL `https://openrouter.ai/api` for `openrouter`; the header `TypeSafe-Danger-Zone-Images` is absent for `openrouter` and present only when the provider is `typesafe` and the option is on; no key value in any result; `process.env` is not read when `env` is given; the same model on every request; `typesafe` accepts any model form; `PINNED_MODELS.openrouter` is `typesafe/jev-1.14`; no key is needed to construct `FakeJevGateway`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 4.10, 4.11, 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 17.4, 17.9, 19.7_

- [x] 11. Checkpoint - Ensure build, typecheck and tests pass
  - Run `npm run build`, `npm run typecheck` and `npm test` from the repository root, with no API key set. Ensure all pass, ask the user if questions arise.
  - _Requirements: 19.1, 19.10, 19.11, 19.12_

- [x] 12. Implement the fake gateway and its fixtures
  - [x] 12.1 Implement `packages/ce/src/jev/fake.ts`
    - Export `FakeJevGateway implements JevGateway`, `Recording`, `ScriptedFailure` and `FakeRecordingMissingError(idVersion, question, stateHash)`. Look up each question by `(id@version, stateHash, question name)`. A missing key, including a Recording of another version of the same entry, throws `FakeRecordingMissingError` and never returns a default.
    - Return the same `Jev_Response` type as the hybrid gateway with default model `typesafe/jev-1.14-fake` and usage. Honour `AskOptions.signal` as Requirement 1 criteria 10 and 11 state before returning a Recording. Make no network call, no `fetch`, read no environment variable, need no key.
    - Scripted failures: `image-multipart-400` raises `JevImageError` `bad_request`, status 400, message `invalid content-type: multipart/form-data`; `image-timeout` raises `JevImageError` `timeout`; `image-rate-limit` raises `JevImageError` `rate_limited` with status 429; `rate-limit` raises `StageError` with a `RateLimitError` cause; `unauthorized` raises a `StageError` for authentication.
    - Append one call log entry per call with transport `fake` and latency 0.
    - _Requirements: 1.12, 5.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 12.2_

  - [x] 12.2 Create `packages/ce/src/jev/fixtures/recordings.json`
    - Derive Recordings from the spike samples in `docs/journal/v0.0/samples/` for `choice`, `noul`, `score`, `next_action` and the raw JSON `box` answer (sample `014`). Compute each `stateHash` with `stateHash` and key with the versioned catalog id. Do not copy any key or secret. Do not edit the sample files.
    - _Requirements: 11.11_

  - [x] 12.3 Write property test for fake replay
    - File: `packages/ce/src/jev/properties/p16-fake-replay.test.ts`
    - **Property 16: Fake_Gateway replay is a total, correct lookup**
    - **Validates: Requirements 11.3, 11.4, 11.12**

  - [x] 12.4 Write unit tests for the fake gateway
    - File: `packages/ce/src/jev/fake.test.ts`
    - Replay of `recordings.json` for all five answer kinds; the five scripted failures as five fixed examples, including `image-multipart-400` giving a `JevImageError`; a version mismatch throws `FakeRecordingMissingError` naming the three parts; two questions with the same entry in one request do not collide; an aborted signal; no `fetch` call and no environment read; one call log entry with transport `fake` and latency 0.
    - _Requirements: 1.12, 5.7, 11.4, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 19.4_

- [x] 13. Expose the public API and enforce module boundaries
  - [x] 13.1 Export from `packages/ce/src/index.ts`
    - Add the `JevGateway` and `AskOptions` types and `createJevGateway`, `FakeJevGateway`, `FakeRecordingMissingError`, `JevImageError`, `RateLimitError`, `JevUsageError` and `StageError`. Keep existing exports. Do not export either transport or the Probe_Library.
    - _Requirements: 13.7_

  - [x] 13.2 Write unit test for the public API
    - File: `packages/ce/src/jev/index.test.ts`
    - Import from `../index.js` and assert the listed values exist and that no transport, `probe` or `stateHash` export exists.
    - _Requirements: 13.7_

  - [x] 13.3 Write the architecture test
    - File: `packages/ce/src/jev/architecture.test.ts`. Scan `packages/ce/src`, excluding `*.test.ts` and files under any `properties/` directory from every rule. Fail when (a) a file outside `jev/` imports `@typesafe-ai/sdk`; (b) a file other than `jev/catalog.ts` calls `noul(`, `choice(`, `score(`, `box(`, `image(` or `withAssets(`; (c) a file under `jev/` other than `jev/transport-json.ts` calls `fetch(`; (d) a file under `jev/` imports `outcome/resolve`; (e) a file under `scripts/` imports any module other than `jev/probe` and Node.js built-ins (the catalog snapshot update script of task 4.2 may also import `jev/catalog`); (f) a file outside `jev/` imports `jev/transport-sdk` or `jev/transport-json`.
    - Also assert `jev/gateway.ts` has the exit-plan header comment, `package.json` pins `@typesafe-ai/sdk` exactly at `0.7.0`, no file in `jev/` writes a file other than through the call log or reads Git, and no test file imports `scripts/verify-jev-image`.
    - _Requirements: 3.7, 3.8, 6.14, 13.1, 13.2, 13.3, 13.4, 13.6, 13.8, 13.9, 14.3, 14.6, 19.16_

- [x] 14. Implement the Probe_Library
  - [x] 14.1 Implement `packages/ce/src/jev/probe.ts`
    - Export `sendText`, `sendFinalImage`, `sendSdkImage` and `sendImageUrlForm`, each taking `{ provider, apiKey, model, imageBytes?, dangerZoneHeader? (default false), fetch? }`. `sendText` uses a new `HybridJevGateway`. `sendFinalImage` builds a new gateway per call with `maxRateLimitRetries` 0 and sends `finalImageQuestions`. `sendSdkImage` calls the SDK transport directly, bypassing routing. `sendImageUrlForm` sends the array form through the JSON transport using `buildImageUrlRequestBody`. None throws for an HTTP failure; each returns `{ ok, latencyMs, model?, usage?, status?, errorText? }` with sanitized text.
    - Export `computeLatencyStats(samples, failureCount)` (nearest rank `sorted[ceil(p/100*n)-1]` over successful samples, `NaN` for an empty list, no throw), `buildImageUrlRequestBody` (the best-effort array form with a text part and an `image_url` part; the fetched API reference documents no such shape, which the Findings_Document must state), the Answer_Status text helpers, a Markdown summary builder for each Verification_Item, a sanitizer for sample files (no key, no Authorization header, no image bytes) and the pure function that plans a run from the command, the environment and the `--allow-ci` flag (exit 2 when `CI` is `true` without `--allow-ci`, checked before any key is read; exit 3 naming the variable when the needed key is empty or unset; otherwise the list of probes).
    - _Requirements: 14.4, 14.5, 14.7, 14.8, 14.10, 14.12, 14.13, 15.3, 15.4, 16.1, 16.2, 16.6, 17.1_

  - [x] 14.2 Write property test for latency statistics
    - File: `packages/ce/src/jev/properties/p20-latency-stats.test.ts`
    - **Property 20: Latency statistics are order-independent and internally consistent**
    - **Validates: Requirements 15.3, 15.4, 15.7**

  - [x] 14.3 Write unit tests for the Probe_Library
    - File: `packages/ce/src/jev/probe.test.ts`, without a network.
    - Nearest-rank statistics on fixed arrays; `NaN` for an empty list; request shape of `buildImageUrlRequestBody`; each Probe_Function against stub transports (the new gateway per `sendFinalImage` call, `sendSdkImage` bypassing routing, HTTP failures returned and not thrown, `dangerZoneHeader` default false); the run plan exits 2 on `CI=true` before reading any key and without `--allow-ci`, exits 3 naming `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` when the key is empty or unset and prints no measured value; sample sanitizer removes key, Authorization header and image bytes.
    - _Requirements: 14.4, 14.5, 14.7, 14.8, 14.12, 14.13, 15.3, 15.4, 16.2, 19.15_

- [x] 15. Implement the Verification_Script
  - [x] 15.1 Implement `packages/ce/src/scripts/verify-jev-image.ts` and its npm script
    - Commands `latency`, `image-url`, `typesafe` and `all`; options `--samples <n>` (default 20), `--image <path>` (default `packages/ce/fixtures/jev/demo-app-screenshot.png`), `--out <dir>` (default `docs/journal/v0.0/samples/<UTC timestamp>-gateway/`) and `--allow-ci`.
    - Import only `jev/probe` and Node.js built-ins. Read keys only from `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` in the process environment; accept no key as an argument; call no `fetch`. Apply the run plan of task 14.1 (exit 2 in CI, exit 3 for a missing key, naming the variable and recording `not tested (blocked: <variable> not set)`).
    - `latency`: send the samples one after another with `probe.sendFinalImage`, each starting after the previous one ended. `image-url`: one `probe.sendImageUrlForm`. `typesafe`: `probe.sendText`, `probe.sendFinalImage` (first without the header, once more with `dangerZoneHeader` true only when rejected) and `probe.sendSdkImage`.
    - Write one sanitized sample file per call under `--out` (status, latency, Returned_Model_Id, usage, question names, sanitized error text). Print one Markdown summary block per Verification_Item.
    - Add to `packages/ce/package.json`: `"verify:jev-image": "tsx --env-file-if-exists=../../.env src/scripts/verify-jev-image.ts"`. A variable already set in the process environment wins over `.env`. Do not wire the script into `build` or `test`, and do not match the vitest file pattern.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.9, 14.10, 15.1, 15.2_

- [x] 16. Checkpoint - Ensure build, typecheck and tests pass keyless
  - Unset `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` for the run, then run `npm run build`, `npm run typecheck` and `npm test` from the repository root. Ensure all pass with no key, ask the user if questions arise. Do not run the Verification_Script in this task.
  - _Requirements: 19.1, 19.10, 19.11, 19.12_

- [x] 17. Run the live verification: final-image latency (needs `OPENROUTER_API_KEY`, agent-run)
  - The agent runs this task itself. No user step.
  - Check that `OPENROUTER_API_KEY` is present, in the process environment or in the gitignored `.env` at the repository root (the script loads `.env` through `--env-file-if-exists`). Check the variable name only. Never print, log or copy its value.
  - Run `npm run verify:jev-image --workspace continuous-evidence -- latency` (20 samples, Pinned_Model of `openrouter`, rate-limit retries disabled). Keep the raw samples directory the script prints.
  - Record, from the script output only: date, requests sent, success and failure counts, p50, p95, minimum and maximum in milliseconds, the Returned_Model_Id, provider `openrouter`, transport `json`, and whether p95 is below the per-step budget of 7500 ms. If requests got HTTP responses but none succeeded, record `not supported` with the HTTP status and sanitized error text and no percentile.
  - If the key is missing: record `not tested (blocked: OPENROUTER_API_KEY not set)` in the Findings_Document and report this task as failed. If no request returns an HTTP response (connection failure, timeout or script error): record the sanitized real error and `not tested (blocked: live call failed)` and report this task as failed. Do not ask the user. Never invent, estimate or copy a number, and never mark the item `confirmed` or `not supported` without a real HTTP response (Requirement 18 criteria 4 and 5).
  - _Requirements: 15.1, 15.2, 15.5, 15.6, 18.3, 18.4, 18.5, 18.7_

- [x] 18. Run the live verification: `image_url` array form (needs `OPENROUTER_API_KEY`, agent-run)
  - The agent runs this task itself. No user step. Apply the same presence check (name only, never the value) and the same failure rules as task 17.
  - Run `npm run verify:jev-image --workspace continuous-evidence -- image-url`. It sends one request in the array form with a text part and an `image_url` part carrying the Fixture_Image and one `noul` question that depends on both parts.
  - Record, from the script output only: date, the request shape used (and the fact that the fetched API reference documents no `image_url` shape, so the shape is best effort), HTTP status, sanitized error text when rejected, the answer when accepted, and whether the answer used both parts. Status `confirmed` when accepted and both parts were used, otherwise `not supported` with the evidence.
  - If the key is missing or no HTTP response is obtained, record the real failure and the matching `not tested (blocked: ...)` status and report this task as failed. Do not ask the user and do not fabricate a result.
  - Do not change the request shape of the gateway. If the form is confirmed, record adopting it as a recommendation only.
  - _Requirements: 16.1, 16.3, 16.4, 16.5, 16.6, 18.3, 18.4, 18.5, 18.7_

- [x] 19. Run the live verification: direct `typesafe` provider (needs `TYPESAFE_API_KEY` if present, agent-run)
  - The agent runs this task itself. No question to the user. Check that `TYPESAFE_API_KEY` is present (name only, never the value), in the process environment or in `.env`.
  - If it is present, run `npm run verify:jev-image --workspace continuous-evidence -- typesafe`: one Text_Request through the SDK transport, one Image_Request through the JSON transport (first without `TypeSafe-Danger-Zone-Images`, once more with it only if rejected) and one Image_Request through the SDK transport. Record, from the script output only: date, the model name the API accepted, the Returned_Model_Id, status and latency of each of the three requests, whether the SDK multipart image request is accepted (then record that the SDK transport is enough for the direct provider, as input to the exit plan) and whether the JSON transport needs the header. If the direct provider requires the header on the JSON path, make the JSON transport send it while the provider is `typesafe` only (keep the test of task 10.2 green).
  - Update `PINNED_MODELS.typesafe` in `gateway.ts`: change it to the accepted model name when it differs from `typesafe/jev-1.14` and remove the unverified comment; remove the comment when `typesafe/jev-1.14` is accepted. If every request is rejected, record `not supported` with the HTTP status and sanitized error text and keep the unverified comment with a pointer to the Findings_Document.
  - If it is not set (expected): run no probe. Record directly `not tested (blocked: TYPESAFE_API_KEY not set)` in the Findings_Document. Create the Follow_Up_Issue yourself with `gh issue create --repo rfxlamia/ce --title "Verify direct typesafe provider"` (body: what to verify, the three requests of Requirement 17 criterion 1, the command `npm run verify:jev-image --workspace continuous-evidence -- typesafe`, a link to issue #5 and a link to the Findings_Document; no secret). Link the issue in the Findings_Document and in the code comment of `PINNED_MODELS.typesafe`, which keeps the unverified marker and a pointer to the Findings_Document. The task is then complete, and Requirements 17.8, 18.8 and 20.11 hold so issue #5 can still close.
  - If `gh issue create` fails (authentication or permissions), report the exact error as a task failure instead of working around it. Never invent a result.
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 18.3, 18.4, 18.5, 18.8_

- [x] 20. Write the Findings_Document
  - Create `docs/journal/v0.0/jev-gateway-verification.md`. It links `docs/journal/v0.0/spike-jev-openrouter.md` and issue #5, and states that it answers open items 1 and 2 of `design.md` section 12.
  - One section per Verification_Item (final-image latency, `image_url` array form, direct `typesafe` provider), each with an Answer_Status (`confirmed`, `not supported` or `not tested (blocked: <reason>)`), the values recorded in tasks 17 to 19, and the path of the raw samples directory. Contain only values measured by a run of the Verification_Script. For the direct-provider item with the blocked status, link the Follow_Up_Issue created in task 19. An item of task 17 or 18 with a `not tested (blocked: ...)` status is a task failure, not an answer.
  - Contain no API key, no Authorization header and no image bytes.
  - Do not edit `docs/journal/v0.0/design.md`, `docs/journal/v0.0/requirements.md` or `docs/journal/v0.0/spike-jev-openrouter.md`. Confirm with `git status` that they are unchanged.
  - Check the condition `verification_items_answered`: Requirements 15 and 16 are `confirmed` or `not supported`; Requirement 17 is `confirmed`, `not supported` or `not tested (blocked: TYPESAFE_API_KEY not set)` with the Follow_Up_Issue linked.
  - _Requirements: 15.5, 15.6, 16.3, 17.2, 17.8, 18.1, 18.2, 18.3, 18.6, 18.7, 18.8_

- [x] 21. Final checkpoint - Verify every checkbox of issue #5 and produce the traceability table
  - Gate A, `all_tasks_complete` (hard gate, checked first and on its own): read this `tasks.md` and confirm every task from 1 to 20 and every sub-task is checked complete. Do this by reading the list, not by inferring from passing tests. If any task is incomplete, stop: do not prepare or open a pull request, even when the verification below passes.
  - Gate B, `verification_items_answered`: the Findings_Document has answers for the three Verification_Items as task 20 states. Gate C, `issue_checklist_verified`: every item of issue #5 is verified below. A passing Gate B or C never substitutes for Gate A.
  - Run `npm install`, `npm run build`, `npm run typecheck` and `npm test` from the repository root with no key set. All must pass.
  - Fetch the issue with `gh issue view 5 --repo rfxlamia/ce` and walk every checkbox, including the ones already checked. For each item record the evidence (a passing test name, a file path or a command output) in the table of the "Traceability" section below, adding the evidence column values. Verify the three items already checked (raw JSON `noul` plus `box` works, `TypeSafe-Danger-Zone-Images` not needed on the JSON path, upstream report typesafe-ai/typesafe-sdk-js#27) against `spike-jev-openrouter.md` Addendum, `design.md` sections 5 and 12, the upstream issue, and the JSON transport test that shows the header stays off.
  - Verify the "Done when" condition of issue #5: all tests run keyless with the Fake_Gateway; the final-image latency and the `image_url` shape are answered in the Findings_Document; the direct provider is answered by a measured status or by the blocked status plus the linked Follow_Up_Issue.
  - This task is fully agent-run, with no user step. If any item is not met, fix it before moving on, or report the task as failed. Do not open a pull request while any item is unmet.
  - _Requirements: 19.1, 19.10, 19.11, 19.12, 20.1, 20.2, 20.3, 20.4, 20.8, 20.9, 20.11_

- [-] 22. Create the pull request body and open the pull request (agent-run)
  - Create `.kiro/specs/jev-gateway/pr-body.md` with: the line `Closes #5`; every item of the issue #5 checklist with its recorded evidence; the traceability table from task 21; the three Findings_Document answers with their Answer_Status. If the direct provider used the blocked status, state explicitly that this item of the "Done when" condition of issue #5 is deferred to the Follow_Up_Issue and link it (a deliberate narrowing for the direct provider only). The body contains no API key and no other secret value.
  - Check that Gate A, Gate B and Gate C hold. If any does not hold, stop, do not push and report the failure.
  - Without asking the user: create a feature branch from `main`, stage only files of this feature by name (never `.env`), commit, push the branch, and open the pull request against `main` of `rfxlamia/ce` with `gh pr create --base main --body-file .kiro/specs/jev-gateway/pr-body.md`.
  - Do NOT merge the pull request, do NOT force push and do NOT close issue #5 by hand. GitHub closes it when the pull request is merged.
  - If the push or `gh pr create` fails because of authentication or permissions, report the exact error as a task failure instead of working around it.
  - _Requirements: 20.4, 20.5, 20.6, 20.7, 20.9, 20.10, 20.11_

## Traceability

Mapping of the issue #5 checklist to requirements and tasks. The evidence column is filled in by task 21 before the pull request is opened.

| Issue #5 item | Requirements | Tasks | Evidence (filled in by task 21) |
| --- | --- | --- | --- |
| `JevGateway` interface and `HybridJevGateway` | 1 | 8.1, 9.1, 9.2, 10.1 | jev/gateway.ts; jev/gateway.test.ts; properties/p01-routing, p02-one-request |
| Two transports, SDK for text and JSON for images | 2, 3 | 5.1, 5.2, 5.3, 5.4, 5.5 | jev/transport-sdk.ts, transport-json.ts and their tests; properties/p03-image-format; architecture.test.ts (only jev/ uses fetch/SDK) |
| Provider and pinned model selection | 4 | 8.3, 9.9, 9.10, 10.2 | PINNED_MODELS in jev/gateway.ts; properties/p04-model-resolution, p05-model-form; factory.test.ts |
| `JevImageError` | 6 | 2.2, 8.1, 9.3, 10.1 | jev/errors.ts, errors.test.ts; properties/p07-classification; gateway.test.ts |
| Record the dated model id | 8 | 8.1, 9.8, 10.1 | properties/p12-model-ids; findings doc Returned_Model_Id `typesafe/jev-1.14-20261014` |
| `jev/catalog.ts` and snapshot | 9 | 4.1, 4.2, 4.3, 4.4 | catalog.test.ts, catalog.snapshot.test.ts, properties/p13-next-action-options |
| Request pacing and rate-limit handling | 7 | 8.2, 9.4, 9.5, 9.6, 9.7, 10.1 | properties/p08-attempt-bound, p09-retry-after, p10-one-image, p11-concurrency; retry-after.ts |
| `jev/fake.ts` including the multipart 400 case | 11 | 12.1, 12.2, 12.3, 12.4 | fake.test.ts `image-multipart-400 raises JevImageError bad_request with status 400`; properties/p16-fake-replay |
| `jev-calls.jsonl` | 12 | 6.1, 6.2, 6.3, 6.4, 9.12 | log.test.ts; properties/p17-call-log-roundtrip, p18-no-contents, p19-call-log-concurrent |
| Missing-credential path | 5 | 8.3, 9.11, 10.2 | factory.test.ts (error names OPENROUTER_API_KEY); properties/p06-missing-credentials |
| Raw JSON `noul` plus `box` works (already checked) | 3, 20.3 | 5.1, 5.4, 21 | spike-jev-openrouter.md Addendum; design.md s5, s12; 20/20 raw JSON requests in findings doc; transport-json.test.ts body/asset tests |
| `TypeSafe-Danger-Zone-Images` not needed on the JSON path (already checked) | 3.5, 20.3 | 5.1, 5.4, 10.2, 21 | spike diagnostic samples (header ON/OFF); transport-json.test.ts `omits TypeSafe-Danger-Zone-Images for openrouter even when requested` and `sends TypeSafe-Danger-Zone-Images only for typesafe with the option on` (added in task 21); header logic transport-json.ts L177-180 |
| Upstream report typesafe-ai/typesafe-sdk-js#27 (already checked) | 20.3 | 21 | https://github.com/typesafe-ai/typesafe-sdk-js/issues/27 (linked in issue #5 and findings doc) |
| Final-image latency, p50 and p95 over 20 samples | 14, 15 | 14.1, 14.2, 15.1, 17, 20 | confirmed: p50 837 ms, p95 1281 ms, 20/20 ok (jev-gateway-verification.md Item 1; samples/20261125T142607Z-gateway/); properties/p20-latency-stats |
| `image_url` array form | 14, 16 | 14.1, 15.1, 18, 20 | not supported (not shown to use both parts); recommendation: do not adopt (findings doc Item 2; samples/20261125T142750Z-gateway/) |
| Direct `typesafe` provider | 14, 17 | 15.1, 19, 20 | not tested (blocked: TYPESAFE_API_KEY not set); follow-up rfxlamia/ce#25 (findings doc Item 3) |
| All tests keyless with the fake gateway | 19 | 7, 11, 13.3, 16, 21 | keyless run, keys unset: `npm run build`, `typecheck`, `npm test` pass; 61 files, 403 tests (+1 added in task 21) |

## Notes

- No test sub-task is marked optional with `*`. The issue's "Done when" requires keyless test coverage, so property tests and unit tests are required.
- Properties 1 to 20 each map to exactly one task: P1 9.1, P2 9.2, P3 5.3, P4 9.9, P5 9.10, P6 9.11, P7 9.3, P8 9.4, P9 9.5, P10 9.6, P11 9.7, P12 9.8, P13 4.3, P14 3.2, P15 3.3, P16 12.3, P17 6.2, P18 9.12, P19 6.3, P20 14.2.
- Every task is agent-run. No task asks the user a question or hands the user a command.
- Tasks 17 and 18 run `npm run verify:jev-image` themselves; `OPENROUTER_API_KEY` comes from the repository `.env`. A missing key or a live call with no HTTP response is recorded as the real failure and reported as a task failure, never fabricated. An HTTP error status from the provider is a real answer (`not supported`).
- Task 19 skips the probe when `TYPESAFE_API_KEY` is unset (expected): it records the blocked status, creates the Follow_Up_Issue itself and completes. Task 22 pushes and opens the pull request itself, without merging, force pushing or closing issue #5.
- The Verification_Script is never run by `npm test` and no test calls it. The run plan logic that the script uses lives in `jev/probe.ts` so it is tested without a network.
- Requirement 5 criterion 3 and the "run pipeline maps a factory failure to `ERROR`" contract belong to the future pipeline issue. This plan covers only that the factory returns the failure result unchanged.
- Task 21 has three hard gates before the pull request: `all_tasks_complete`, `verification_items_answered` and `issue_checklist_verified`.
- `tasks.meta.json` is produced by the Kiro task runner and is not written by hand.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "4.1", "6.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2", "4.3", "4.4", "5.1", "5.2", "6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["5.3", "5.4", "5.5"] },
    { "id": 5, "tasks": ["7"] },
    { "id": 6, "tasks": ["8.1"] },
    { "id": 7, "tasks": ["8.2"] },
    { "id": 8, "tasks": ["8.3"] },
    { "id": 9, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "9.11", "9.12", "10.1", "10.2"] },
    { "id": 10, "tasks": ["11"] },
    { "id": 11, "tasks": ["12.1", "12.2", "14.1"] },
    { "id": 12, "tasks": ["12.3", "12.4", "13.1", "14.2", "14.3", "15.1"] },
    { "id": 13, "tasks": ["13.2", "13.3"] },
    { "id": 14, "tasks": ["16"] },
    { "id": 15, "tasks": ["17"] },
    { "id": 16, "tasks": ["18"] },
    { "id": 17, "tasks": ["19"] },
    { "id": 18, "tasks": ["20"] },
    { "id": 19, "tasks": ["21"] },
    { "id": 20, "tasks": ["22"] }
  ]
}
```
