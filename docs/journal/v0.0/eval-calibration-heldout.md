# Assessment calibration on a held-out fixture set

Tracking issue: [#29](https://github.com/rfxlamia/ce/issues/29). Follow-up to the agreement record [`eval-agreement.md`](eval-agreement.md) (issue #7, PR #28).

This record compares assessment settings on a small held-out set. It covers one model on 10 new fixtures. It is not a general accuracy claim, and it changes no default. Per Decision D2, any change to a threshold, band or policy needs maintainer agreement. This document can at most propose one.

## Pre-registration

This section was written and committed before the first live `ce eval` run on the held-out set. It must not be edited after any held-out score is visible. Later sections are added below it.

### Held-out fixtures

The fixtures are in [`fixtures/eval-heldout/`](../../../fixtures/eval-heldout/). They were written from the claim text and the change content only. No score for them existed when they and their labels were fixed. If a label looks wrong after the runs, the label is not edited. The doubt is recorded in this document instead.

All 10 follow the pattern of the dev set:
- There is a single claim candidate: the title equals the only commit message.
- `isBehavior` is true and `claimStatus` is `identified`.
- `runtimeObservable` is true, so `required` depends only on whether the checks are adequate.
- The diff implements the claim.

| Fixture | Surface | `checksAdequate` | `required` | Kind |
| --- | --- | --- | --- | --- |
| `comment-counter-covered` | browser_ui | true | false | positive |
| `rate-limit-429-covered` | http_api | true | false | positive |
| `cli-missing-config-exit-covered` | cli | true | false | positive |
| `invoice-sort-covered` | browser_ui | true | false | positive |
| `project-location-header-covered` | http_api | true | false | positive |
| `search-query-url-hard` | browser_ui | false | true | hard negative |
| `upload-size-413-hard` | http_api | false | true | hard negative |
| `import-progress-bar-hard` | cli | false | true | hard negative |
| `profile-retry-button-hard` | browser_ui | false | true | hard negative |
| `feed-scroll-restore` | browser_ui | false | true | easy negative |

- **Positive:** the change adds a test whose assertion checks the claimed behavior directly, and that test is a passing check.
- **Hard negative:** the change adds a passing test that is named after the same feature area as the claim, but its assertion checks something else, for example the success path or a row count. Hardness was judged by comparing the test name and assertion with the claim text, before any score.
- **Easy negative:** only `build` and `unit-tests` ran.

The hard negatives target the risk of a lower `adequateThreshold`: a related but non-covering check scoring above 0.6 would turn a required run into a false `SKIPPED`.

SHA-256 of each fixture file at freeze time:

```
6f13b63e021bbaad583e189148635c5797d226e9ce5598aa11da1f9b152ef665  cli-missing-config-exit-covered.json
bae5033c1c66e3e8dc0f0265a3fb438d76f3ecf61c3ad4e80d7c582c64fdda60  comment-counter-covered.json
eb1eeeeca4b722cc3599a70acf42b21705857f9d4e0bf659fbfc78719ac26d91  feed-scroll-restore.json
45bf53d4c0f54c20f3bdafd76c3106ad9cf07cbd1a2d5cf531d7037c6f190967  import-progress-bar-hard.json
869da882a66cdc21b63e7ca67b9522e3040750c0d27b9adc335874b777daf9dc  invoice-sort-covered.json
dcd21c72b6383818aaa340f7229dbd4102633b2178c97f4a1be50d49447642d9  profile-retry-button-hard.json
0c80ab3280b4e0490336bd67b90b5fc04aaf247d7c0166f87dfcfb4bce039ca6  project-location-header-covered.json
18c05bb5b54ebe5635f5e59b97e2a47a245931a01a2883bf1e5adfcf95a9f4a5  rate-limit-429-covered.json
4e40c31ccd93e13f917dc898b8bc6b310095bafa6c193f287d9af9f8bb148664  search-query-url-hard.json
e36d1ae4dd01b3072baac8edc55a1308d4e14761fd7dd7f7060f0b1e7e2bae5a  upload-size-413-hard.json
```

### Method

- The settings `adequateThreshold`, `uncertaintyBand` and `onUncertain` are used only in `combine()` (`packages/ce/src/assessment/combine.ts`), after all Jev calls. Different settings send identical Jev requests. Separate live runs per setting would therefore mix classifier noise with the effect of the setting.
- Instead, the held-out set is run live 3 times with the default settings (`node packages/ce/dist/cli.js eval --fixtures fixtures/eval-heldout`). Repeats measure classifier noise.
- For each run, the built `combine` is applied offline to every fixture's recorded `perClaim` scores, for every grid cell (script in the appendix). The comparison between settings is paired: same scores, different settings. `observableThreshold` stays 0.6.
- Script check: with the default settings, applied to dev run 2 (`.ce/runs/eval-2026-11-26T10-10-40-607Z/eval.json`, local and gitignored), the script reproduces the recorded run exactly:
  - `required` agreement is 12 / 17.
  - The `decidedBy` split is 14 classifier / 3 policy.
  - All 17 per-fixture `required` and `decidedBy` values match.

### Grid and roles

- **Baseline:** `adequate` 0.7, band 0.1, `on-uncertain` evidence (the current defaults).
- **Candidates:** the 4 cells with band 0.1, `adequate` {0.6, 0.7} × `on-uncertain` {evidence, skip}. Only a candidate can be proposed.
- **Exploratory:** band {0, 0.05, 0.15} for each of the same 4 combinations. These are reported for context and cannot be proposed.

### Decision rule

A candidate is proposed to the maintainer as a new default only if all of the following hold:

1. **No new false skips.** A false skip is a fixture labelled `required=true` that the cell predicts `required=false`, where the baseline did not. This is checked on the 5 held-out `required=true` fixtures in every repeat, and on the 14 dev-set `required=true` fixtures (dev run 2 scores).
2. **Real gain.** In every held-out repeat, the cell agrees on `assessment.required` with at least 2 more fixtures than the baseline. A gain of exactly 1 fixture is reported as inconclusive.
3. **Same direction on dev.** On dev run 2 scores, the cell's agreement is not lower than the baseline's.

If more than one candidate qualifies, the one closest to the baseline is preferred: one setting changed rather than two. If none qualifies, the record states that the held-out set does not support a change.

Every reported number comes with its n. With 10 fixtures, one fixture is 10 percentage points.

### Known limits

- The same author wrote the dev fixtures, saw the dev scores, and wrote these fixtures and labels. The held-out set is not independent of the dev set's authorship.
- Scores come from one model snapshot (expected `typesafe/jev-1.14-20261014`; the returned id is recorded below). Results may not hold for another model.
- n = 10 (5 positive, 5 negative). This is a small sample.

### Dev-set sweep (context, not held-out)

Dev run 2 scores were already known when this was written. This table is computed from them and is not held-out evidence. It is needed for rules 1 and 3.

| adequate | band | on-uncertain | role | `required` agree / n | delta vs baseline | false skips | false required | policy-decided |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.7 | 0.1 | evidence | baseline | 12 / 17 | +0 | none | backend-cache-ttl, banner-dismiss-covered, cart-total-covered, cli-usage-covered, docs-near-miss-login | 3 |
| 0.7 | 0.1 | skip | candidate | 15 / 17 | +3 | none | backend-cache-ttl, docs-near-miss-login | 3 |
| 0.6 | 0.1 | evidence | candidate | 14 / 17 | +2 | none | backend-cache-ttl, docs-near-miss-login, tooling-near-miss-lint | 1 |
| 0.6 | 0.1 | skip | candidate | 15 / 17 | +3 | none | backend-cache-ttl, docs-near-miss-login | 1 |
| 0.7 | 0 | evidence | exploratory | 15 / 17 | +3 | none | backend-cache-ttl, docs-near-miss-login | 0 |
| 0.7 | 0.05 | evidence | exploratory | 13 / 17 | +1 | none | backend-cache-ttl, banner-dismiss-covered, cli-usage-covered, docs-near-miss-login | 2 |
| 0.7 | 0.15 | evidence | exploratory | 10 / 17 | -2 | none | api-auth-covered, backend-cache-ttl, banner-dismiss-covered, cart-total-covered, cli-usage-covered, docs-near-miss-login, tooling-near-miss-lint | 5 |
| 0.6 | 0 | evidence | exploratory | 15 / 17 | +3 | none | backend-cache-ttl, docs-near-miss-login | 0 |
| 0.6 | 0.05 | evidence | exploratory | 14 / 17 | +2 | none | backend-cache-ttl, docs-near-miss-login, tooling-near-miss-lint | 1 |
| 0.6 | 0.15 | evidence | exploratory | 12 / 17 | +0 | none | backend-cache-ttl, banner-dismiss-covered, cli-usage-covered, docs-near-miss-login, tooling-near-miss-lint | 3 |

All skip cells at any band give 15 / 17 with the same two false-required fixtures.

The motivating fixtures are `banner-dismiss-covered` (CA 0.72), `cart-total-covered` (CA 0.78) and `cli-usage-covered` (CA 0.71). They are false-required at the baseline and correct under all three other band-0.1 candidates. Under 0.6/evidence their CA scores are more than 0.1 above the threshold, so they leave the band. That cell adds one false-required fixture instead: `tooling-near-miss-lint` (CA 0.57, not_identified fallback) is inside the band around 0.6, so it becomes policy-decided and required.

No candidate adds a false skip on the dev `required=true` fixtures.

## Results

Everything in this section was written after the held-out scores were visible. The pre-registration section above is unchanged since the freeze commit.

**Erratum to the pre-registration.** Rule 1 says "the 14 dev-set `required=true` fixtures". The dev set has 9 fixtures labelled `required=true` (and 8 labelled false). 14 is the number of classifier-decided dev fixtures in run 2. The sweep checks every fixture labelled true, so the outcome of rule 1 does not change.

### Run identity

| Item | Repeat 1 | Repeat 2 | Repeat 3 |
| --- | --- | --- | --- |
| Source | `.ce/runs/eval-2026-11-26T12-14-17-407Z/eval.json` | `.ce/runs/eval-2026-11-26T12-14-34-846Z/eval.json` | `.ce/runs/eval-2026-11-26T12-14-52-008Z/eval.json` |
| Git commit | `46253c8` (freeze commit) | `46253c8` | `46253c8` |
| Working tree | Clean | Clean | Clean |
| Provider | `openrouter` | `openrouter` | `openrouter` |
| Returned model id | `typesafe/jev-1.14-20261014` | `typesafe/jev-1.14-20261014` | `typesafe/jev-1.14-20261014` |
| Fixtures | 10 | 10 | 10 |
| Jev requests / memo hits | 20 / 20 | 20 / 20 | 20 / 20 |
| Exit code | 0 | 0 | 0 |

- `.ce/` is gitignored. The run directories above are local to the machine that made the runs, so this document carries the numbers itself.
- `packages/ce/dist` was built from `packages/` source identical to `e7544d7`. No commit after `e7544d7` touches `packages/`. The sweep script ran against that build.
- All runs used the default settings: `claimThreshold` 0.6, `observableThreshold` 0.6, `adequateThreshold` 0.7, `uncertaintyBand` 0.1, `onUncertain` evidence.

### Agreement by row (default settings)

Identical in all three repeats.

| Row | Agreeing / samples |
| --- | --- |
| `claim.is_behavior` | 10 / 10 |
| `assess.runtime_observable` | 10 / 10 |
| `assess.checks_adequate` | 10 / 10 |
| `assess.surface` | 10 / 10 |
| `assessment.required` | 8 / 10 |
| `assessment.claimStatus` | 10 / 10 |
| `assessment.required`, `decidedBy=classifier` | 8 / 8 |
| `assessment.required`, `decidedBy=policy` | 0 / 2 |

### Per-fixture scores across repeats

RO is `runtimeObservable`, CA is `checksAdequate`. Values are listed as repeat 1 / 2 / 3. `required` and `decidedBy` are under the default settings.

| Fixture | Label CA | Label `required` | RO | CA | CA spread | Surface | `required` / `decidedBy` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `comment-counter-covered` | true | false | 0.95 / 0.95 / 0.95 | 0.84 / 0.83 / 0.82 | 0.02 | browser_ui | false / classifier (all) |
| `rate-limit-429-covered` | true | false | 0.89 / 0.87 / 0.89 | 0.86 / 0.86 / 0.85 | 0.01 | http_api | false / classifier (all) |
| `cli-missing-config-exit-covered` | true | false | 0.94 / 0.94 / 0.94 | 0.78 / 0.75 / 0.76 | 0.03 | cli | **true / policy** (all) |
| `invoice-sort-covered` | true | false | 0.91 / 0.9 / 0.91 | 0.79 / 0.74 / 0.78 | 0.05 | browser_ui | **true / policy** (all) |
| `project-location-header-covered` | true | false | 0.93 / 0.93 / 0.93 | 0.88 / 0.9 / 0.88 | 0.02 | http_api | false / classifier (all) |
| `search-query-url-hard` | false | true | 0.86 / 0.86 / 0.86 | 0.35 / 0.37 / 0.35 | 0.02 | browser_ui | true / classifier (all) |
| `upload-size-413-hard` | false | true | 0.8 / 0.81 / 0.79 | 0.14 / 0.15 / 0.13 | 0.02 | http_api | true / classifier (all) |
| `import-progress-bar-hard` | false | true | 0.87 / 0.86 / 0.88 | 0.16 / 0.17 / 0.2 | 0.04 | cli | true / classifier (all) |
| `profile-retry-button-hard` | false | true | 0.73 / 0.68 / 0.7 | 0.05 / 0.06 / 0.06 | 0.01 | browser_ui | true / classifier (all) |
| `feed-scroll-restore` | false | true | 0.77 / 0.8 / 0.77 | 0.11 / 0.1 / 0.09 | 0.02 | browser_ui | true / classifier (all) |

- CA separation: positives score 0.74 to 0.90, negatives 0.05 to 0.37. The gap is 0.37.
- The largest CA spread across repeats is 0.05, and the largest RO spread is 0.05. The three repeats are close to one observation, not three independent ones.
- The baseline repeats the dev pattern. The 2 errors are positives with CA 0.74 to 0.79, inside the 0.1 band around 0.7, decided by policy as `required=true`.

### Held-out sweep

The 4 candidate cells (band 0.1) are shown. Every repeat gives the same agreement for these cells.

| adequate | band | on-uncertain | role | `required` agree / n (repeats 1, 2, 3) | delta vs baseline | false skips | false required | policy-decided (repeats 1, 2, 3) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.7 | 0.1 | evidence | baseline | 8, 8, 8 / 10 | 0 | none | `cli-missing-config-exit-covered`, `invoice-sort-covered` | 2, 2, 2 |
| 0.7 | 0.1 | skip | candidate | 10, 10, 10 / 10 | +2 | none | none | 2, 2, 2 |
| 0.6 | 0.1 | evidence | candidate | 10, 10, 10 / 10 | +2 | none | none | 0, 0, 0 |
| 0.6 | 0.1 | skip | candidate | 10, 10, 10 / 10 | +2 | none | none | 0, 0, 0 |

Exploratory cells (cannot be proposed):
- Every skip cell at any band gives 10 / 10.
- `adequate` 0.6 with evidence gives 10 / 10 at band 0, 0.05 and 0.1. At band 0.15 it gives 10, 9, 10 (`invoice-sort-covered` CA 0.74 in repeat 2 is inside the band).
- `adequate` 0.7 with evidence:
  - band 0 gives 10, 10, 10.
  - band 0.05 gives 10, 9, 10 (`invoice-sort-covered` CA 0.74 in repeat 2).
  - band 0.15 gives 7, 7, 7 (`comment-counter-covered` CA 0.82 to 0.84 joins the band).

No cell in the whole grid produces a false skip on the held-out set.

### Decision rule outcome

| Candidate | Rule 1: no new false skips (held-out 5, dev 9) | Rule 2: gain of at least 2 in every repeat | Rule 3: dev agreement not lower (baseline 12 / 17) | Settings changed |
| --- | --- | --- | --- | --- |
| 0.7 / 0.1 / skip | pass | pass (+2, +2, +2) | pass (15 / 17) | 1 (`on-uncertain`) |
| 0.6 / 0.1 / evidence | pass | pass (+2, +2, +2) | pass (14 / 17) | 1 (`adequateThreshold`) |
| 0.6 / 0.1 / skip | pass | pass (+2, +2, +2) | pass (15 / 17) | 2 |

- All three candidates pass rules 1 to 3.
- The pre-registered tie-break prefers one changed setting over two, which excludes 0.6/skip.
- The tie-break does not separate 0.7/skip from 0.6/evidence. Each changes one setting. On the held-out set both give identical `required` values for all 10 fixtures in all 3 repeats.

**Result: the held-out set supports moving off the current defaults, but it does not choose between `on-uncertain: skip` (keeping `adequateThreshold` 0.7) and `adequateThreshold` 0.6 (keeping `on-uncertain: evidence`).** Per Decision D2 the maintainer chooses. `packages/ce/src/config/defaults.ts` is not changed by this record.

### How strong this evidence is

- **The +2 gain is the ceiling.** The baseline makes only 2 errors, the same two positives in every repeat. Rule 2 was met at its minimum.
- **Rule 1 passed without being tested.** The highest negative CA is 0.37 (`search-query-url-hard`). That is far below the 0.5 to 0.8 region where a lower threshold or `skip` could turn a required run into a false skip. The set did not probe the false-skip margin. Fixtures that would test it are negatives scoring CA 0.6 to 0.75, or claims with RO 0.5 to 0.7.
- **The sample is small.** n = 10, with one model snapshot and one author (see "Known limits").

### Where the two remaining candidates differ (context, not held-out evidence)

This was checked by calling the built `combine` on synthetic scores. It is not part of the decision rule.

| RO | CA | 0.6 / evidence | 0.7 / skip |
| --- | --- | --- | --- |
| 0.9 | 0.65 | required | required |
| 0.9 | 0.69 | required | required |
| 0.9 | 0.70 | required | not required |
| 0.9 | 0.71 | not required | not required |
| 0.65 | 0.85 | required | not required |
| 0.65 | 0.30 | required | required |
| 0.55 | 0.30 | required | not required |
| 0.55 | 0.85 | required | not required |
| 0.45 | 0.30 | not required | not required |

- When RO is clearly above 0.7, the two cells have the same effective CA cut near 0.7. The only difference is the float edge at exactly 0.70: `Math.abs(0.7 - 0.6)` is just under 0.1, so 0.6/evidence counts that score as uncertain.
- They differ when RO is inside the 0.5 to 0.7 band. 0.6/evidence then always requires evidence. 0.7/skip skips whenever the claim is not clearly needed.
- On the dev set the only difference between the two is `tooling-near-miss-lint` (not_identified fallback, RO 0.22, CA 0.57). 0.6/evidence puts it in the band, decides it by policy, and requires it, against a `required=false` label.
- No held-out fixture sits in the RO band with a label that would split the two cells.
- The choice is about whether CE keeps `on-uncertain: evidence`, its conservative default for uncertain observability. That is the stance Decision D2 reserves for the maintainer.

### Verification

- The sweep script reproduces dev run 2 exactly with the default settings (see "Method").
- `npm run typecheck` passes. `npm test` passes: 127 test files, 825 tests. No code changed.
- Diff against the freeze commit `46253c8`: the only removed line is the "Pending" placeholder under Results. The fixtures and the pre-registration section are unchanged.
- This record contains no API key, Authorization header, request state text, or private repository text. It was scanned with the `SECRET_PATTERNS` list from `packages/ce/src/eval/fixtures.corpus.test.ts` and has no match.

## Appendix: sweep script

Run as `node sweep.mjs <repoRoot> <eval.json> <fixturesDir>` after `npm run build`. It imports `combine` from `packages/ce/dist/assessment/combine.js`. The commit of the build it ran against is recorded with each result.

```js
// Offline settings sweep over recorded eval scores (issue #29).
// Usage: node sweep.mjs <repoRoot> <eval.json> <fixturesDir>
// Re-applies the built `combine` to each fixture's recorded perClaim scores for every grid cell.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, evalPath, fixturesDir] = process.argv.slice(2);
const { combine } = await import(
  pathToFileURL(resolve(repoRoot, 'packages/ce/dist/assessment/combine.js')).href
);

const evalJson = JSON.parse(readFileSync(evalPath, 'utf8'));
const labels = Object.fromEntries(
  readdirSync(fixturesDir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      const f = JSON.parse(readFileSync(join(fixturesDir, n), 'utf8'));
      return [f.id, f.labels.required];
    }),
);

const BASELINE = { adequate: 0.7, band: 0.1, policy: 'evidence' };
const grid = [];
for (const adequate of [0.7, 0.6])
  for (const policy of ['evidence', 'skip'])
    for (const band of [0.1, 0, 0.05, 0.15]) grid.push({ adequate, band, policy });

function evaluate(cell) {
  const settings = {
    observableThreshold: evalJson.settings?.observableThreshold ?? 0.6,
    adequateThreshold: cell.adequate,
    uncertaintyBand: cell.band,
    onUncertain: cell.policy,
  };
  const perFixture = evalJson.assessments.map((a) => {
    const subjects = a.perClaim.map((p) => ({
      claimId: p.claimId,
      runtimeObservable: p.runtimeObservable,
      checksAdequate: p.checksAdequate,
      surface: p.surface,
      surfaceConfidence: p.surfaceConfidence,
    }));
    const r = combine(subjects, settings);
    return { id: a.fixtureId, label: labels[a.fixtureId], required: r.required, decidedBy: r.decidedBy };
  });
  const agree = perFixture.filter((f) => f.required === f.label).length;
  const falseSkips = perFixture.filter((f) => f.label === true && f.required === false).map((f) => f.id);
  const falseRequired = perFixture.filter((f) => f.label === false && f.required === true).map((f) => f.id);
  const policy = perFixture.filter((f) => f.decidedBy === 'policy').length;
  return { cell, n: perFixture.length, agree, falseSkips, falseRequired, policy, perFixture };
}

const results = grid.map(evaluate);
const base = results[0];
const key = (c) => `${c.adequate}/${c.band}/${c.policy}`;
const primary = (c) => c.band === 0.1;

console.log(`settings recorded in eval.json: ${JSON.stringify(evalJson.settings)}`);
console.log(`baseline ${key(BASELINE)}; observable threshold fixed\n`);
console.log('| adequate | band | on-uncertain | role | required agree / n | delta vs baseline | false skips | new false skips | false required | policy-decided |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  const newFs = r.falseSkips.filter((id) => !base.falseSkips.includes(id));
  const role = key(r.cell) === key(BASELINE) ? 'baseline' : primary(r.cell) ? 'candidate' : 'exploratory';
  console.log(
    `| ${r.cell.adequate} | ${r.cell.band} | ${r.cell.policy} | ${role} | ${r.agree} / ${r.n} | ${r.agree - base.agree >= 0 ? '+' : ''}${r.agree - base.agree} | ${r.falseSkips.length ? r.falseSkips.join(', ') : 'none'} | ${newFs.length ? newFs.join(', ') : 'none'} | ${r.falseRequired.length ? r.falseRequired.join(', ') : 'none'} | ${r.policy} |`,
  );
}
console.log('\nBaseline per fixture: ' + base.perFixture.map((f) => `${f.id}=${f.required}/${f.decidedBy}`).join(' '));
```
