# Spike findings: Jev via OpenRouter

Findings for GitHub issue #3. Every statement below comes from the sample files of the two harness runs. Anything a sample does not show is marked `not determined` or `not tested`.

## Run information

| | Run 1 | Run 2 (newest) |
| --- | --- | --- |
| Samples directory | `samples/2026-11-25T091002Z` (47 samples) | `samples/2026-11-25T092726Z` (61 samples) |
| Run start | not recorded in the files used here (directory name: 2026-11-25 09:10:02 UTC) | 2026-11-25T09:26:51.483Z |
| Transport for image requests | SDK | SDK, plus raw JSON diagnostics |
| Captured 400 messages | no (`response` is `null`) | yes |

- SDK version: `@typesafe-ai/sdk` 0.7.0
- Node.js version: v26.13.1 (run 2)
- Pinned_Model: `typesafe/jev-1.14`
- Run 1 was not modified. Both runs used the same harness inputs apart from the diagnostics added in run 2.

## 1. Primitive compatibility

### Method

One `choice`, one `noul` and one `score` probe were sent through the OpenRouter route with the Pinned_Model on a synthetic state. Each answer was compared with the SDK_Types shape. Question text is local to the harness.

### Result

| Request | Run 1 outcome / latency | Run 2 outcome / latency | Model_Id (both runs) |
| --- | --- | --- | --- |
| choice | ok, 1329 ms | ok, 1326 ms | `typesafe/jev-1.14-20261014` |
| noul | ok, 821 ms | ok, 862 ms | `typesafe/jev-1.14-20261014` |
| score | ok, 764 ms | ok, 813 ms | `typesafe/jev-1.14-20261014` |

Conformance differences: none observed in either run (run 2 harness report; run 1 answers have the same shapes: `choice` with `probabilities` and `confidence`, `noul` as a number, `score` with `legend`, `probabilities` and `confidence`).

**Status:** `confirmed`. All three primitives work through OpenRouter with the Pinned_Model, in both runs.

## 2. Mixed text and image state

### Method

One request combined text and the demo-app screenshot (`fixtures/demo-app-screenshot.png`, 1280x800) and asked for `noul` and `box`, with the `TypeSafe-Danger-Zone-Images: true` header. It was repeated without the image. Fallbacks: separate `noul` and `box` requests, and the `typesafe` provider. Run 2 added diagnostic attempts that vary model, header and transport.

### Result: the SDK path

Every SDK request that contained an image failed with HTTP 400, in both runs:

- Run 1: all four mixed-state checks failed. The error text was not captured (`response: null`).
- Run 2: with image, separate-noul and separate-box all failed with `400 invalid content-type: multipart/form-data; boundary=...`.
- Run 2, no-image check (`005`): failed with `400 Model typesafe/jev-preview does not exist`. This request had no image and no header, and used the model name `jev-preview`.
- `typesafe` provider fallback: skipped, `TYPESAFE_API_KEY` not set. Not tested.

### Result: diagnostic attempts (run 2)

| Request | Transport | Model | Image header | Outcome |
| --- | --- | --- | --- | --- |
| box only | SDK | pinned | ON | failed, 400 multipart |
| box only | SDK | pinned | OFF | failed, 400 multipart |
| image noul only | SDK | pinned | ON | failed, 400 multipart |
| image noul only | SDK | pinned | OFF | failed, 400 multipart |
| image noul only | SDK | `jev-preview` | ON | failed, 400 multipart |
| text-only noul (control) | SDK | pinned | none | ok, 733 ms |
| box only | raw JSON, `data_base64` asset | pinned | ON | ok, 937 ms, Model_Id `typesafe/jev-1.14-20261014` |
| image noul only | raw JSON, `data_base64` asset | pinned | ON | ok, 773 ms, Model_Id `typesafe/jev-1.14-20261014` |

### Confirmed cause of the earlier failures

**Confirmed (for the multipart 400).** The SDK serializes an image-bearing request as `multipart/form-data`, and the OpenRouter route rejects that content type with `400 invalid content-type: multipart/form-data`. Evidence:

1. All 34 image-bearing SDK requests in run 2 return that exact message (the 35th run-2 error is the `005` model-name error below). The message appears with the pinned model and with `jev-preview`, and with the image header ON and OFF. So neither the model choice nor the header causes it.
2. The text-only SDK control succeeds on the same route and model.
3. The same pinned model, route and header succeed when the image is sent as a raw JSON `data_base64` asset (both `box` and `noul`). Only the transport differs.

Second finding, separate from the first: the model name `jev-preview` is not accepted on this route (`Model typesafe/jev-preview does not exist`, sample `005`). The harness used it because the SDK docs say box questions need it. The box answer in sample `014` shows that box works on the pinned model `typesafe/jev-1.14`, which is also what `design.md` section 4 says.

Run 1 failures: `not confirmed` from run 1's own files, because they did not capture the error text. They match run 2 in request shape (SDK transport, image, same models), so the same cause is the most likely explanation, but run 1 does not prove it.

Not tested, so not confirmed: raw JSON with `jev-preview`; raw JSON with the header OFF (whether the header is required); a single raw request combining `noul` and `box`; text plus image in the `image_url` array form described in `design.md` section 12; the `typesafe` provider.

### Box check

Sample `014` (raw JSON, box only) returned `box = {top 0.13, bottom 0.19, left 0.01, right 0.22}`, confidence 0.89, for the question "The main heading of the page". On the 1280x800 screenshot this is x 13 to 282 and y 104 to 152 pixels. I viewed the fixture `fixtures/demo-app-screenshot.png`, which is the same image the harness sent. The heading "Demo application" occupies roughly x 24 to 284 and y 102 to 138.

Box encloses subject: **yes, approximately.** This is an agent judgment from reading pixel positions off the image. The box covers the heading text, includes about 14 px of empty space below it, and the right edge falls about 2 px short of the end of the final letter. It does not include the paragraph or the button. **The user should confirm this by viewing the screenshot.** No box sample in the run includes an annotated image; the screenshots saved with `004`, `006`, `007` and `036` belong to failed requests.

### Status

**Status:** `confirmed with differences`. Image input and `box` and `noul` answers work on the Pinned_Model through OpenRouter, but only when sent as raw JSON. The SDK 0.7.0 image path does not work on this route, `jev-preview` is not a valid model name here, and a combined `noul` plus `box` image request and the image-removed comparison were not completed on a working transport.

## 3. Latency

### Method

Sequential samples of a Next_Action_Request (text only, 100 locally invented options) and a Final_Image_Request (screenshot, `noul` and `box`), with no retries. Statistics use successful samples only, with failures counted separately.

### Result

Stated budget: 90 s timeout over 12 steps, which is 7.5 s per step.

#### Next_Action_Request

| | Run 1 | Run 2 |
| --- | --- | --- |
| Samples requested / successful / failed | 20 / 20 / 0 | 20 / 20 / 0 |
| p50 | 785 ms | 767 ms |
| p95 | 957 ms | 864 ms |
| min / max | not computed | 689 ms / 954 ms |

- Options offered: 100. Reported input tokens: 2624 per request (run 2).
- Rate limiting or `retry-after`: none observed.
- Budget fit: p50 and p95 are both well under 7.5 s in both runs (p95 is about 13% of the budget at most).

#### Final_Image_Request

- Run 1: 20 requested, 0 successful, 20 failed. Run 2: 20 requested, 0 successful, 20 failed. Model requested: `jev-preview`. Failed-call latency was 318 to 654 ms in run 2 (run 2 samples 036 to 055); these are error times and are not Final_Image latency.
- p50 and p95: **not determined** in either run (no successful samples).
- Run 2 final-image diagnostics (6 attempts, SDK, pinned model or `jev-preview`, header ON or OFF, `noul+box`, `box`, `noul`) all failed with the same multipart 400.
- Indicative only: the two raw-JSON image calls in section 2 took 937 ms (`box`) and 773 ms (`noul`). Each is a single sample, a single question, and not a Final_Image_Request, so they give no p50 or p95.

Budget fit statement: Next_Action fits the 7.5 s per-step budget. Final_Image **cannot be stated** (no successful sample). The two single raw-JSON calls are far below 7.5 s, but that is not a measurement of Final_Image latency.

### Measurement limits

- Sample count: 20 requested per request type per run; 61 calls in run 2, 47 in run 1.
- Time of day: run 2 started 2026-11-25T09:26:51.483Z; run 1 about 17 minutes earlier. Local time zone is not recorded.
- Network location: Lampung (from the harness report).
- Two runs on one day, minutes apart. They show no variation across days or times of day.

**Status:** `not confirmed`. The Next_Action half is confirmed. The Final_Image half has no data.

## 4. Model identification

### Method

The Model_Id of every successful response was read from the `model` field of the response body and counted per request type. Failed calls are excluded.

### Result

- Pinned_Model: `typesafe/jev-1.14`. Model_Id field location: `model` in the response body.
- Run 1: `typesafe/jev-1.14-20261014` for all 23 successful responses (choice 1, noul 1, score 1, next_action 20).
- Run 2: `typesafe/jev-1.14-20261014` for all 26 successful responses (choice 1, noul 1, score 1, diagnostic 3, next_action 20).
- No other Model_Id was observed. The response Model_Id is the pinned name with a date suffix, so a pinned name resolves to a dated model version.

**Status:** `confirmed`.

## Design consequences

None of these edit `SPEC.md`. No contradiction with `SPEC.md` was found. This document does not edit `design.md`.

1. **design.md section 4 (Jev question catalog), the paragraph after the table.** The statement that Box requires `typesafe/jev-1.14` is supported by sample `014`. Add that the harness's `jev-preview` override is wrong on this route and that the pinned model is used for all question types.
2. **design.md section 12 (Open questions, resolved list).** The entry "Image + text state in one request, supported via OpenRouter (array of text and `image_url` parts)" is not supported by the samples. Image input worked only as a raw JSON `data_base64` asset. Reopen the item: the `image_url` array form is untested, and a combined `noul` plus `box` image request is untested.
3. **design.md section 2 (Package layout), `jev/gateway.ts`.** The gateway cannot rely on the SDK 0.7.0 image path through OpenRouter. It needs a raw JSON image transport, or an SDK version or option that avoids multipart. Choose and record this.
4. **design.md section 5 (Runtime loop), final step.** The final image request is the only image call. Its fallback ("if the final image request fails, the run still resolves from text signals", section 12) is now an expected path, not a rare one, until the transport is fixed. State that the final request may need to be split into one `noul` request and one `box` request, since only single-question image requests were shown to work.
5. **design.md section 7 (Configuration), `jev:` block.** Add whether the image header `TypeSafe-Danger-Zone-Images` is sent. Its necessity on the raw path is not tested. Keep `jev.model: typesafe/jev-1.14` and record that responses return a dated Model_Id such as `typesafe/jev-1.14-20261014`, which `run.json` should store.
6. **design.md section 7 (Configuration), `runtime.timeout` and `runtime.max-steps`.** Next_Action p95 of 864 ms (run 2) and 957 ms (run 1) fits the 7.5 s per-step budget with wide margin. No change needed for the loop budget. Do not state a Final_Image budget fit until it is measured on a working transport.
7. **design.md section 11 (Testing strategy), Fake Jev.** Fixtures for `jev/fake.ts` can be taken from these samples for `choice`, `noul`, `score`, `next_action` and the raw-JSON `box` answer. Add a case that simulates the multipart 400 so the "final image fails" path is tested.
8. **design.md section 10 (Error handling).** A 400 from the image request must be handled as a recoverable Jev failure for the final step, separate from `RateLimitError`.
9. **Follow-up measurement (no design section).** Rerun the Final_Image latency on the raw JSON transport, and test the `typesafe` provider, before the Final_Image budget row is filled in.
