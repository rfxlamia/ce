# Jev gateway verification findings

This document answers open items 1 and 2 of [`design.md`](design.md) section 12. It records the three Verification_Items of the `jev-gateway` spec. Context: [`spike-jev-openrouter.md`](spike-jev-openrouter.md) and [issue #5](https://github.com/rfxlamia/ce/issues/5).

Every value below was measured by a run of the Verification_Script. Nothing is estimated or copied. The document contains no API key, no Authorization header and no image bytes.

## Summary

| Verification_Item | Requirement | Answer_Status |
| --- | --- | --- |
| 1. Final-image latency | 15 | `confirmed` |
| 2. `image_url` array form | 16 | `confirmed` (true claim noul 0.99, false claim noul 0.01) |
| 3. Direct `typesafe` provider | 17 | `not tested (blocked: TYPESAFE_API_KEY not set)` |

## How to re-run

From the repository root:

```
npm run verify:jev-image --workspace continuous-evidence -- <latency|image-url|typesafe|all>
```

`latency` and `image-url` need `OPENROUTER_API_KEY`. `typesafe` needs `TYPESAFE_API_KEY`. Keys are read from the environment or the gitignored `.env` and are never printed.

## Item 1: final-image latency (Requirement 15)

Answer_Status: `confirmed`.

| Field | Value |
| --- | --- |
| Run date | 2026-11-25T14:26:07Z |
| Provider | `openrouter` |
| Transport | `json` (raw JSON, image as `data_base64`) |
| Returned_Model_Id | `typesafe/jev-1.14-20261014` |
| Requests sent | 20 |
| Successes / failures | 20 / 0 |
| p50 | 837 ms |
| p95 | 1281 ms |
| Minimum | 733 ms |
| Maximum | 1467 ms |
| Per-step budget (design section 5) | 7500 ms |
| p95 below budget | yes (1281 ms < 7500 ms) |

Raw samples: `docs/journal/v0.0/samples/20261125T142607Z-gateway/` (20 sanitized files).

Answer for design section 12 item 1: the final-image request over the JSON transport fits the per-step budget by a wide margin.

## Item 2: `image_url` array form (Requirement 16)

Answer_Status: `confirmed`. The array form was accepted and the answers follow the image content: a claim that is true for the fixture screenshot scored high, and a claim that is false for it scored low.

The first run (2026-11-25T14:27:50Z, sample `20261125T142750Z-gateway/`) was inconclusive. It used only the false claim, and a low noul is also what a model ignoring the image would return. It also dropped `answers` from the sample. That run is superseded by the run below. The sample is kept for the record.

The fixture `packages/ce/fixtures/jev/demo-app-screenshot.png` shows the "Demo application" page with an Increment button and a counter at 0. The probe sent two requests with the same array-form state shape and the same `state_reached` noul question, differing only in the claim.

Judging rule (in `jev/probe.ts`): `confirmed` only when the true-claim noul is at least 0.5, the false-claim noul is at most 0.5, and the gap (true minus false) is at least 0.3. Otherwise `not supported`.

| Field | Value |
| --- | --- |
| Run date | 2026-11-25T15:06:39Z |
| Provider / transport | `openrouter` / `json` |
| Request shape | `state = [{type:"text", text:"claim: ..."}, {type:"image_url", image_url:{url:"data:image/png;base64,..."}}]` plus one `noul` question, `state_reached` |
| Shape source | Best-effort guess. The API reference (`docs.typesafe.ai` `api.md`) documents no `image_url` shape. |
| Returned_Model_Id | `typesafe/jev-1.14-20261014` |

| Claim | Fixture truth | HTTP status | `state_reached` noul | Latency | Usage (input / output tokens) |
| --- | --- | --- | --- | --- | --- |
| "The page shows a counter with value 0" | true | 200 | 0.99 | about 1706 ms | 3008 / 22 |
| "The page shows a confirmation message after the form is submitted." | false | 200 | 0.01 | about 886 ms | 3014 / 22 |

Gap: 0.98, above the 0.3 threshold. The true noul is above 0.5 and the false noul is below it.

Limits: the shape is undocumented, so the provider may change or reject it without notice. One true/false pair is one observation, not a rate.

Recommendation: the gateway's request shape is unchanged (image requests keep using `assets` with `data_base64`, which is documented). The array form is a working but undocumented alternative and is not adopted.

Raw samples: `docs/journal/v0.0/samples/20261125T150639Z-gateway/` (`001-image-url-true-claim.json`, `002-image-url-false-claim.json`; each holds status, model, usage and the numeric noul per question). The earlier sample `docs/journal/v0.0/samples/20261125T142750Z-gateway/001-image-url-array-form.json` is superseded.

Answer for design section 12 item 2: the array form carries the image (answers separate a true claim from a false one), but it is undocumented. Keep image and text states separate.

## Item 3: direct `typesafe` provider (Requirement 17)

Answer_Status: `not tested (blocked: TYPESAFE_API_KEY not set)`.

No probe was run for this item and no result is recorded. The Follow_Up_Issue is [rfxlamia/ce#25](https://github.com/rfxlamia/ce/issues/25).

- `PINNED_MODELS.typesafe` remains `typesafe/jev-1.14` and stays marked unverified in code, with a pointer to this document.
- Not recorded, because not measured: accepted model name, Returned_Model_Id, per-request status and latency, whether the SDK multipart image request is accepted, and whether the JSON path needs the `TypeSafe-Danger-Zone-Images` header.
- This is a deliberate narrowing of the "Done when" of issue #5 for this item, as allowed by Requirement 17 criterion 8. The code path is covered keyless by tests with stub transports and an injected `fetch`.

Raw samples: none.

## Items of issue #5 already checked

These were satisfied by the spike before this spec. The gateway keeps them true in code.

1. One raw JSON request with `noul` and `box` on the same image works. Evidence: [`spike-jev-openrouter.md`](spike-jev-openrouter.md) and its samples.
2. The `TypeSafe-Danger-Zone-Images` header is not needed on the JSON path (OpenRouter). Evidence: the diagnostic samples (header ON and OFF) in the spike, and the latency run above, which sent no header and succeeded 20 of 20.
3. Upstream report filed: [typesafe-ai/typesafe-sdk-js#27](https://github.com/typesafe-ai/typesafe-sdk-js/issues/27).

## Condition `verification_items_answered`

Holds. Items 1 and 2 are `confirmed`. Item 3 is `not tested (blocked: TYPESAFE_API_KEY not set)` with the Follow_Up_Issue linked.
