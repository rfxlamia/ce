# Claims and Assessment eval: agreement record

This is one measurement of one model on 17 fixtures. It is not a general accuracy claim. The record covers two live runs of the same fixture set. The fixtures are in [`fixtures/eval/`](../../../fixtures/eval/). Tracking issue: [#7](https://github.com/rfxlamia/ce/issues/7).

## Run identity

All values below are measurements copied from the `eval.json` of each run, except the date and commit, which come from the run directory name and git.

| Item | Run 1 (first run) | Run 2 |
| --- | --- | --- |
| Source | `.ce/runs/eval-2026-11-26T09-47-54-277Z/eval.json` | `.ce/runs/eval-2026-11-26T10-10-40-607Z/eval.json` |
| Date (UTC) | 2026-11-26 (run directory timestamp 09:47:54Z) | 2026-11-26 (run directory timestamp 10:10:40Z) |
| Git commit | `d1c989835f98813124281c34c9c300c3a3093198` | `6f5712011f6fba0d0e00a2c99ebc53ec1039a280` |
| Working tree | Had uncommitted changes of this feature when the run was made | Clean for code and fixtures |
| Provider | `openrouter` | `openrouter` |
| Returned model id | `typesafe/jev-1.14-20261014` | `typesafe/jev-1.14-20261014` |
| Fixture count | 17 | 17 |
| Jev requests | 34 | 34 |
| Memo hits | 32 | 32 |

## Effective thresholds

Unchanged between the two runs.

| Setting | Value |
| --- | --- |
| `claimThreshold` | 0.6 |
| `observableThreshold` | 0.6 |
| `adequateThreshold` | 0.7 |
| `uncertaintyBand` | 0.1 |
| `onUncertain` | `evidence` |

## Agreement by row

| Row | Run 1 agreeing / samples | Run 1 agreement | Run 2 agreeing / samples | Run 2 agreement |
| --- | --- | --- | --- | --- |
| `claim.is_behavior` | 16 / 17 | 94.1% | 16 / 17 | 94.1% |
| `assess.runtime_observable` | 10 / 15 | 66.7% | 14 / 15 | 93.3% |
| `assess.checks_adequate` | 13 / 15 | 86.7% | 15 / 15 | 100% |
| `assess.surface` | 14 / 15 | 93.3% | 14 / 15 | 93.3% |
| `assessment.required` | 7 / 17 | 41.2% | 12 / 17 | 70.6% |
| `assessment.claimStatus` | 16 / 17 | 94.1% | 16 / 17 | 94.1% |

### `assessment.required` by `decidedBy` (run 2)

| `decidedBy` | Samples | Agreeing | Agreement |
| --- | --- | --- | --- |
| `classifier` | 14 | 12 | 85.7% |
| `policy` | 3 | 0 | 0% |

Run 1 did not record `decidedBy`, so there is no breakdown for it.

## Run 1 disagreements (20)

Each entry is fixture, question, subject, predicted, label, as recorded in `eval.json`.

| # | Fixture | Question | Subject | Predicted | Label |
| --- | --- | --- | --- | --- | --- |
| 1 | `tooling-near-miss-lint` | `claim.is_behavior` | Fail the build when a lint warning appears | false | true |
| 2 | `backend-cache-ttl` | `assess.runtime_observable` | Cache parsed configuration for ten minutes | true | false |
| 3 | `cli-declared-claim` | `assess.runtime_observable` | The export command writes a CSV file next to the input | false | true |
| 4 | `cli-verbose-flag` | `assess.runtime_observable` | Add a verbose flag that prints each processed file | false | true |
| 5 | `dark-mode-persist` | `assess.runtime_observable` | Persist the dark mode choice across page reloads | false | true |
| 6 | `login-submit-disabled` | `assess.runtime_observable` | Disable the submit button while the login form is sending | false | true |
| 7 | `banner-dismiss-covered` | `assess.checks_adequate` | Hide the banner after the user dismisses it | false | true |
| 8 | `cart-total-covered` | `assess.checks_adequate` | Round the cart total to two decimals on the checkout page | false | true |
| 9 | `tooling-near-miss-lint` | `assess.surface` | Fail the build when a lint warning appears | cli | non_runtime |
| 10 | `api-auth-covered` | `assessment.required` | change | true | false |
| 11 | `backend-cache-ttl` | `assessment.required` | change | true | false |
| 12 | `banner-dismiss-covered` | `assessment.required` | change | true | false |
| 13 | `cart-total-covered` | `assessment.required` | change | true | false |
| 14 | `cli-declared-claim` | `assessment.required` | change | false | true |
| 15 | `cli-usage-covered` | `assessment.required` | change | true | false |
| 16 | `cli-verbose-flag` | `assessment.required` | change | false | true |
| 17 | `dark-mode-persist` | `assessment.required` | change | false | true |
| 18 | `docs-near-miss-login` | `assessment.required` | change | true | false |
| 19 | `login-submit-disabled` | `assessment.required` | change | false | true |
| 20 | `tooling-near-miss-lint` | `assessment.claimStatus` | change | not_identified | identified |

## Run 2 disagreements (9)

Values are from `eval.json`. Probability and threshold are recorded for the boolean questions, confidence for `assess.surface`. `assessment.required` and `assessment.claimStatus` have no probability, threshold or confidence in the record.

| # | Fixture | Question | Subject | Predicted | Label | Probability | Threshold | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `tooling-near-miss-lint` | `claim.is_behavior` | Fail the build when a lint warning appears | false | true | 0.23 | 0.6 | n/a |
| 2 | `backend-cache-ttl` | `assess.runtime_observable` | Memoize the parsed configuration in process memory to avoid re-reading the file | true | false | 0.73 | 0.6 | n/a |
| 3 | `tooling-near-miss-lint` | `assess.surface` | Fail the build when a lint warning appears | cli | non_runtime | n/a | n/a | 0.9 |
| 4 | `backend-cache-ttl` | `assessment.required` | change | true | false | n/a | n/a | n/a |
| 5 | `banner-dismiss-covered` | `assessment.required` | change | true | false | n/a | n/a | n/a |
| 6 | `cart-total-covered` | `assessment.required` | change | true | false | n/a | n/a | n/a |
| 7 | `cli-usage-covered` | `assessment.required` | change | true | false | n/a | n/a | n/a |
| 8 | `docs-near-miss-login` | `assessment.required` | change | true | false | n/a | n/a | n/a |
| 9 | `tooling-near-miss-lint` | `assessment.claimStatus` | change | not_identified | identified | n/a | n/a | n/a |

## Run 2 per-fixture assessments

From the `assessments` field of run 2. Each fixture has one entry in `perClaim`. `RO` is `runtimeObservable`, `CA` is `checksAdequate`. No fixture has any `cuts`.

| Fixture | claimStatus | required | decidedBy | surface | RO | CA | needed | uncertain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `api-auth-covered` | identified | false | classifier | http_api | 0.9 | 0.81 | false | false |
| `api-orders-limit` | identified | true | classifier | http_api | 0.84 | 0.25 | true | false |
| `api-user-404` | identified | true | classifier | http_api | 0.86 | 0.11 | true | false |
| `backend-cache-ttl` | identified | true | classifier | backend_internal | 0.73 | 0.3 | true | false |
| `banner-dismiss-covered` | identified | true | policy | browser_ui | 0.85 | 0.72 | false | true |
| `cart-total-covered` | identified | true | policy | browser_ui | 0.93 | 0.78 | false | true |
| `cli-declared-claim` | identified | true | classifier | cli | 0.78 | 0.11 | true | false |
| `cli-usage-covered` | identified | true | policy | cli | 0.9 | 0.71 | false | true |
| `cli-verbose-flag` | identified | true | classifier | cli | 0.74 | 0.1 | true | false |
| `dark-mode-persist` | identified | true | classifier | browser_ui | 0.89 | 0.07 | true | false |
| `dialog-escape-closes` | identified | true | classifier | browser_ui | 0.84 | 0.19 | true | false |
| `docs-near-miss-login` | not_identified | true | classifier | browser_ui | 0.79 | 0.05 | true | false |
| `email-error-message` | identified | true | classifier | browser_ui | 0.79 | 0.09 | true | false |
| `login-submit-disabled` | identified | true | classifier | browser_ui | 0.74 | 0.07 | true | false |
| `native-window-title` | identified | true | classifier | native_app | 0.88 | 0.07 | true | false |
| `readme-typo` | not_identified | false | classifier | non_runtime | 0.04 | 0.11 | false | false |
| `tooling-near-miss-lint` | not_identified | false | classifier | cli | 0.22 | 0.57 | false | false |

For `docs-near-miss-login`, `readme-typo` and `tooling-near-miss-lint`, the claim id in `perClaim` is `change` (the Change_Subject fallback). For all other fixtures it is `c1`.

## What changed between run 1 and run 2

- Recording: per-sample scores, per-fixture summaries and the `decidedBy` breakdown were added to `eval.json`.
- Fixtures: patches were made so the diffs implement their claims, hunk headers were added, and check names were written in JUnit style.
- No threshold, band, policy, question or catalog change.

The improvement therefore mostly reflects fixture and label quality, not a better classifier. The fixtures were edited after seeing run 1, so run 2 is not an independent held-out measurement.

## Open observations (not acted on)

These are for the maintainer's review. Per Decision D2, changing a question, threshold, band or policy needs maintainer agreement. Nothing was changed.

- The 3 policy-decided covered fixtures (`banner-dismiss-covered`, `cart-total-covered`, `cli-usage-covered`) have `checksAdequate` of 0.72, 0.78 and 0.71, inside the 0.1 band around the 0.7 threshold. With `onUncertain` set to `evidence`, uncertain evidence forces `required=true`, so all three disagree with their `required=false` label.
- `docs-near-miss-login` is classifier-decided because the Change_Subject fallback is asked after `not_identified`. The fallback scored `runtimeObservable` 0.79 and `checksAdequate` 0.05, so `needed` is true and `required` is true against a false label.
- `backend-cache-ttl` has `runtimeObservable` 0.73 against a label of false.
- `tooling-near-miss-lint` disagrees on three rows: `claim.is_behavior` (probability 0.23, label true), `assess.surface` (predicted `cli`, label `non_runtime`, confidence 0.9) and `assessment.claimStatus` (predicted `not_identified`, label `identified`). Its `assessment.required` result agrees (false).

## Reproducing

```
npm run build
node packages/ce/dist/cli.js eval
```

This needs the provider key in the environment (`OPENROUTER_API_KEY`). Results can differ between runs and model versions.

## Observations from run 1 (recorded as-is, no tuning)

- `assessment.required` agreement is 41.2% and `assess.runtime_observable` agreement is 66.7%. Both are low.
- Disagreements run in both directions. For `assessment.required`, 6 rows predicted true where the label is false (10, 11, 12, 13, 15, 18) and 4 predicted false where the label is true (14, 16, 17, 19). For `assess.runtime_observable`, 1 predicted true against label false (2) and 4 predicted false against label true (3 to 6).
- No question or threshold was changed after this run. Per Decision D2, such changes need maintainer agreement.
- The labels were written by the author and may themselves be optimistic.
- `jev-calls.jsonl` does not map scores to fixtures. Any per-fixture explanation of why a score fell on one side of a threshold is a hypothesis, not a finding. Run 2 records per-sample scores in `eval.json`.
- This record contains no API key, Authorization header, request state text, or private repository text.
