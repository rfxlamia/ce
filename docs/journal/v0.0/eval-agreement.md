# Claims and Assessment eval: agreement record

This is one measurement of one model on 17 fixtures. It is not a general accuracy claim. The fixtures are in [`fixtures/eval/`](../../../fixtures/eval/). Tracking issue: [#7](https://github.com/rfxlamia/ce/issues/7).

## Run identity

All values below are measurements copied from `.ce/runs/eval-2026-11-26T09-47-54-277Z/eval.json`, except the date and commit, which come from the run directory name and git.

| Item | Value |
| --- | --- |
| Date (UTC) | 2026-11-26 (run directory timestamp 09:47:54Z) |
| Git commit | `d1c989835f98813124281c34c9c300c3a3093198` |
| Working tree | Had uncommitted changes of this feature when the run was made |
| Provider | `openrouter` |
| Returned model id | `typesafe/jev-1.14-20261014` |
| Fixture count | 17 |
| Jev requests | 34 |
| Memo hits | 32 |

## Effective thresholds

| Setting | Value |
| --- | --- |
| `claimThreshold` | 0.6 |
| `observableThreshold` | 0.6 |
| `adequateThreshold` | 0.7 |
| `uncertaintyBand` | 0.1 |
| `onUncertain` | `evidence` |

## Agreement by row

| Row | Samples | Agreeing | Agreement |
| --- | --- | --- | --- |
| `claim.is_behavior` | 17 | 16 | 94.1% |
| `assess.runtime_observable` | 15 | 10 | 66.7% |
| `assess.checks_adequate` | 15 | 13 | 86.7% |
| `assess.surface` | 15 | 14 | 93.3% |
| `assessment.required` | 17 | 7 | 41.2% |
| `assessment.claimStatus` | 17 | 16 | 94.1% |

## Disagreements (20)

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

## Reproducing

```
npm run build
node packages/ce/dist/cli.js eval
```

This needs the provider key in the environment (`OPENROUTER_API_KEY`). Results can differ between runs and model versions.

## Observations (recorded as-is, no tuning)

- `assessment.required` agreement is 41.2% and `assess.runtime_observable` agreement is 66.7%. Both are low.
- Disagreements run in both directions. For `assessment.required`, 6 rows predicted true where the label is false (10, 11, 12, 13, 15, 18) and 4 predicted false where the label is true (14, 16, 17, 19). For `assess.runtime_observable`, 1 predicted true against label false (2) and 4 predicted false against label true (3 to 6).
- No question or threshold was changed after this run. Per Decision D2, such changes need maintainer agreement.
- The labels were written by the author and may themselves be optimistic.
- `jev-calls.jsonl` does not map scores to fixtures. Any per-fixture explanation of why a score fell on one side of a threshold is a hypothesis, not a finding.
- This record contains no API key, Authorization header, request state text, or private repository text.
