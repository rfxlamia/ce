Closes #5

## Summary

Adds the Jev gateway in `packages/ce/src/jev/`: `JevGateway`, `HybridJevGateway` (SDK transport for text, raw JSON transport for the one final image), versioned catalog, fake gateway, call log, and a manual verification script. Spec: `.kiro/specs/jev-gateway/`. Findings: `docs/journal/v0.0/jev-gateway-verification.md`.

## Verification results

Keys unset, from the repository root: `npm run build`, `npm run typecheck`, `npm test` all pass (61 files, 406 tests).

| Verification item | Answer_Status | Result |
| --- | --- | --- |
| Final-image latency (20 samples, `openrouter`, raw JSON) | `confirmed` | p50 837 ms, p95 1281 ms, 20/20 ok. Below the 7500 ms per-step budget. Model `typesafe/jev-1.14-20261014`. |
| `image_url` array form | `confirmed` | Accepted (HTTP 200) for a true and a false claim on the fixture. Noul 0.99 for "The page shows a counter with value 0" and 0.01 for the false confirmation-message claim (gap 0.98). The shape is undocumented, so it is not adopted; image and text states stay separate. |
| Direct `typesafe` provider | `not tested (blocked: TYPESAFE_API_KEY not set)` | No probe run, no result recorded. Follow-up: #25. |

### Deliberate narrowing of issue #5 "Done when"

The direct `typesafe` provider item is **deferred to #25** because `TYPESAFE_API_KEY` is not available. This is a deliberate narrowing of the "Done when" line of issue #5 for the direct provider only. Latency and the `image_url` shape are answered in the findings document. Follow-up: https://github.com/rfxlamia/ce/issues/25

### Already-checked items: existing evidence

- Raw JSON `noul` plus `box` works: `spike-jev-openrouter.md` Addendum; `design.md` sections 5 and 12; 20/20 raw JSON requests in the findings document; `transport-json.test.ts` body and asset tests.
- `TypeSafe-Danger-Zone-Images` not needed on the JSON path: spike diagnostic samples (header ON/OFF); `transport-json.test.ts` tests `omits TypeSafe-Danger-Zone-Images for openrouter even when requested` and `sends TypeSafe-Danger-Zone-Images only for typesafe with the option on`; header logic in `transport-json.ts`.
- Upstream report filed: https://github.com/typesafe-ai/typesafe-sdk-js/issues/27

## Traceability (issue #5 checklist to requirements, tasks and evidence)

| Issue #5 item | Requirements | Tasks | Evidence |
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
| Raw JSON `noul` plus `box` works (already checked) | 3, 20.3 | 5.1, 5.4, 21 | spike Addendum; design s5, s12; 20/20 raw JSON requests; transport-json.test.ts |
| `TypeSafe-Danger-Zone-Images` not needed on JSON path (already checked) | 3.5, 20.3 | 5.1, 5.4, 10.2, 21 | spike diagnostic samples; transport-json.test.ts header tests |
| Upstream report typesafe-sdk-js#27 (already checked) | 20.3 | 21 | https://github.com/typesafe-ai/typesafe-sdk-js/issues/27 |
| Final-image latency, p50 and p95 over 20 samples | 14, 15 | 14.1, 14.2, 15.1, 17, 20 | confirmed: p50 837 ms, p95 1281 ms, 20/20 ok (findings Item 1; samples/20261125T142607Z-gateway/); properties/p20-latency-stats |
| `image_url` array form | 14, 16 | 14.1, 15.1, 18, 20 | confirmed: true-claim noul 0.99, false-claim noul 0.01; undocumented shape, not adopted (findings Item 2; samples/20261125T150639Z-gateway/; supersedes 20261125T142750Z-gateway/) |
| Direct `typesafe` provider | 14, 17 | 15.1, 19, 20 | not tested (blocked: TYPESAFE_API_KEY not set); follow-up #25 (findings Item 3) |
| All tests keyless with the fake gateway | 19 | 7, 11, 13.3, 16, 21 | keys unset: build, typecheck, test pass; 61 files, 406 tests |

## Gates

- `all_tasks_complete`: tasks 1 to 21 checked in `tasks.md`.
- `verification_items_answered`: three items answered in the findings document, direct provider with blocked status and linked follow-up #25.
- `issue_checklist_verified`: every checklist item has evidence in the table above.
