---
inclusion: always
---

# Decision: Hybrid Jev gateway (SDK for text, raw JSON for images)

Date: 2026-11-25. Source: spike #3 (PR #22), issue #5. Findings: `docs/journal/v0.0/spike-jev-openrouter.md`.

## Context

- CE reaches Jev through OpenRouter (`OPENROUTER_API_KEY`, base URL `https://openrouter.ai/api`).
- `@typesafe-ai/sdk` 0.7.0 is the latest release. Its `systemOne()` always sends assets as `multipart/form-data`. There is no option to change this.
- OpenRouter's `/v1/systemone` rejects multipart with `400 invalid content-type`. The same request as JSON, with the image in `assets` as `data_base64`, succeeds for `noul` and `box` on `typesafe/jev-1.14`.
- Text-only requests through the SDK work: `choice`, `noul` and `score` match the SDK types, and next_action p95 is under 1 s.

## Decision

- One interface, `JevGateway`, implemented by `HybridJevGateway`.
- Text-only requests use the SDK transport (types, retries, compression).
- Requests carrying an image use the JSON transport (raw fetch, `data_base64`).
- Questions are always built with SDK helpers. Both transports return the same types.
- Image failures raise `JevImageError` and are recoverable. The run resolves from text signals and the report omits the Box highlight. Never fail a run because the image step failed.
- Pin the model per provider. On OpenRouter use `typesafe/jev-1.14`; `jev-preview` is invalid there. Store the dated model id the API returns in `run.json`.

## Rules for future work

- Only `jev/` knows that two transports exist. Nothing outside `jev/` may call fetch for Jev or import the SDK directly.
- Do not inject a custom `fetch` into the SDK to rewrite multipart. It depends on SDK internals and breaks on upgrade.
- Keep image requests to one per run (the final screenshot). The loop stays text-only.
- Tests use the fake gateway and include a case for the multipart 400.

## Exit plan

When the SDK can send images as JSON, or OpenRouter accepts multipart: delete the JSON transport, route everything through the SDK, keep the interface. Check on every SDK release. Upstream report: `typesafe-ai/typesafe-sdk-js` (link in issue #5).
