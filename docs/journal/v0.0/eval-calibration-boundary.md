# Assessment calibration: boundary fixture set

Tracking issue: [#29](https://github.com/rfxlamia/ce/issues/29). Follow-up to [`eval-calibration-heldout.md`](eval-calibration-heldout.md).

This record tests one specific risk on a purpose-built fixture set. It covers one model on 38 fixtures. It is not a general accuracy claim, and it changes no default. Per Decision D2, any change to a threshold, band or policy needs maintainer agreement.

## Pre-registration

This section was written and committed before the first live `ce eval` run on the boundary set. It must not be edited after any boundary score is visible. Later sections are added below it.

### Question

The held-out record found three candidates that beat the current defaults (0.7 / band 0.1 / evidence):

- A: 0.7 / 0.1 / skip
- B: 0.6 / 0.1 / evidence
- 0.6 / 0.1 / skip

The held-out negatives all scored CA 0.37 or less, so none of them reached the region where the candidates differ from the baseline.

Take a claim with RO well above 0.6 and `checksAdequate` (CA) in (0.70, 0.80]:
- The baseline sees CA inside the band and requires evidence.
- A sees CA inside the band and skips, because `on-uncertain` is skip.
- B sees CA more than 0.1 above 0.6, so it is neither needed nor uncertain, and skips.
- 0.6/skip skips for both reasons.

All three candidates therefore remove the protection the baseline gives in that zone.

The question this set answers: **if a covering-looking but non-covering check scores in this zone, do the candidates turn a run that needs evidence into a false `SKIPPED`?**

### Fixtures

The fixtures are in [`fixtures/eval-boundary/`](../../../fixtures/eval-boundary/). There are 38 of them, all single-claim:
- The title equals the only commit message.
- There is no description and no declared claim.
- The patches contain no comments that would become extra claim candidates.
- `isBehavior` is true, `runtimeObservable` is true, and `claimStatus` is `identified`.

Surfaces are browser_ui, http_api and cli. Domains differ from the dev and held-out sets.

**30 negatives** (`checksAdequate` false, `required` true), 6 per pattern. The file name prefix is the pattern. In every pattern, the claim names a specific behavior X, and no passing check exercises X.

| Pattern | Prefix | Why the checks are not adequate |
| --- | --- | --- |
| 1 | `wrongtarget-` | The test exercises the feature but asserts a different element, field or output line than X. |
| 2 | `mocked-` | The component that produces X is mocked, so X never runs. |
| 3 | `skipped-` | The test that would exercise X exists, but its check has status `skipped` (skip, fixme, quarantined, or skipped on CI). |
| 4 | `happypath-` | X is an error or edge behavior, and the test covers only the normal path. |
| 5 | `renderonly-` | X is an interaction or a state change, and the test only renders or snapshots the initial state. |

**8 positives** (`checksAdequate` true, `required` false), prefix `pos-`. A passing check does cover X, but less obviously: the test has a generic name, sits in a broader test, or asserts X among other things.

**Label independence.** I wrote the fixtures and labels. A separate subagent (Claude Sonnet) then labelled them blind. It saw only the claim, the diff and the checks, in shuffled order with neutral ids. It did not see my labels, the descriptions, or the pattern names.

The pre-registered rule was that any disagreement is dropped, never re-edited.

Result: **0 of 38 disagreed, so 0 were dropped.** n stays at 30 negatives and 8 positives, and every pattern keeps 6.

The labeller and Jev may share model-family biases, so this check reduces author bias but does not remove model bias. The labeller also noted that `wrongtarget-no-color-env` would pass even without the change. This supports the false label.

SHA-256 of each fixture file at freeze time:

```
38f6573c33c77f6b97d03ecce5e120fa4e5cfa219799923c852c7bb12a9a5b45  happypath-date-range-400.json
78fca83f5663a421d82b35cc46d89f822a2a710bbadba364920d3712b35dfed5  happypath-expired-coupon-error.json
40356fc135c7b8d40c81f5aea37f52b71623e7d5455ebd7d5142fb4f137cd213  happypath-inbox-empty-state.json
22c4bdab048cf2b503c7d31ececfe0041d0ce6082a345c0b87cc94e6a037764f  happypath-sync-hidden-files.json
72defb2707601c667e5d0f27332583c17fcc343761578fd9c663b98876828280  happypath-unknown-region-fallback.json
c6cb925078472b9e87be080c2ec372494ad394b505ae8639e0a00b146ada86ea  happypath-webhook-preview-truncate.json
9fbc47ba778bffe8185d0d90be4da57f4d0c1ab846d1072f10d49795823a415a  mocked-backup-gzip.json
231263860c355705d283d170ffab02f4336bb6c791ed281f20158d5fe8eabdf1  mocked-catalog-currency.json
dc901612dd1f36b826f3035e79f9c87dafc9c415a9f9b10fbcc69f1e8e20e606  mocked-draft-save-toast.json
e52dbc333060c9f61dc6eda7fb4475723d51e0fd078934680f881c7f19617986  mocked-form-autosave.json
d5a56d276181d7fc9fa6b6d59525d1bf30817569dc20297ad29322e5daa02ad1  mocked-keychain-token.json
acaefcb44ef5893be912f3b4d10d5a1fb8ef4429abe85acd8ee185605b92462c  mocked-payment-retry-503.json
743f0c3c392ed5774ce11b7e6e76f55d88aebf4f0072d73d8ccccc07c65baf32  pos-admin-menu-hidden.json
98232d9184ecc04cc6f7d85f2b99c1e5c030b8e712d3cbf72102b97aa02674e2  pos-api-version-header.json
addc3cbb2a01027374bd92bbe104a422235e178744fa363296b2c505b57bc537  pos-chat-input-clear.json
1dd5b4c3940d54733757c208cf95dc881f82b2c800aee742007026c93f02ca09  pos-docs-etag-304.json
3b66427cb056fee7add2fd48d9b3fdda21f4e5bcda87a7b27bc9f37bf5dccd60  pos-leaderboard-sort.json
88fbaf90e5f92399e07dfce74310fbb3b2a14d9656f48ffc6ada3c13f6851a86  pos-migrate-dry-run.json
b7e2c9efa147fb0fd46a8e52ee703464b249992f0f9d675361c74af431e1543c  pos-shipping-estimate.json
279ea7dbeca33404b4d96ba314d739df07dc22b0b61cae6074884ffa84b6398a  pos-version-flag.json
c1508b62865e0d509e920832360df0f912004aa1be9974fa704a3b1be55aea4d  renderonly-faq-expand.json
ddd7b20c5de839317cee42df4273ea1be743e99b4a168671b9937bbdd3c5306e  renderonly-kanban-drag-done.json
afbe7c799256855731881745515f4864630e8f3f2caccd8824c438a386776829  renderonly-logout-invalidate.json
cd5fa74e02b1c1fdebc7da3ad53c69c7a13f8b47a38a126165a071d5a36df819  renderonly-password-strength-meter.json
9862c49be5b4a49fe5cf3e70fd132434249a92d6119a5a16304d83aeae846c53  renderonly-sidebar-collapse-persist.json
858743a075423f5a5bb9078e459f889e5b99931f97c56466a90b1ba7240a24e8  renderonly-watch-refresh.json
77d19c28b0d323b1adf0a8682b85798a5221d2c8055904f7cbc29295a5c3b369  skipped-audit-log-cursor.json
aa0cddae1a4e5ffa82067d7e88b9f10de6c6cff3c6d948ef8b91f2a4672c7d4a  skipped-branch-delete-confirm.json
aa73cc0d9c3f17fa1bbb29f9ea273cc436c0ad42bfc446ea3e18b5115b9c638b  skipped-dropdown-outside-click.json
ba4ae1752aa9e5b24e24095e75d5d3d8d62ab0e5f663f5fc15c4ae6f92341e12  skipped-lockfile-exit-3.json
eaefe4c1307d4dbb6c5f74b45476d03a55bcb875672f82800dd6de71552dfe12  skipped-terms-checkbox-pay.json
ee8688f2a5e5c7c5c8498cebc4fe47db80717928ad06dc116bab5df19418aef2  skipped-workspace-duplicate-slug.json
4a4152504c01f25c1db3b54750d93955ce0326804afdd08950377be2e1d50314  wrongtarget-balance-no-store.json
0a91fce5a24241211fe223b6e51d55e84e883bf4ca83952d7c1d2d5e424529d4  wrongtarget-build-elapsed-time.json
d8a98f23c909164a248dbc54fe489b9191f6ee3b5ba07c0daa20fcff8c7fbd8b  wrongtarget-discount-badge.json
87ad841a4fee4ed8b5d4edeff989384584afd5d2355afdde7147c593954967a8  wrongtarget-no-color-env.json
8e6c5a57da1a8e1effbc1c762dbce1ea63d31ee8a1ce8f0808a9c5d1d9c024d0  wrongtarget-settings-active-tab.json
f8b255f2f5f33499d6de6f6c5beb041c361b71a9c86298784a13d68aff8bffa7  wrongtarget-total-count-header.json
```

### Method

- Run `node packages/ce/dist/cli.js eval --fixtures fixtures/eval-boundary` live 3 times with the default settings.
- For every repeat, the analysis script (appendix) applies the built `combine` to the recorded `perClaim` scores for the 4 cells: baseline, A, B and 0.6/skip, all at band 0.1. It is the same mechanism as the validated held-out sweep. The script was smoke-tested on synthetic scores only, before any live run.
- Record the build commit, model id and fixture count of each repeat.

### Decision rule

1. **False skip.** A negative that a cell predicts `required=false` in a given repeat. Each repeat's own decision counts.
2. **Pass condition, over all 30 negatives.** A cell passes only if it has 0 false skips in every repeat.
   - **Any observed false skip, anywhere, is a fail.** This holds even when the zone below is under-populated.
   - Report the exact one-sided 95% upper bound for the worst repeat. For 0/30 that bound is 9.5%.
3. **Zone.** The decisive zone is the negatives whose **median CA over the 3 repeats** falls in (0.70, 0.80]. The zone only selects which negatives count toward `n_zone`.
   - Report the false skips in the zone and their upper bound separately.
   - If `n_zone` is below 8, the statement "no false skip in the zone" is **inconclusive**.
   - Inconclusive does not cancel an observed false skip under rule 2.
   - For reference, 0/8 gives an upper bound of 31.2%.
4. **Histogram.** Report negatives and positives by median CA band: below 0.65, 0.65-0.70, (0.70, 0.80], (0.80, 0.85], above 0.85.
5. **Positives are the cost side only.** Report false-required counts per cell (n = 8). They do not change pass or fail, and no candidate is ranked on a difference of 1 or 2.
6. **Per pattern.** Report false skips per pattern with its surviving n. No per-pattern conclusion is drawn below n = 3.
7. **Wording.**
   - Do not call a cell "safe". Write "no false skip observed in n negatives; upper 95% bound X%".
   - Passing here is **necessary but not sufficient** for a default change. The default decision stays with the maintainer (D2) and also weighs the cost side and production evidence (shadow mode, audits).
8. **If inconclusive or failed,** the next step is a different fixture design or production evidence, **not** a default change. No fixture is edited or added after the run to change the result.

### Known limits

- One author wrote the fixtures. The blind labeller is a model and may share biases with Jev.
- The fixtures are synthetic and carry no description text. Real changes carry PR descriptions, so scores may shift by an unknown amount.
- CA cannot be steered by fixture design. Negatives may land below the zone, as the held-out negatives did.
- The results hold for one model snapshot only.
- Open follow-ups, deliberately out of scope:
  - Multi-claim changes. `anyNeeded` makes them test claim separation rather than the CA zone.
  - Claims with RO in 0.5-0.7. This is where A and B differ from each other.
  - Production evidence: shadow mode and random audits of SKIPPED.

## Results

Everything in this section was written after the boundary scores were visible. The pre-registration section above is unchanged since the freeze commit.

### Run identity

| Item | Repeat 1 | Repeat 2 | Repeat 3 |
| --- | --- | --- | --- |
| Source | `.ce/runs/eval-2026-11-26T12-35-30-280Z/eval.json` | `.ce/runs/eval-2026-11-26T12-36-33-477Z/eval.json` | `.ce/runs/eval-2026-11-26T12-37-34-115Z/eval.json` |
| Git commit | `7e732f7` (freeze commit) | `7e732f7` | `7e732f7` |
| Working tree | Clean | Clean | Clean |
| Provider | `openrouter` | `openrouter` | `openrouter` |
| Returned model id | `typesafe/jev-1.14-20261014` | `typesafe/jev-1.14-20261014` | `typesafe/jev-1.14-20261014` |
| Fixtures | 38 | 38 | 38 |
| Jev requests / memo hits | 76 / 76 | 76 / 76 | 76 / 76 |
| Exit code | 0 | 0 | 0 |

- `.ce/` is gitignored, so this document carries the numbers itself.
- `packages/ce/dist` was built from `packages/` source identical to `e7544d7`. No commit after it touches `packages/`.
- All runs used the default settings: `claimThreshold` 0.6, `observableThreshold` 0.6, `adequateThreshold` 0.7, `uncertaintyBand` 0.1, `onUncertain` evidence.

### Agreement by row (default settings)

| Row | Repeat 1 | Repeat 2 | Repeat 3 |
| --- | --- | --- | --- |
| `claim.is_behavior` | 38 / 38 | 38 / 38 | 38 / 38 |
| `assess.runtime_observable` | 37 / 38 | 36 / 38 | 37 / 38 |
| `assess.checks_adequate` | 36 / 38 | 36 / 38 | 36 / 38 |
| `assess.surface` | 37 / 38 | 37 / 38 | 37 / 38 |
| `assessment.required` | 35 / 38 | 35 / 38 | 35 / 38 |
| `assessment.claimStatus` | 38 / 38 | 38 / 38 | 38 / 38 |

### Median CA histogram

| Median CA band | Negatives | Positives |
| --- | --- | --- |
| below 0.65 | 29 | 1 |
| 0.65-0.70 | 0 | 0 |
| (0.70, 0.80] zone | 1 | 3 |
| (0.80, 0.85] | 0 | 1 |
| above 0.85 | 0 | 3 |

`n_zone` = 1. Under rule 3, the statement "no false skip in the zone" is **inconclusive** for every cell. Rule 2 still applies.

### Decision rule outcome

| Cell | False skips per repeat (30 negatives) | False required per repeat (8 positives) | Upper 95% bound, worst repeat | Rule 2 |
| --- | --- | --- | --- | --- |
| Baseline 0.7 / 0.1 / evidence | 0, 0, 0 | 3, 3, 3 | 9.5% (0 / 30) | pass |
| A 0.7 / 0.1 / skip | 2, 3, 2 | 1, 1, 1 | 23.9% (3 / 30) | **fail** |
| B 0.6 / 0.1 / evidence | 1, 1, 1 | 1, 1, 1 | 14.9% (1 / 30) | **fail** |
| 0.6 / 0.1 / skip | 2, 3, 2 | 0, 0, 0 | 23.9% (3 / 30) | **fail** |

**Result: all three candidates produce observed false skips. Under the pre-registered rule, none of them may replace the defaults. The baseline shows no false skip in 30 negatives (upper 95% bound 9.5%).** `packages/ce/src/config/defaults.ts` is not changed.

### The false skips

| Fixture | Pattern | RO (r1 / r2 / r3) | CA (r1 / r2 / r3) | Skipped by | Mechanism |
| --- | --- | --- | --- | --- | --- |
| `wrongtarget-no-color-env` | wrong target | 0.92 / 0.93 / 0.93 | 0.74 / 0.72 / 0.73 | A, B, 0.6/skip, every repeat | CA in (0.70, 0.80]: the predicted zone exposure |
| `mocked-payment-retry-503` | mocked | 0.55 / 0.57 / 0.55 | 0.09 / 0.08 / 0.08 | A, 0.6/skip, every repeat | RO in the band below 0.6, so not needed; uncertain, and skip drops it |
| `happypath-date-range-400` | happy path | 0.68 / 0.59 / 0.61 | 0.09 / 0.08 / 0.08 | A, 0.6/skip, repeat 2 only | RO 0.59 in repeat 2, the same mechanism |

The baseline requires evidence for all three:
- The first is decided by policy, because CA is inside the band.
- The second is decided by policy, because RO is inside the band.
- The third is classifier-decided where RO is at least 0.6, and policy-decided in repeat 2.

`wrongtarget-no-color-env` is the case the blind labeller flagged: its test would pass even without the change. It is the only negative that reached the zone, and every candidate skips it.

The two RO-band false skips come from the second exposure, which the pre-registration deferred (claims with RO 0.5 to 0.7). Their `assess.runtime_observable` predictions disagree with the label `true`. The baseline's `on-uncertain: evidence` is what catches them.

### Cost side (positives, n = 8)

Per rule 5, this does not change pass or fail.
- At the baseline, 3 of 8 positives are false required:
  - `pos-admin-menu-hidden` (CA 0.76 to 0.78) and `pos-api-version-header` (CA 0.78 to 0.79) fall inside the band, so policy requires evidence.
  - `pos-shipping-estimate` (CA 0.63 to 0.64) is a classifier miss below 0.7, so it is required under every cell except 0.6/skip.
- The candidates reduce false required to 0 or 1.

### What the scores show

- The hardest negative (CA 0.72 to 0.74) and the lowest in-band positives (CA 0.76 to 0.79) are 0.02 to 0.07 apart, and their ranges almost touch across repeats. No `adequateThreshold` separates them cleanly. The 0.1 band is what keeps such negatives from being skipped. Its price is the false-required positives at the baseline.
- 29 of 30 negatives scored below 0.65. Most patterns that look covered still score low, so the zone is rare in this design. It is not empty.
- Per pattern (n = 6 each), the worst-repeat false skips are:
  - wrong target: 1 (A, B and 0.6/skip)
  - mocked: 1 (A and 0.6/skip)
  - happy path: 1 (A and 0.6/skip)
  - render only: 0
  - skipped: 0

  With n = 6 per pattern, no per-pattern conclusion is drawn.

### Implication for issue #29

- **Keep the current defaults** (0.7 / 0.1 / evidence).
- The false-required results on covered changes, which motivated #29, are the cost of the protection shown above. That cost should not be removed through `adequateThreshold`, the band, or `on-uncertain`.
- Any future attempt to reduce it needs production evidence first: shadow mode and random audits of SKIPPED. It also needs a cheaper way to resolve the in-band cases than full evidence.
- Both remain open follow-ups, together with multi-claim changes.

### Verification

- The analysis script was smoke-tested on synthetic scores before the freeze. It reproduces the expected bounds: 0 / 30 gives 9.5%, and 0 / 7 gives 34.8%.
- `npm run typecheck` passes. `npm test` passes: 127 test files, 825 tests. No code changed.
- Diff against the freeze commit `7e732f7`: the only removed line is the "Pending" placeholder under Results. The fixtures and the pre-registration section are unchanged.
- This record contains no API key, Authorization header, request state text, or private repository text. It was scanned with the `SECRET_PATTERNS` list from `packages/ce/src/eval/fixtures.corpus.test.ts` and has no match.

## Appendix: analysis script

Run as `node boundary-analyze.mjs <repoRoot> <fixturesDir> <eval1.json> <eval2.json> <eval3.json>` after `npm run build`.

```js
// Boundary-set analysis for the #29 follow-up.
// Usage: node boundary-analyze.mjs <repoRoot> <fixturesDir> <eval1.json> <eval2.json> <eval3.json>
// Re-applies the built `combine` to each repeat's recorded perClaim scores for the 4 candidate cells.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, fixturesDir, ...evalPaths] = process.argv.slice(2);
const { combine } = await import(
  pathToFileURL(resolve(repoRoot, 'packages/ce/dist/assessment/combine.js')).href
);

const fixtures = Object.fromEntries(
  readdirSync(fixturesDir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      const f = JSON.parse(readFileSync(join(fixturesDir, n), 'utf8'));
      return [f.id, { required: f.labels.required, pattern: f.id.split('-')[0] }];
    }),
);
const runs = evalPaths.map((p) => JSON.parse(readFileSync(p, 'utf8')));

const CELLS = [
  { name: 'baseline 0.7/0.1/evidence', adequate: 0.7, policy: 'evidence' },
  { name: 'A 0.7/0.1/skip', adequate: 0.7, policy: 'skip' },
  { name: 'B 0.6/0.1/evidence', adequate: 0.6, policy: 'evidence' },
  { name: '0.6/0.1/skip', adequate: 0.6, policy: 'skip' },
];

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
/** Exact one-sided 95% Clopper-Pearson upper bound for k failures in n trials. */
function upper95(k, n) {
  if (n === 0) return 1;
  if (k >= n) return 1;
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

// Per-fixture scores across repeats (single-claim fixtures: perClaim[0]).
const ids = Object.keys(fixtures).sort();
const score = (run, id) => run.assessments.find((a) => a.fixtureId === id).perClaim[0];
const table = ids.map((id) => {
  const ca = runs.map((r) => score(r, id).checksAdequate);
  const ro = runs.map((r) => score(r, id).runtimeObservable);
  return { id, ...fixtures[id], ca, ro, caMed: median(ca), roMed: median(ro) };
});

console.log(`model ids: ${JSON.stringify(runs.map((r) => r.modelIds))}`);
console.log(`settings: ${JSON.stringify(runs.map((r) => r.settings))}\n`);

// CA histogram by median, per class.
const bands = [
  ['< 0.65', (x) => x < 0.65],
  ['0.65-0.70', (x) => x >= 0.65 && x <= 0.7],
  ['(0.70, 0.80] zone', (x) => x > 0.7 && x <= 0.8],
  ['(0.80, 0.85]', (x) => x > 0.8 && x <= 0.85],
  ['> 0.85', (x) => x > 0.85],
];
console.log('| median CA band | negatives | positives |');
console.log('| --- | --- | --- |');
for (const [label, f] of bands) {
  const neg = table.filter((t) => t.required && f(t.caMed)).length;
  const pos = table.filter((t) => !t.required && f(t.caMed)).length;
  console.log(`| ${label} | ${neg} | ${pos} |`);
}

const negatives = table.filter((t) => t.required);
const positives = table.filter((t) => !t.required);
const zoneNeg = negatives.filter((t) => t.caMed > 0.7 && t.caMed <= 0.8);
console.log(`\nnegatives n=${negatives.length}, in-zone negatives n_zone=${zoneNeg.length}, positives n=${positives.length}\n`);

console.log('| cell | false skips per repeat (all negatives) | false skips in zone per repeat | false required per repeat (positives) | upper 95% bound, all negatives | upper 95% bound, zone |');
console.log('| --- | --- | --- | --- | --- | --- |');
const details = [];
for (const cell of CELLS) {
  const settings = { observableThreshold: 0.6, adequateThreshold: cell.adequate, uncertaintyBand: 0.1, onUncertain: cell.policy };
  const perRepeat = runs.map((run) => {
    const req = Object.fromEntries(
      run.assessments.map((a) => [
        a.fixtureId,
        combine(
          a.perClaim.map((p) => ({
            claimId: p.claimId,
            runtimeObservable: p.runtimeObservable,
            checksAdequate: p.checksAdequate,
            surface: p.surface,
            surfaceConfidence: p.surfaceConfidence,
          })),
          settings,
        ).required,
      ]),
    );
    const fs = negatives.filter((t) => req[t.id] === false).map((t) => t.id);
    return {
      fs,
      fsZone: fs.filter((id) => zoneNeg.some((z) => z.id === id)),
      fr: positives.filter((t) => req[t.id] === true).map((t) => t.id),
    };
  });
  const maxFs = Math.max(...perRepeat.map((r) => r.fs.length));
  const maxFsZone = Math.max(...perRepeat.map((r) => r.fsZone.length));
  console.log(
    `| ${cell.name} | ${perRepeat.map((r) => r.fs.length).join(', ')} | ${perRepeat.map((r) => r.fsZone.length).join(', ')} | ${perRepeat.map((r) => r.fr.length).join(', ')} | ${pct(upper95(maxFs, negatives.length))} (worst repeat ${maxFs}/${negatives.length}) | ${pct(upper95(maxFsZone, zoneNeg.length))} (worst repeat ${maxFsZone}/${zoneNeg.length}) |`,
  );
  details.push({ cell: cell.name, perRepeat });
}

console.log('\nFalse-skip and false-required fixtures per cell and repeat:');
for (const d of details) {
  d.perRepeat.forEach((r, i) => {
    if (r.fs.length || r.fr.length) console.log(`- ${d.cell}, repeat ${i + 1}: false skips [${r.fs.join(', ')}]; false required [${r.fr.join(', ')}]`);
  });
}

console.log('\nPer pattern (negatives): n, false skips per cell (worst repeat)');
const patterns = [...new Set(negatives.map((t) => t.pattern))];
for (const p of patterns) {
  const members = negatives.filter((t) => t.pattern === p).map((t) => t.id);
  const worst = details.map((d) => `${d.cell}: ${Math.max(...d.perRepeat.map((r) => r.fs.filter((id) => members.includes(id)).length))}`);
  console.log(`- ${p} (n=${members.length}): ${worst.join('; ')}`);
}

console.log('\n| fixture | class | RO (r1/r2/r3) | CA (r1/r2/r3) | median CA |');
console.log('| --- | --- | --- | --- | --- |');
for (const t of table) {
  console.log(`| \`${t.id}\` | ${t.required ? 'negative' : 'positive'} | ${t.ro.join(' / ')} | ${t.ca.join(' / ')} | ${t.caMed} |`);
}
```
