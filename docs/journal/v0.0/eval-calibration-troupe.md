# Assessment calibration: real regressions from troupe

Tracking issue: [#29](https://github.com/rfxlamia/ce/issues/29). Follow-up to [`eval-calibration-heldout.md`](eval-calibration-heldout.md) and [`eval-calibration-boundary.md`](eval-calibration-boundary.md).

This record runs CE on real merged pull requests that later needed a regression fix. It covers one model, one repository and 21 pull requests. It is a recall probe, not a general accuracy claim, and it changes no default. Per Decision D2, any change to a threshold, band or policy needs maintainer agreement.

## Pre-registration

This section was written and committed before the first live `ce eval` run on this set. It must not be edited after any score is visible. Later sections are added below it.

### Question

The synthetic sets each hold one claim and a short diff. Real pull requests are long, have many candidate sentences and noisy checks. The question this set answers:

**When a real change shipped a regression that its checks did not cover, does CE, at the shipped defaults (0.7 / band 0.1 / evidence), flag the claim that later regressed?**

Comparing threshold cells is not part of this record. Every fixture here is a known regression, so "require evidence more often" always looks better on it; a cell comparison on this set would be tautological.

### Source and selection

Source: [gnoviawan/troupe](https://github.com/gnoviawan/troupe) (formerly termul), a Tauri desktop app with a web client, MIT licensed, used with the maintainer's permission. See [`NOTICE`](../../../fixtures/eval-troupe/NOTICE).

1. Of 1464 merged pull requests, 44 fix pull requests reference an earlier number. 37 of those references are pull requests (7 are issues), giving 35 unique cause pull requests.
2. Each cause pull request was converted mechanically into a fixture: title, description, commits, files with patches, and its `github-actions` check runs. Privacy transform, fixed before conversion: commit trailers (Co-authored-by, Signed-off-by, Reviewed-by, Reported-by) removed, e-mail addresses replaced with `<email>`, @mentions replaced with `@<user>`. A scan with the corpus `SECRET_PATTERNS` plus an e-mail pattern found 0 matches in the final files.
3. A class labeller (Claude Sonnet, three parallel instances, one per batch) read the cause pull request, its test files and test patches, the numbered list of candidates CE's own extractor produces for it, and the fix pull request. For each pair it returned keep or drop with a reason, a class, and the candidate numbers that state the behavior that later regressed. Classes:
   - **C1**: no test file in the cause diff touches the regressed behavior, and the fix pull request names no existing test that covered it. The checks were blind, so CE should ask for evidence.
   - **C2**: a test in the cause diff, or one the fix names, covers the regressed behavior.
   - **C3**: the regression is a side effect no candidate describes. CE cannot be expected to see it. Excluded.
   - The labeller could also mark a pair **extractor-blind**: the cause pull request describes the behavior, but none of the extracted candidates states it. No pair was marked so.
4. Result: 12 dropped, 2 C3 excluded, **21 kept: 16 C1 and 5 C2**.

Kept fixtures (merge date reported per fixture because of the contamination caveat below; "truncated" counts files whose patch CE cut):

| fixture | class | labeller confidence | merged | fixed by | files | truncated files | regressed behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `troupe-75` | C1 | medium | 2026-03-12 | #76 | 24 |  | Dragging a tab onto another pane no longer showed drop zones, because FileExplorer got its own PaneDndProvider. |
| `troupe-197` | C1 | high | 2026-06-01 | #347 | 1 |  | Creating a worktree on Windows failed, because canonicalize() returned a `\\?\` path git.exe could not parse. |
| `troupe-227` | C1 | high | 2026-06-01 | #245 | 8 |  | Project and group-folder drag-to-reorder in the sidebar was broken. |
| `troupe-433` | C1 | low | 2026-07-25 | #465 | 126 | 115 | Local `build:tauri` embedded a stale `dist-web`, so the remote web UI lagged behind the desktop UI. |
| `troupe-471` | C1 | medium | 2026-07-30 | #472 | 3 |  | The tunnel reachability probe false-failed in the field, so the server was drained and no QR code was shown. |
| `troupe-488` | C2 | medium | 2026-07-31 | #727, #723 | 7 |  | Chat file-path linkification matched slash-separated prose (and/or, TCP/IP) and markers rendered as `[blocked]`. |
| `troupe-499` | C1 | high | 2026-08-01 | #500 | 31 | 15 | Web UI crashed on load with React error #185 from an object-returning zustand selector. |
| `troupe-510` | C2 | medium | 2026-08-01 | #511 | 15 |  | Enabling an MCP server with empty args/env/headers made `acp_new_session` fail. |
| `troupe-537` | C1 | medium | 2026-08-03 | #691 | 14 |  | Pasting an MCP config whose HTTP/SSE server has headers as an object map was rejected. |
| `troupe-551` | C2 | medium | 2026-08-06 | #554 | 61 | 47 | Click-to-install broke: every catalog agent without sha256 was demoted to manual install. |
| `troupe-600` | C1 | low | 2026-08-10 | #612 | 14 |  | The new tool-call "Open file" action was placed mid-row instead of last. |
| `troupe-610` | C1 | medium | 2026-08-11 | #617 | 9 |  | Plan tool calls emitted `acp:plan_update` to an older session when an agent reused a stale MCP child. |
| `troupe-624` | C1 | medium | 2026-08-12 | #627 | 9 |  | Plan fenced blocks in historical messages rendered as raw JSON instead of a PlanPanel. |
| `troupe-752` | C1 | high | 2026-09-29 | #754 | 18 | 4 | Every isolated-worktree agent launch failed, because `git worktree add` was passed a nonexistent `--progress` flag. |
| `troupe-872` | C1 | medium | 2026-10-04 | #921 | 20 | 1 | A crashed ACP chat reopened as a live turn, with a permanent spinner and an unclosable tab. |
| `troupe-1077` | C2 | low | 2026-10-12 | #1621 | 43 | 33 | Reconnect backoff reset only after 60 s of stable connection, so "Reconnecting..." persisted under frequent drops. |
| `troupe-1088` | C1 | high | 2026-10-12 | #1170 | 49 | 37 | The host-start interrupted-turn sweep parsed GBs of session logs on every launch, blocking startup for minutes. |
| `troupe-1275` | C1 | medium | 2026-10-16 | #1291 | 4 |  | OS-level ENOENT spawn errors were left raw, losing the friendly guidance. |
| `troupe-1510` | C2 | medium | 2026-10-26 | #1689 | 9 |  | Every reopen minted a new plan token, so the agent saw a new fingerprint and killed the live process. |
| `troupe-1720` | C1 | medium | 2026-11-05 | #1767 | 10 |  | After clicking a collapsed-Rail tab icon the track unmounted, shifting buttons under the pointer. |
| `troupe-2092` | C1 | low | 2026-11-25 | #2145 | 45 | 41 | Regressions in the redesigned annotation overlay; primarily, annotations failed to save on strict-CSP sites. |

Dropped or excluded:

| pair | status | reason |
| --- | --- | --- |
| `troupe-519` | dropped | Causality unclear: the fix extends the pattern to slash commands, a follow-up feature. |
| `troupe-627` | dropped | The bug pre-existed; the fix completes an earlier fix. |
| `troupe-670` | dropped | The fix covers unrelated rendering gaps. |
| `troupe-740` | dropped | The bug pre-existed; the fix completes an earlier fix. |
| `troupe-817` | dropped | Causality unclear: follow-up redesign. |
| `troupe-925` | dropped | The fix is a formatting-only CI repair. |
| `troupe-944` | dropped | The fix is test-only. |
| `troupe-991` | dropped | Causality unclear: follow-up hardening. |
| `troupe-1058` | dropped | The fix is a requested design follow-up. |
| `troupe-1230` | dropped | The fix refines timing the cause specified on purpose. |
| `troupe-1654` | dropped | The fix is the planned next pull request of a stack. |
| `troupe-1791` | dropped | The fix touches other code. |
| `troupe-726` | C3, excluded | Custom scrollbar styling was dropped app-wide; no candidate describes it. |
| `troupe-1722` | C3, excluded | A WebKit upload wait timed out on pages that clear the input; no candidate describes it. |

### Labels

`loadFixtures` requires an `isBehavior` label for every candidate. Most fixtures hit the 50-candidate cap, so full manual labels would mean about 1000 judgements that this record does not use. The labels are therefore schema filler, set mechanically:

- The regression-bearing candidates chosen by the class labeller: `isBehavior` true, `runtimeObservable` true, `checksAdequate` = (class is C2), surface `browser_ui` for the two web-client fixtures (`troupe-499`, `troupe-1077`) and `native_app` otherwise.
- Every other candidate: `isBehavior` false.
- `required` true for every fixture, `claimStatus` identified.

Labels change only which eval-loop samples are recorded. They do not feed `assess()`. The agreement rows `ce eval` prints for this set are not results and are not reported.

### Run protocol

- Shipped defaults, no `--config`: claim 0.6, observable 0.6, adequate 0.7, band 0.1, on-uncertain evidence.
- One `ce eval` process per fixture, because one malformed answer aborts a whole run. A fixture whose process fails, or writes no `eval.json`, counts as errored for that repeat; it is excluded from that repeat and listed. It is never retried.
- 3 repeats.
- Analysis: [`troupe-analyze.mjs`](#appendix-troupe-analyzemjs). It recomputes `combine` from each recorded `perClaim` and must reproduce every `required` and `decidedBy`. A mismatch voids the analysis until explained.

### Metric

The headline is claim-level. A regression-bearing candidate's `claimId` is its candidate id, so its record in `assessments[].perClaim` is found by id. For each fixture and repeat, the outcome is the best over its regression-bearing candidates, in this order:

1. `needed`: the claim is needed (RO ≥ 0.6 and CA < 0.7). **Caught.**
2. `uncertain`: not needed, but in the band. Caught under the shipped `evidence` policy. **Caught.**
3. `miss`: a claim, but neither needed nor uncertain. **Missed at the assessment stage.**
4. `not-behavior`: `is_behavior` below 0.6, so the candidate never became a claim. **Missed at the claim stage.**

Fixture-level `required` is secondary. With up to 50 candidates per fixture, it is expected to be true almost always, for reasons unrelated to the regression. Even so, a fixture-level `SKIPPED` on any C1 fixture is reported as a false skip at the defaults, by name.

### Decision rule

On C1, with n counted after errored runs are excluded:

- **n < 8 in any repeat:** inconclusive.
- **A C1 regression claim is missed (`miss` or `not-behavior`) in 2 or more of 3 repeats:** recall gap. The finding names the stage (claim or assessment) for each such fixture. Claim-stage misses (`not-behavior`) and assessment-stage misses (`miss`) are reported as separate counts. The next step is to investigate the question catalog and change context, not thresholds. No threshold or policy change is proposed from this set.
- **No C1 regression claim is missed in 2 or more repeats:** report the exact one-sided 95% upper bound on the miss rate (0/16 gives 17.1%). The next step is shadow mode and more repositories.

Sensitivity rows, reported either way: C1 without low-confidence labels, and C1 without fixtures whose diffs CE truncated. C2 is reported descriptively; no rule applies to it.

### Known limits

- **Contamination.** The model id is `typesafe/jev-1.14-20261014`. 17 of 21 pull requests merged before 2026-10-14 and are public, so the model may have seen them. Four merged after (`troupe-1275`, `troupe-1510`, `troupe-1720`, `troupe-2092`).
- **Hindsight labels.** The class labeller saw the fix, so it knows which behavior broke. That is required to pick the regression-bearing candidate, but the C1/C2 call is one model's judgement with no second labeller.
- **Candidate cap.** 33 of 35 converted pull requests hit `CANDIDATE_CAP` = 50; template checklist lines take many slots. The class labeller found no pair where this hid the regressed behavior, but the cap stays a risk on real pull requests.
- **Candidate quality.** Some regression-bearing candidates are implementation fragments rather than behavior statements, for example ``Wrap FileExplorer in PaneDndProvider for drag-drop context`` and ``It runs before any client can connect.`` A `not-behavior` outcome on such a candidate may be a correct classification, not a recall miss. Claim-stage misses are therefore not read as pure CE recall.
- **One repository, one model.** Results do not transfer to other codebases or model versions without new runs.

### Fixture hashes (SHA-256)

```
3dd53c9ae17c83fd8c72ee34a9f54c5d5124ea7985f60e3f17847e37e4117896  troupe-75.json
f7dd72ac2bd42e39fdbac042400814ed0ccbcf94aac77d09c7ab38045a271e9b  troupe-197.json
c28fce7b0e1c5ee8a400244764bacc67dc85cdff3510b9300f221dc61f0f65de  troupe-227.json
1255ac7674164f7028f97ba7a11e144cf6f67a87a6b209795ec483d6235a7fc7  troupe-433.json
dec37f392caeb8215842e8c488e3c1aa129648e7869c02bfca7b16a67ad5a562  troupe-471.json
9d6d057c4fe61360e1eff6cf3ff736e4a5beda6e9442075852a807d5b7427908  troupe-488.json
031fdd6ab8b4263ce2bba213e548368dd531dc50952d7ea3257ca5672dab3bbf  troupe-499.json
245b47cbab7fb74d691fceaa1c0f3b29a9ef04aaee22c719242156c445135027  troupe-510.json
e08e65dcaaca445ffcf55616e3bdbf4fe59f85ec38da3f0d59237442f176ccad  troupe-537.json
fb368087887d9da8ced427348e14cce4b4bfe44546b780a24ce8a5d7ba606228  troupe-551.json
be0941379b017b301f93e3e61efcd0270164e3a893768b86010c6125c3f6840b  troupe-600.json
d4370101ee308525bf6becb48c443b9041e8e51b9c47fd94954d740255cbd315  troupe-610.json
6cdedafa7ea90d3f95d1954baf12f41b59b46ac2458efe3daf1843547ffb270c  troupe-624.json
9fee6169576cbdc796902b7cf5474f7f7fce878172deeda35c17bbea7b9f9376  troupe-752.json
8bf83ca16248886af628f01c9b8c2c58f7e491f296f9f985fbdd968ad7c02eee  troupe-872.json
4fbd6d23815e79794af443068a4c69c10c31e4f5943b5c5b9988ff8e92d4d7d3  troupe-1077.json
72ada608db26580287a78d820aa4bda1b797ea707a8cdbc83e0dec61531355e4  troupe-1088.json
3187a6eaa4a35d526c8326096b366fa05ad98e0f049d02fd1b4f83c85318f5b6  troupe-1275.json
34a2b4540e52462633d344e89005463131b96bcad4feecc195b136aae774c0ba  troupe-1510.json
f5be7a1ea58bd46fb50fc151e1ab7976656f01d7410160b84ef81da8096ff39e  troupe-1720.json
a82cf123c3ea0dbf5331870d4ff8118277bb3873080f3669c3530ab7c9ac23e5  troupe-2092.json
```

The analysis script was smoke-tested before the freeze with a deterministic stub gateway (no network): it reproduced `combine` on 41 of 41 fixture runs and listed a simulated errored run.

## Results

Added after the three live runs. Nothing above this heading was changed.

### Runs

- Model id `typesafe/jev-1.14-20261014` in every run. Shipped defaults, as pre-registered.
- `combine` reproduction: 54 of 54 completed fixture runs. Every recorded `required` and `decidedBy` was recomputed exactly from `perClaim`.
- Errored runs: 9, all in repeat 3 (`troupe-510`, `-537`, `-551`, `-600`, `-610`, `-624`, `-75`, `-752`, `-872`). They ran one after another from 21:20 local time. Each failed at the assessment stage with `APIConnectionError` or `APITimeoutError` after the gateway's two transient retries. The last eight failed about 2 s apart. This reads as a network outage, not a fixture problem; OpenRouter answered normally a few minutes later. As pre-registered, they are excluded and not retried.
- C1 n per repeat: 16, 16, 9. The minimum is 8, so the set is conclusive.
- Requests per repeat: 1692, 1690, 976. That is about 80 billable requests per real pull request (50 classifications plus about 30 assessments; the eval loop's repeated classification questions were served from the memo).

### Headline

| subset | n | regression claim missed per repeat (miss or not-behavior) | fixture SKIPPED per repeat | upper 95% bound on claim miss rate (worst repeat) |
| --- | --- | --- | --- | --- |
| C1, all | 16 | 2/16, 2/16, 1/9 | 0/16, 0/16, 0/9 | 34.4% (2/16) |
| C1, without low confidence | 13 | 1/13, 1/13, 1/7 | 0/13, 0/13, 0/7 | 52.1% (1/7) |
| C1, without truncated diffs | 10 | 2/10, 2/10, 1/5 | 0/10, 0/10, 0/5 | 50.7% (2/10) |
| C2, all | 5 | 0/5, 0/5, 0/3 | 0/5, 0/5, 0/3 | 45.1% (0/5) |

Per fixture, at the shipped defaults (outcomes r1 / r2 / r3; scores are repeat 1):

| fixture | class | conf | trunc | outcome per repeat | is_behavior p | regression claim scores (r1) | fixture required / decidedBy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `troupe-75` | C1 | med/high |  | not-behavior / needed / ERROR | 0.57 / 0.60 / - | - | true/classifier / true/classifier / ERROR |
| `troupe-197` | C1 | med/high |  | needed / needed / needed | 0.88 / 0.86 / 0.88 | RO 0.79 CA 0.26 | true/classifier / true/classifier / true/classifier |
| `troupe-227` | C1 | med/high |  | needed / needed / needed | 0.93 / 0.92 / 0.92 | RO 0.92 CA 0.43 | true/classifier / true/classifier / true/classifier |
| `troupe-433` | C1 | low | yes | needed / needed / needed | 0.84 / 0.85 / 0.85 | RO 0.75 CA 0.21 | true/classifier / true/classifier / true/classifier |
| `troupe-471` | C1 | med/high |  | needed / needed / needed | 0.93/0.92 / 0.93/0.91 / 0.93/0.92 | RO 0.89 CA 0.46; RO 0.8 CA 0.29 | true/classifier / true/classifier / true/classifier |
| `troupe-488` | C2 | med/high |  | needed / needed / needed | 0.95/0.93 / 0.95/0.92 / 0.95/0.92 | RO 0.86 CA 0.59; RO 0.89 CA 0.62 | true/classifier / true/classifier / true/classifier |
| `troupe-499` | C1 | med/high | yes | needed / needed / needed | 0.84 / 0.84 / 0.84 | RO 0.88 CA 0.26 | true/classifier / true/classifier / true/classifier |
| `troupe-510` | C2 | med/high |  | needed / needed / ERROR | 0.92 / 0.92 / - | RO 0.88 CA 0.53 | true/classifier / true/classifier / ERROR |
| `troupe-537` | C1 | med/high |  | needed / needed / ERROR | 0.88 / 0.88 / - | RO 0.9 CA 0.63 | true/classifier / true/classifier / ERROR |
| `troupe-551` | C2 | med/high | yes | needed / needed / ERROR | 0.89/0.88 / 0.89/0.88 / - | RO 0.85 CA 0.39; RO 0.65 CA 0.26 | true/classifier / true/classifier / ERROR |
| `troupe-600` | C1 | low |  | miss / miss / ERROR | 0.77 / 0.82 / - | RO 0.9 CA 0.82 | true/classifier / true/classifier / ERROR |
| `troupe-610` | C1 | med/high |  | needed / needed / ERROR | 0.85 / 0.81 / - | RO 0.7 CA 0.22 | true/classifier / true/classifier / ERROR |
| `troupe-624` | C1 | med/high |  | needed / needed / ERROR | 0.90 / 0.91 / - | RO 0.92 CA 0.61 | true/classifier / true/classifier / ERROR |
| `troupe-752` | C1 | med/high | yes | needed / needed / ERROR | 0.86 / 0.86 / - | RO 0.87 CA 0.54 | true/classifier / true/classifier / ERROR |
| `troupe-872` | C1 | med/high | yes | needed / needed / ERROR | 0.63/0.86 / 0.63/0.84 / - | RO 0.77 CA 0.19; RO 0.87 CA 0.2 | true/classifier / true/classifier / ERROR |
| `troupe-1077` | C2 | low | yes | needed / needed / needed | 0.78 / 0.78 / 0.79 | RO 0.78 CA 0.63 | true/classifier / true/classifier / true/classifier |
| `troupe-1088` | C1 | med/high | yes | uncertain / uncertain / needed | 0.90/0.78 / 0.89/0.78 / 0.89/0.79 | RO 0.59 CA 0.24; RO 0.48 CA 0.25 | true/classifier / true/classifier / true/classifier |
| `troupe-1275` | C1 | med/high |  | needed / needed / needed | 0.85/0.58 / 0.86/0.58 / 0.86/0.58 | RO 0.85 CA 0.5 | true/classifier / true/classifier / true/classifier |
| `troupe-1510` | C2 | med/high |  | needed / needed / needed | 0.92 / 0.92 / 0.92 | RO 0.85 CA 0.66 | true/classifier / true/classifier / true/classifier |
| `troupe-1720` | C1 | med/high |  | uncertain / miss / miss | 0.73/0.90 / 0.74/0.89 / 0.77/0.89 | RO 0.92 CA 0.83; RO 0.94 CA 0.79 | true/classifier / true/classifier / true/classifier |
| `troupe-2092` | C1 | low | yes | needed / needed / needed | 0.73/0.94 / 0.73/0.94 / 0.73/0.93 | RO 0.86 CA 0.37; RO 0.67 CA 0.35 | true/classifier / true/classifier / true/classifier |

**Rule outcome: recall gap.** Two C1 regression claims were missed in two or more repeats. Both misses are at the assessment stage. There was 1 claim-stage miss in all runs (`troupe-75`, repeat 1, `is_behavior` 0.57), and it did not repeat.

- `troupe-600`: `miss` in both completed repeats. RO 0.90, CA 0.82.
- `troupe-1720`: `uncertain`, then `miss`, `miss`. CA 0.79 to 0.83.

14 of 16 C1 regression claims were missed in fewer than 2 repeats, which is the rule's criterion. 13 of 16 were caught in every completed repeat; `troupe-75` was caught in repeats 1 and 2 only. No C1 fixture was `SKIPPED` in any repeat. All 5 C2 claims were also `needed`.

The sensitivity row "C1, without low confidence" has n = 7 in repeat 3, below the minimum of 8. The rule governs only the "C1, all" row.

**Base rate. This set cannot show that CE discriminates.** Claims that did not later regress were caught (`needed` or `uncertain`) at nearly the same rate as the regression claims:

| repeat | non-regression claims caught | C1 regression claims caught |
| --- | --- | --- |
| r1 | 520 / 613 (84.8%) | 14 / 16 (87.5%) |
| r2 | 524 / 611 (85.8%) | 14 / 16 (87.5%) |
| r3 | 301 / 358 (84.1%) | 8 / 9 (88.9%) |

A recall near 87% is therefore what flagging about 85% of all claims would give anyway. Zero false skips follows from every fixture being `required`, not from CE finding the regression.

### Diagnosis of the two misses

The pre-registered next step for a recall gap is to look at the catalog and context, not thresholds. I read the diffs of both fixtures. In both, a test in the cause diff does cover the claim as written; the regression lives in an aspect the claim does not state.

- `troupe-600`. Claim: "Render an "Open file" `IconActionButton`". `ToolCallCard.test.tsx` in the same diff adds `renders an "Open file" button when rawInput has a path and filePathContext is set`. The regression was the button's position in the row, which no candidate states.
- `troupe-1720`. Claim: "The collapsed Rail shows its four tab icons only when the Side panel is also hidden." `ShellRail.test.tsx` in the same diff adds `shows the Column tabs only while the Side panel is not on screen`. The regression was a layout shift after clicking an icon. Another candidate, "After an icon shows the panel, focus moves to the panel tab, because the icon unmounts.", names its cause, but the class labeller did not select it.

So a high `checksAdequate` on these claims is a defensible answer to the question CE asked. The gap is claim granularity: CE judges the claims a pull request states, and these regressions sat in side effects of those claims. The C1 labels were correct by the operational definition (no test touches the regressed aspect), but the chosen claims did not state that aspect. This is a post-hoc reading. The rule outcome above stands as recorded.

### What this set shows beyond the rule

These observations are exploratory. They were not pre-registered, and none of them proposes a default.

1. **The evidence band and the `evidence` policy did real work.** `troupe-1088` was caught only as `uncertain` in repeats 1 and 2 (RO 0.59, inside the band). `troupe-1720` was caught in repeat 1 only because CA 0.79 fell inside the band. Candidate A (0.7/skip) would have missed both of those catches. Candidate B (0.6/evidence) would have missed the `troupe-1720` one; it keeps `troupe-1088`, which is uncertain on RO, not CA. This is consistent with the boundary record's conclusion to keep the defaults.
2. **Real pull requests are always `EVIDENCED`.** Every completed fixture run was `required`, decided by the classifier. Across repeat 1, 640 claims were assessed; 459 (72%) were `needed` and 85 (13%) more were `uncertain`. Every fixture had at least one `needed` claim. This set holds only pull requests that shipped a regression, so it cannot say whether `EVIDENCED` was wrong for any of them. It does mean that a precision measurement on real pull requests that did not regress is the next missing piece.
3. **Template lines become claims.** Counted on repeat 1, over the 1050 deduplicated candidates of all 21 fixtures:
   - Unchecked task-list lines (`[ ] ...`, for example `[ ] docs: documentation only`): 145 candidates, 73 claims (11% of the 640 assessed claims), 21 `needed` and 19 more `uncertain`. These are template options the author did not select, so they say nothing about the change, yet 40 of them push the run toward evidence.
   - Checked task-list lines (`[x] ...`, for example `[x] Manual verification completed`): 187 candidates, 63 claims, 37 `needed`. These are author statements about verification, not about behavior, so they are a separate and less clear-cut case.
4. **Retry budget.** The gateway retries a transient failure twice, with 0.5 s and 1 s back-off. That does not ride out a short network outage, so a CI run during one ends in `ERROR`. That is a safe outcome (never a false `SKIPPED`), but it is a usability cost.

### Conclusion for #29

- No change to `adequateThreshold`, `uncertainty-band` or `on-uncertain`. The two rule misses come from claim granularity, not from the thresholds, and the two band catches above argue against loosening them.
- This set does not show that CE separates risky claims from safe ones: it flags about 85% of all claims, and every real pull request here ended `EVIDENCED`. On complex real pull requests, recall looks fine and precision is unmeasured. The precision set is therefore the required next calibration, not an optional one.
- Follow-ups, each needing its own issue and maintainer agreement:
  - a precision set of real pull requests that did not regress (or shadow mode), required before any claim that CE discriminates;
  - candidate extraction that drops unchecked task-list options (11% of claims here);
  - possibly a longer transient back-off.

## Appendix: troupe-run.sh

Run from any directory as `troupe-run.sh <repoRoot> <k> <runsRoot>` for k = 1, 2, 3.

```bash
#!/usr/bin/env bash
# Runs `ce eval` once per troupe fixture (one process each, so one failure cannot void the others), for repeat k.
# Usage: troupe-run.sh <repoRoot> <k> <runsRoot>
set -u
repo=$1; k=$2; out=$3/r$k; mkdir -p "$out"
cd "$repo" || exit 1
for f in fixtures/eval-troupe/*.json; do
  id=$(basename "$f" .json); one=$(mktemp -d); cp "$f" "$one/"
  before=$(ls -d .ce/runs/eval-* 2>/dev/null | sort | tail -1)
  if node packages/ce/dist/cli.js eval --fixtures "$one" > "$out/$id.log" 2>&1; then
    after=$(ls -d .ce/runs/eval-* 2>/dev/null | sort | tail -1)
    if [ "$after" != "$before" ] && [ -f "$after/eval.json" ]; then cp "$after/eval.json" "$out/$id.json"; echo "ok $id"; else echo "noeval $id"; fi
  else echo "ERROR $id (see $out/$id.log)"; fi
  rm -rf "$one"
done
```

## Appendix: troupe-analyze.mjs

Run as `node troupe-analyze.mjs <repoRoot> fixtures/eval-troupe <runsRoot>` after `npm run build`.

```js
// Troupe real-PR pilot analysis for the #29 follow-up.
// Usage: node troupe-analyze.mjs <repoRoot> <fixturesDir> <runsRoot>
// Regression-bearing candidates are those labelled isBehavior=true; class is C2 when their checksAdequate label is true.
// <runsRoot>/r<k>/<fixtureId>.json is the eval.json of a one-fixture `ce eval` run; a missing file is an errored run.
// Headline: claim-level outcome of the regression-bearing claim(s) under the shipped defaults.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, fixturesDir, runsRoot] = process.argv.slice(2);
const dist = (p) => import(pathToFileURL(resolve(repoRoot, 'packages/ce/dist', p)).href);
const { combine } = await dist('assessment/combine.js');
const { buildFixtureContext } = await dist('eval/providers.js');
const { ConfigDefaults } = await dist('config/defaults.js');

// Labeller confidence "low", from the pre-registration table.
const LOW = new Set(['troupe-433', 'troupe-600', 'troupe-1077', 'troupe-2092']);
const repeats = readdirSync(runsRoot).filter((d) => /^r\d+$/.test(d)).sort();
const RANK = { needed: 3, uncertain: 2, miss: 1, 'not-behavior': 0 };

function upper95(k, n) {
  if (n === 0 || k >= n) return 1;
  const cdf = (p) => {
    let s = 0;
    let term = Math.pow(1 - p, n);
    for (let i = 0; i <= k; i += 1) {
      s += term;
      term *= ((n - i) / (i + 1)) * (p / (1 - p));
    }
    return s;
  };
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 100; it += 1) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > 0.05) lo = mid;
    else hi = mid;
  }
  return hi;
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;

const rows = [];
let reproduced = 0;
let checked = 0;
for (const name of readdirSync(fixturesDir).filter((n) => n.endsWith('.json')).sort((a, b) => parseInt(a.slice(7), 10) - parseInt(b.slice(7), 10))) {
  const fixture = JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
  const ctx = buildFixtureContext(fixture, { config: ConfigDefaults, env: {} }).context;
  const regTexts = Object.keys(fixture.labels.isBehavior).filter((t) => fixture.labels.isBehavior[t] === true);
  const m = {
    id: fixture.id,
    class: regTexts.some((t) => fixture.labels.checksAdequate[t] === true) ? 'C2' : 'C1',
    confidence: LOW.has(fixture.id) ? 'low' : 'medium/high',
    regressionCandidates: regTexts,
    truncated: (ctx.truncated ?? []).some((t) => t.reason !== 'candidate-cap' && !String(t.reason).includes('candidate-cap')),
  };
  const regIds = new Set(ctx.candidates.filter((c) => m.regressionCandidates.includes(c.text)).map((c) => c.id));
  if (regIds.size === 0) throw new Error(`no candidate id for regression text in ${m.id}`);
  const perRepeat = repeats.map((r) => {
    const p = join(runsRoot, r, `${m.id}.json`);
    if (!existsSync(p)) return { error: true };
    const run = JSON.parse(readFileSync(p, 'utf8'));
    const a = run.assessments.find((x) => x.fixtureId === m.id);
    const again = combine(a.perClaim.map(({ needed, uncertain, ...c }) => c), run.settings);
    checked += 1;
    if (again.required === a.required && again.decidedBy === a.decidedBy) reproduced += 1;
    const isBeh = Object.fromEntries(
      run.samples.filter((s) => s.fixtureId === m.id && s.question.includes('is_behavior') && m.regressionCandidates.includes(s.subject)).map((s) => [s.subject, s.probability]),
    );
    const claims = a.perClaim.filter((c) => regIds.has(c.claimId));
    let outcome = 'not-behavior';
    for (const c of claims) {
      const o = c.needed ? 'needed' : c.uncertain ? 'uncertain' : 'miss';
      if (RANK[o] > RANK[outcome]) outcome = o;
    }
    const caught = outcome === 'needed' || (outcome === 'uncertain' && run.settings.onUncertain === 'evidence');
    return {
      outcome,
      caught,
      required: a.required,
      decidedBy: a.decidedBy,
      scores: claims.map((c) => `RO ${c.runtimeObservable} CA ${c.checksAdequate}`).join('; ') || '-',
      isBehavior: Object.values(isBeh).map((x) => x.toFixed(2)).join('/') || '-',
      settings: run.settings,
      modelIds: run.modelIds,
      requests: run.requests,
    };
  });
  rows.push({ ...m, perRepeat });
}

const anyRun = rows.flatMap((r) => r.perRepeat).find((x) => !x.error);
console.log(`repeats: ${repeats.join(', ')}; settings: ${JSON.stringify(anyRun?.settings)}; model ids: ${JSON.stringify([...new Set(rows.flatMap((r) => r.perRepeat.flatMap((x) => x.modelIds ?? [])))])}`);
console.log(`combine reproduction: ${reproduced}/${checked} (required and decidedBy recomputed from perClaim)`);
console.log(`errored fixture runs: ${rows.flatMap((r) => r.perRepeat.map((x, i) => (x.error ? `${r.id}@r${i + 1}` : null))).filter(Boolean).join(', ') || 'none'}`);
console.log(`requests per repeat: ${repeats.map((_, i) => rows.reduce((s, r) => s + (r.perRepeat[i].requests ?? 0), 0)).join(', ')}\n`);

const subsets = [
  ['C1, all', (r) => r.class === 'C1'],
  ['C1, without low confidence', (r) => r.class === 'C1' && r.confidence !== 'low'],
  ['C1, without truncated diffs', (r) => r.class === 'C1' && !r.truncated],
  ['C2, all', (r) => r.class === 'C2'],
];
console.log('| subset | n | regression claim missed per repeat (miss or not-behavior) | fixture SKIPPED per repeat | upper 95% bound on claim miss rate (worst repeat) |');
console.log('| --- | --- | --- | --- | --- |');
for (const [name, f] of subsets) {
  const sel = rows.filter(f);
  const per = repeats.map((_, i) => {
    const ok = sel.filter((r) => !r.perRepeat[i].error);
    return { n: ok.length, miss: ok.filter((r) => !r.perRepeat[i].caught).length, skip: ok.filter((r) => r.perRepeat[i].required === false).length };
  });
  const worst = per.reduce((w, p) => (p.miss / Math.max(p.n, 1) > w.miss / Math.max(w.n, 1) ? p : w), per[0]);
  console.log(`| ${name} | ${sel.length} | ${per.map((p) => `${p.miss}/${p.n}`).join(', ')} | ${per.map((p) => `${p.skip}/${p.n}`).join(', ')} | ${pct(upper95(worst.miss, worst.n))} (${worst.miss}/${worst.n}) |`);
}

console.log('\n| fixture | class | conf | trunc | outcome per repeat | is_behavior p | regression claim scores (r1) | fixture required / decidedBy |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  const p = r.perRepeat;
  console.log(`| \`${r.id}\` | ${r.class} | ${r.confidence} | ${r.truncated ? 'yes' : ''} | ${p.map((x) => (x.error ? 'ERROR' : x.outcome)).join(' / ')} | ${p.map((x) => x.isBehavior ?? '-').join(' / ')} | ${p[0].scores ?? '-'} | ${p.map((x) => (x.error ? 'ERROR' : `${x.required}/${x.decidedBy}`)).join(' / ')} |`);
}
```
