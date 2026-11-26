# Assessment calibration: precision pilot on troupe

Tracking issue: [#29](https://github.com/rfxlamia/ce/issues/29). Follow-up to [`eval-calibration-troupe.md`](eval-calibration-troupe.md), which found that CE flags about 85% of all claims on real pull requests and that every one of them ended `EVIDENCED`, so it could not show that CE discriminates.

This record is a **pilot**: one repeat, 30 pull requests from one repository, on **cleaned input**. Its results are directional. It changes no default. Per Decision D2, any change to a threshold, band or policy needs maintainer agreement.

## Pre-registration

This section was written and committed before the live `ce eval` run on this set. It must not be edited after any score is visible. Later sections are added below it.

### Question

On real pull requests that did not later need a regression fix, how often does CE, at the shipped defaults (0.7 / band 0.1 / evidence), end `SKIPPED`, and what share of their claims does it flag?

- **Layer 1:** pull requests that change only documentation, CI workflows or lockfiles. No app runtime behavior changes, so the expected outcome is `SKIPPED` or no claim. This is the only layer with a clean ground truth.
- **Layer 2:** pull requests that change app source. "No regression reported within 4 weeks" is weak ground truth: it does not mean that no evidence was needed. Layer 2 is therefore reported **descriptively**, never as a precision figure.

### Extractor

The run uses the extractor with Decision D32 (unchecked task-list items are not candidates), from [#37](https://github.com/rfxlamia/ce/pull/37). This branch is stacked on it. The troupe record used the extractor before D32, so comparisons with it are descriptive and not attributable to any single cause.

### Selection

Deterministic, seed 29, from the 1464 merged troupe pull requests:

1. **Eligible:** merged on or before 2026-10-29 (at least 4 weeks before 2026-11-26), and not authored by a bot. Excluded: the cause and fix pull requests of the troupe record, and any pull request that another merged pull request names as `#N` next to fix, regress, revert, broke or hotfix wording. Only numbers that resolve to a pull request count, not issue numbers. Result: 946 eligible.
2. **Prefilter:** at most 20 prose candidates from the title and the cleaned description. 347 passed.
3. **Seeded order:** a mulberry32 shuffle with seed 29. Pull requests were fetched in that order until both quotas were full (105 fetched). Each was converted and kept only if its fixture has between 1 and 20 unique candidates under the production `buildFixtureContext`. Skipped while fetching:
   - 55 for candidate count;
   - 17 for matching neither layer;
   - 2 for having more than 100 files;
   - 1 because its layer's quota was full.
4. **Layers by changed paths:**
   - **L1:** every path is under `docs/`, `website-docs/` or `.github/`, ends in `.md` or `.mdx`, or is a lockfile.
   - **L2:** some path is under `src/` or `src-tauri/src/`.

   Quotas are 10 for L1 and 20 for L2. If a pool is short, all of it is taken and n is reported. Both quotas were filled.

   A first draft counted any `src-tauri/` path as L2. That rule put mostly version bumps into L2, so it was tightened to source paths before any score existed.

5. **L2 split, reported side by side**, by the conventional-commit prefix of the title:
   - "change": `fix`, `feat`, `refactor`, `test`, `perf`;
   - "chore": everything else, mostly release and registry-sync pull requests.

### Cleaning and privacy

The cleaning step was fixed before selection, and the selection script tests it on every run. It applies to descriptions and commit messages and drops:

- checked task-list items (`- [x] ...`) together with their continuation lines;
- image-only lines;
- link-only lines;
- URL-only lines.

The privacy transform is the same as in the troupe record. A scan with the corpus `SECRET_PATTERNS`, an e-mail pattern and a personal-name pattern found 0 matches.

**Cleaning changes what CE sees**, so these results describe CE on cleaned input, not CE on raw troupe pull requests. Before and after counts are in the table below. The sum is 574 raw candidates and 355 cleaned; L1 went from 204 to 106 and L2 from 370 to 249.

| fixture | layer | L2 kind | merged | files | candidates raw → cleaned | title |
| --- | --- | --- | --- | --- | --- | --- |
| `precision-84` | L1 |  | 2026-04-26 | 1 | 6 → 6 | ci: remove macos build targets from release workflow |
| `precision-819` | L1 |  | 2026-10-03 | 2 | 27 → 17 | docs: codify split and slim conventions from october refactor campaign |
| `precision-1417` | L1 |  | 2026-10-19 | 1 | 28 → 17 | chore: update CHANGELOG for v0.4.52 |
| `precision-570` | L1 |  | 2026-08-08 | 1 | 31 → 18 | fix(release): drop --target from termul-server build so binary lands at target/release/ |
| `precision-575` | L1 |  | 2026-08-08 | 1 | 24 → 7 | fix(release): publish_release reads server artifact at root |
| `precision-567` | L1 |  | 2026-08-08 | 1 | 26 → 9 | fix(release): gate macOS preflight + codesign verify via env.APPLE_CERTIFICATE |
| `precision-85` | L1 |  | 2026-04-26 | 1 | 5 → 5 | Merge dev into main |
| `precision-566` | L1 |  | 2026-08-08 | 1 | 26 → 13 | fix(release): gate macOS preflight + codesign verify via env.APPLE_CERTIFICATE |
| `precision-283` | L1 |  | 2026-06-04 | 2 | 7 → 7 | chore(github): require contributor intent on issue forms |
| `precision-571` | L1 |  | 2026-08-08 | 1 | 24 → 7 | fix(release): drop --target from termul-server build so binary lands at target/release/ |
| `precision-166` | L2 | chore | 2026-05-27 | 19 | 25 → 19 | chore: migrate package workflow to bun |
| `precision-786` | L2 | change | 2026-10-02 | 25 | 24 → 15 | refactor(renderer): remove never-imported ui primitives (-2,763 LOC) |
| `precision-599` | L2 | chore | 2026-08-10 | 1 | 29 → 17 | chore(acp): sync bundled ACP registry snapshot |
| `precision-241` | L2 | change | 2026-06-02 | 2 | 16 → 9 | fix(terminal): clear sidebar activity indicator on tab unmount (#218) |
| `precision-335` | L2 | change | 2026-06-17 | 1 | 15 → 9 | fix(ui): align Explorer sidebar header typography with Projects |
| `precision-904` | L2 | chore | 2026-10-05 | 5 | 27 → 16 | chore: release v0.4.20 |
| `precision-565` | L2 | chore | 2026-08-08 | 5 | 25 → 8 | chore: release v0.4.10 |
| `precision-453` | L2 | chore | 2026-07-28 | 1 | 22 → 13 | chore(acp): refresh bundled registry snapshot |
| `precision-564` | L2 | chore | 2026-08-08 | 5 | 22 → 10 | chore: release v0.4.10 |
| `precision-560` | L2 | chore | 2026-08-08 | 5 | 18 → 7 | chore: release v0.4.9 |
| `precision-260` | L2 | chore | 2026-06-03 | 5 | 4 → 4 | chore: release v0.4.2 |
| `precision-94` | L2 | chore | 2026-05-01 | 7 | 15 → 15 | chore: merge dev with updater recovery fix into main |
| `precision-172` | L2 | change | 2026-05-28 | 1 | 18 → 18 | fix(terminal): xterm canvas overflows right-side padding |
| `precision-240` | L2 | change | 2026-06-02 | 1 | 17 → 12 | fix(git): replace Git sidebar status letters with icons (#215) |
| `precision-1384` | L2 | change | 2026-10-18 | 1 | 22 → 14 | test(chat): wait for the queue panel's expand before asserting visibility |
| `precision-278` | L2 | change | 2026-06-04 | 2 | 23 → 15 | fix(terminal): trap Tab focus navigation for Shift+Tab passthrough |
| `precision-318` | L2 | chore | 2026-06-06 | 5 | 4 → 4 | chore: release v0.4.5 |
| `precision-89` | L2 | change | 2026-04-28 | 7 | 19 → 19 | feat: add AUR update support |
| `precision-118` | L2 | change | 2026-05-08 | 2 | 12 → 12 | feat: add close button to AppPreferences and ProjectSettings headers |
| `precision-176` | L2 | change | 2026-05-28 | 2 | 13 → 13 | feat: add middle-click close for terminal and browser tabs |

### Labels

These labels are schema filler. Every candidate has `isBehavior` false, every fixture has `required` false, and `claimStatus` is identified. The labels feed no reported number. The agreement rows that `ce eval` prints are not results.

### Run protocol

- Shipped defaults, no `--config`. One `ce eval` process per fixture, with Layer 1 first. One repeat.
- **Spending ceiling:** the runner stops before the next fixture once billed requests reach 900, which is about $0.22. The stub smoke run used 473 requests for 29 fixtures.
- A fixture that errors or is not run is excluded and listed, and it is never retried.
- Analysis is done with [`precision-analyze.mjs`](#appendix-precision-analyzemjs). It recomputes `combine` from each `perClaim` and must reproduce every `required` and `decidedBy`.

### Metrics and reading

For each layer and each L2 kind, the analysis reports:

- the `SKIPPED` count with an exact two-sided 95% Clopper-Pearson interval;
- claims over candidates;
- the pooled share of flagged claims (`needed` or `uncertain`);
- the median per-PR flagged fraction, because claims cluster within a pull request.

For every `EVIDENCED` fixture it also shows the claims that drove the outcome, with RO and CA. That separates three kinds of driver:
- the claim stage (a non-behavior sentence that became a claim);
- RO;
- CA.

How the results will be read:

- **L1:** each `EVIDENCED` is a false required. If **3 or more of 10** are `EVIDENCED`, CE has a precision problem even on documentation and CI changes, and the record names the driving stage for each.
- **L2:** if fewer than 15 fixtures complete, L2 is inconclusive. Otherwise it is descriptive. If L2 has **0 `SKIPPED`** and a pooled flagged share of **75% or more**, the finding is worded exactly as: "on these pull requests CE flags nearly every claim it is asked about". It is never worded as "CE does not discriminate", because the ground truth cannot carry that. The next step would then be to examine why `checksAdequate` is low on real changes, for example because CE sees only check names and not test content. Thresholds are not that next step.
- **Run-to-run variation is not measured,** because there is one repeat. The troupe record saw single fixtures flip between repeats, so no single fixture outcome is read as stable.

### Known limits

- Cleaned input is not production input.
- The 20-candidate filter biases the sample toward small pull requests.
- "No reported regression" is not "no evidence needed".
- One repository, one model, one repeat.
- Most L1 pull requests change release workflows, which run on CI rather than in the app.
- Several L1 and L2 pull requests are near-duplicates from the same day (`566` and `567`, `570` and `571`, `564` and `565`).
- All pull requests merged before the model date (2026-10-14) except `1384` and `1417`, so contamination is possible.

### Fixture hashes (SHA-256)

```
013ad0e672b2322326e54a1a02a92d50d3ed43db15661436aef4243d702e700c  precision-84.json
f71b927aaefe729950ef391336f9b92240751a2bae385323585fd98f4d49087c  precision-85.json
5d88dfb3aea063b69942ff618174862b8e06fcfea818a44ef919a4ed42ab2bc3  precision-89.json
8808fe74b81fa84b3168f07b25a52667ce92a27ae47ed6de136637d3009b469d  precision-94.json
9354e693fa3396a4b7eaba19d6eaacd5773f3f1260df892eaf6432999a8e9f30  precision-118.json
caf4869b584430121ffa119728e371a44f96e071b7fb700fb55979f99dfd7b78  precision-166.json
9891120f7344a4520e5dda4bdd7190f9b8865aaf11a26eedcf174fcba4f97559  precision-172.json
8dd2b0cc6dfb746a62fe48b1cdee87341febad11f991156d9c1b8ee956f3a0bb  precision-176.json
f2e9d619b098faa4be9cfac1e41c5a31cb65fdebe2d9b83e2d375565af2b2e47  precision-240.json
d3c46decda9a5ec34249a77d72480c549d96db77cf3c5e93492bb97d1cde7fda  precision-241.json
581baddf7beb5ae5b847ff2d6bb2129a6491dbdb4d5654e445ec93484794885b  precision-260.json
da1830861d44f38f4a66b2390803f2709ab006f31827833f1cf146759c1af965  precision-278.json
c585bba55d64d95880c8795cbe047d7589aac5ef3d644395225d66f371c3c006  precision-283.json
80be21ee09453b6f4aa1c7b12eb85ae1ba533bbb2b27927f39506055c984ec02  precision-318.json
14924e02be3e2a5dc58e1499fb7cf6dfd8410a86515cd45d1573a73759f85940  precision-335.json
b00dd8dd550667bed4e26b1f563342c089e7d0f6ce256b8cd12dd5c4b7ee002e  precision-453.json
49b0542cee3bcfb23451f4a9bd0b3f7ec7765d3fb7a252f11bd20d96b014a714  precision-560.json
7fd92e7573112e350b0dd1c1276b28b6280edcbe0b13c129c2b203c487b0a56d  precision-564.json
73e7b0eeb297d3d8dd5666be7f4896eef84310f59d60cfacdf3106778584234a  precision-565.json
8ea6a45fb48b4852c361686df4fa2bce29064b51227fd52472f88fe51a2273f5  precision-566.json
259781baa508a36b899d9347a8ef1b3fa2401f2baa2484e6d4ce235c9c2beb2f  precision-567.json
d7f4386a5c2a3c15a40c65f6881153d3bf0280f178f1834f82e96801f8e529e4  precision-570.json
9ab7e8d745d03eb3d777ac72ff8cfc69032ea62103db14a01b6ead23b0678785  precision-571.json
d4ce019ee86f041b6276e0fe1f930a175e6e0b2912e3a126d083d64a4d8be1cc  precision-575.json
bfa4a94692f62a4a1a5ee2267b1177b044ab4f31b020bcb856b9706311fefdb7  precision-599.json
6e5b9122b43c25f38d8c9435d0e58ab34d054155677c458fbf01520b39cd9428  precision-786.json
117d7b80293a1eee60f8fc15fdcf2d83b8d5768bda7fccc8e04835ab0b3e19a6  precision-819.json
d215c1c8b8973150580ca2b723ea236f115dbcda3e859cebd22a9c7fc4b507b6  precision-904.json
c4eb814eaa2f9f195c4b4dfd79896cdf75f11ba4da2c09cfe024465705daa6e1  precision-1384.json
2ce86c2e24acb99411d433d84e9fee2a1fd40b82b2ad73d0f4870693aca96019  precision-1417.json
```

The selection, run and analysis scripts were smoke-tested before this freeze. A stub gateway with no network reproduced `combine` on 29 of 29 fixtures and listed the one fixture it left unrun. The seeded order was also reproduced twice.

## Results

Added after the live run. The pre-registration above is unchanged.

### Run

- 2026-11-26, one repeat, shipped defaults: claim 0.6, observable 0.6, adequate 0.7, band 0.1, `onUncertain` evidence. Model `typesafe/jev-1.14-20261014`.
- 30 of 30 fixtures completed. None errored, none was left unrun.
- 468 billed requests, below the ceiling of 900.
- The analyzer reproduced `required` and `decidedBy` from `perClaim` on 30 of 30 fixtures.

### Analyzer correction

When no claim is identified, CE asks the assessment questions about one Change_Subject instead (claims-assessment-eval, Requirement 3). Its id is `change`, not a candidate id. The pre-registered analyzer maps `perClaim` entries to candidate text by id. It therefore printed an empty text for the Change_Subject and counted it in its "claims" and "flagged claims" columns.

The table below counts claims and Change_Subjects separately. The Change_Subject text is the first non-blank line of the title, so in every fixture here it is the pull request title. No reported outcome changes: `SKIPPED` counts and drivers come from the same records.

| layer | n | `SKIPPED` | 95% CI | flagged claims | flagged Change_Subjects |
| --- | --- | --- | --- | --- | --- |
| L1 | 10 | 10/10 | 69.2% to 100.0% | 0/2 | 0/9 |
| L2 | 20 | 1/20 | 0.1% to 24.9% | 90/93 (96.8%) | 8/9 |
| L2 change | 10 | 1/10 | 0.3% to 44.5% | 82/85 (96.5%) | 0/1 |
| L2 chore | 10 | 0/10 | 0.0% to 30.8% | 8/8 | 8/8 |

"Flagged" means `needed` or `uncertain`. The median per-PR flagged fraction is 0% in L1 and 100% in L2, whether or not Change_Subjects are counted.

### Reading, as pre-registered

- **L1:** 0 of 10 `EVIDENCED`, below the threshold of 3. **No precision problem on documentation and CI changes in this set.** 9 of 10 had no claim. The one with claims (`precision-566`, 2 claims) flagged neither.
- **L2:** 20 of 20 completed, so L2 is not inconclusive; it is reported descriptively. The pre-registered wording needs 0 `SKIPPED`. L2 has 1 (`precision-786`, a dead-code removal with no claim), so **the condition is not met and the wording is not used.** The numbers stand on their own: 19 of 20 `EVIDENCED`, 90 of 93 claims flagged, median 100% per pull request.
- **Variation:** not measured. No single fixture outcome is read as stable.

### Drivers of `EVIDENCED` in L2

1. **Claims (11 fixtures: the 9 `EVIDENCED` change pull requests, plus `564` and `94` in chore).** 83 of the 93 L2 claims were `needed`. Their RO ranges 0.60 to 0.94 (median 0.84) and their CA ranges 0.06 to 0.69 (median 0.18). This is the pattern the pre-registration named, so the next step is to examine why `checksAdequate` is low on real changes. One candidate cause: CE sees only check names, not test content.

   One exception. In `precision-176` the pull request adds regression tests in the same diff, and 6 of its 7 claims got CA 0.70 to 0.81, so none of the six was `needed`. 4 of them fell within the band around 0.7 and were `uncertain`; the other 2 were above the band and were not flagged. CA does respond to tests that are visible in the diff.
2. **Change_Subject (8 fixtures).** 8 of the 9 L2 fixtures with no claim ended `EVIDENCED` through the Change_Subject alone:
   - 5 release pull requests (`260`, `318`, `560`, `565`, `904`, title "chore: release vX") were `needed`, RO 0.80 to 0.84, CA 0.15 to 0.23. In all five, the diff changes the version string shown in `src/renderer/components/ProjectSidebar.tsx` (checked on each fixture), and no check covers it, so `needed` matches CE's definition. Whether a version bump should ask for evidence is a product question, not a result of this record.
   - 1 registry snapshot sync (`599`) was `needed`, RO 0.62.
   - 2 were `uncertain` and became `EVIDENCED` by the policy:
     - `453` (registry snapshot): RO 0.55 is in the band around 0.6 and CA is 0.16, so a small change in RO would make it `needed`.
     - `166` (bun workflow migration): RO 0.28 and CA 0.61. CA is in the band around 0.7, but with RO at 0.28 `needed` is false for any CA value, so that band hit cannot change `needed`. The claim-level case of `precision-1384` (RO 0.30, CA 0.75) has the same shape. This follows Decision D4 and Requirement 6.3 of claims-assessment-eval as written: either probability in its band counts.
3. **Claim stage.** Some lines that are not behavior statements became claims, for example "**New Features**" in `precision-89` (`needed`, RO 0.85) and "Closes #334" in `precision-335` (`uncertain`). In both fixtures other claims were also `needed`, so these did not decide the outcome. They were not counted systematically.

### Comparison with the troupe record (descriptive)

In the troupe record, non-regression claims were caught 84.1% to 85.8% of the time. Here, 96.8% of L2 claims are flagged. The extractor (D32), the cleaning and the sample differ, so the difference is not attributed to any cause.

### Settings recompute (not pre-registered)

Issue #29 asks about two settings: adequate 0.6 vs 0.7, and `onUncertain` evidence vs skip. `combine` is pure, so every outcome can be recomputed from the stored `perClaim` probabilities without new requests.

The recompute uses this record and the 54 completed troupe runs. At the shipped settings it reproduces every stored `required`, and it reproduces the troupe record's C1 counts. In the troupe columns, a regression claim counts only if its `claim.is_behavior` probability is at least 0.6, as in that record.

The last row is a variant that is not in the spec. Under it, a band hit counts as `uncertain` only when it could change `needed`:
- RO is in its band and CA is below 0.8; or
- CA is in its band and RO is at least 0.5.

| setting | L1 `SKIPPED` | L2 `SKIPPED` (change / chore) | L2 flagged Subjects | troupe C1 regression claim caught (r1 / r2 / r3) | troupe pull requests `required` |
| --- | --- | --- | --- | --- | --- |
| 0.7, evidence (shipped) | 10/10 | 1/20 (1 / 0) | 98/102 | 14/16, 14/16, 8/9 | 54/54 |
| 0.6, evidence | 10/10 | 1/20 (1 / 0) | 94/102 | 13/16, 14/16, 8/9 | 54/54 |
| 0.7, skip | 10/10 | 3/20 (1 / 2) | 89/102 | 12/16, 13/16, 8/9 | 54/54 |
| 0.6, skip | 10/10 | 4/20 (2 / 2) | 77/102 | 10/16, 11/16, 8/9 | 49/54 |
| 0.7, evidence, band only where it can change `needed` | 10/10 | 2/20 (1 / 1) | 96/102 | 14/16, 14/16, 8/9 | 54/54 |

How to read it:

- No alternative setting skips more than 4 of the 20 L2 pull requests.
- Every alternative from issue #29 loses troupe regression claims that the shipped setting catches.
- The band variant changes one outcome in either set, `precision-166`, and loses no troupe catch.

### Conclusion

No change to any default (Decision D2).

- At the shipped defaults, CE stays quiet on documentation and CI pull requests (10 of 10 `SKIPPED`).
- On app-source pull requests it asks for evidence on almost every claim.
- None of the settings in issue #29 changes that much on this set. Each one costs troupe recall. Among the `needed` claims, the median CA is 0.18, far from either adequate threshold.
- The open question is what `checksAdequate` sees.

Follow-ups, none of them blocking:

1. Investigate why `checksAdequate` is low on real changes. Start from what an Assessment_Request carries about checks: names and statuses only.
2. Maintainer question, a spec change to Requirement 3 of claims-assessment-eval: should the Change_Subject path make release and registry-sync pull requests `EVIDENCED`?
3. Maintainer question, a spec change to Decision D4 and Requirement 6.3: count a band hit only when it could change `needed`. On this data the gain is one pull request (`precision-166`) and nothing is lost.
4. Claim-stage false positives on header-like lines, such as bold-only lines and `Closes #N`.
5. Eval tooling: the `ce eval` output carries no Subject text, so an analysis has to rebuild it. The analyzer correction above came from that.

## Appendix: precision-select.mjs

```js
// Precision pilot (#29): seeded selection of concise, non-regressed troupe PRs, mechanical cleaning, and conversion.
// Usage: node precision-select.mjs <repoRoot> <troupeDir> <outDir> [--dry]
// <troupeDir> holds merged.json, authors.json, pairs-raw.json. Fetched PR data is cached in <troupeDir>/praw/.
// Conversion reuses the #36 privacy transform and status/conclusion maps (copied from troupe-convert.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, T, outDir, flag] = process.argv.slice(2);
const DRY = flag === '--dry';
const dist = (p) => import(pathToFileURL(resolve(repoRoot, 'packages/ce/dist', p)).href);
const { buildFixtureContext } = await dist('eval/providers.js');
const { ConfigDefaults } = await dist('config/defaults.js');
const { splitProse } = await dist('context/candidates.js');

// ---- pre-registered constants ----
export const SEED = 29;
export const CUTOFF = '2026-10-29T23:59:59Z'; // >= 4 weeks before 2026-11-26
export const MAX_CANDIDATES = 20;
export const QUOTA = { L1: 10, L2: 20 };
export const MAX_FETCH = 250;
const REPO = 'gnoviawan/troupe';

// ---- privacy transform (#36) ----
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;
const TRAILER = /^\s*(co-authored-by|signed-off-by|reviewed-by|reported-by):.*$/gim;
const MENTION = /(^|[\s(])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\b/g;
const scrubProse = (t) =>
  (t ?? '').replace(TRAILER, '').replace(EMAIL, '<email>').replace(MENTION, '$1@<user>').replace(/\n{3,}/g, '\n\n').trim();
const scrubPatch = (t) => (t ?? '').replace(EMAIL, '<email>');
const STATUS = { added: 'added', modified: 'modified', removed: 'deleted', renamed: 'renamed', copied: 'added', changed: 'modified', unchanged: 'modified' };
const CONCLUSION = { success: 'passed', failure: 'failed', timed_out: 'failed', action_required: 'failed', startup_failure: 'failed' };

// ---- pre-registered mechanical cleaning ----
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+/;
const CHECKED = /^\s*(?:[-*+]|\d+\.)\s+\[[xX]\](?:\s|$)/;
const IMAGE_ONLY = /^\s*(?:!\[[^\]]*\]\([^)]*\)\s*)+$/;
const LINK_ONLY = /^\s*(?:[-*+]\s+)?\[[^\]]*\]\([^)]*\)\s*$/;
const URL_ONLY = /^\s*(?:[-*+]\s+)?<?https?:\/\/\S+>?\s*$/;
const BREAK = /^\s*(?:$|#{1,6}(?:\s|$)|\||```|~~~|<!--)/;
/** Drops image-only, link-only and URL-only lines, and checked task-list items with their continuation lines. */
export function clean(text) {
  const out = [];
  let dropping = false;
  for (const line of (text ?? '').split('\n')) {
    if (CHECKED.test(line)) { dropping = true; continue; }
    if (dropping && !BREAK.test(line) && !LIST_ITEM.test(line)) continue;
    dropping = false;
    if (IMAGE_ONLY.test(line) || LINK_ONLY.test(line) || URL_ONLY.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

// ---- layers ----
const DOCS = /^(docs\/|website-docs\/|\.github\/)|\.(md|mdx)$|(^|\/)(package-lock\.json|bun\.lockb?|Cargo\.lock|pnpm-lock\.yaml|yarn\.lock)$/;
const CODE = /^(src\/|src-tauri\/src\/)/;
export const layerOf = (paths) => (paths.length && paths.every((p) => DOCS.test(p)) ? 'L1' : paths.some((p) => CODE.test(p)) ? 'L2' : null);

// ---- seeded shuffle (mulberry32) ----
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(xs, seed) {
  const r = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- self-test of the cleaner (runs every time) ----
{
  const cases = [
    ['- [x] Ran tests\n  wrapped\nlazy', ''],
    ['- [x] Ran tests\n  wrapped\n\nKeep.', '\nKeep.'],
    ['![shot](https://x/y.png)\nKeep.', 'Keep.'],
    ['[docs](https://x)\n- https://x/y\nKeep.', 'Keep.'],
    ['- [x] a\n- Item stays.', '- Item stays.'],
    ['- [x] a\n\nPara.', '\nPara.'],
    ['Use [x] in text. See ![i](u) inline.', 'Use [x] in text. See ![i](u) inline.'],
  ];
  for (const [i, o] of cases) if (clean(i) !== o) throw new Error(`clean self-test failed: ${JSON.stringify(i)} -> ${JSON.stringify(clean(i))}`);
  const s1 = shuffle([1, 2, 3, 4, 5, 6], SEED).join();
  if (s1 !== shuffle([1, 2, 3, 4, 5, 6], SEED).join()) throw new Error('shuffle not reproducible');
}

// ---- eligibility ----
const merged = JSON.parse(readFileSync(join(T, 'merged.json'), 'utf8'));
const authors = Object.fromEntries(JSON.parse(readFileSync(join(T, 'authors.json'), 'utf8')).map((a) => [a.number, a.author?.login ?? '']));
const pairs = JSON.parse(readFileSync(join(T, 'pairs-raw.json'), 'utf8'));
const numbers = new Set(merged.map((m) => m.number));
const excluded = new Set(pairs.flatMap((p) => [p.fix, ...p.refs]));
const REF = /\b(?:fix(?:es|ed)?|regress(?:ion|ed|es)?|revert(?:s|ed)?|broke|broken|hotfix)\b[^\n#]{0,80}#(\d+)/gi;
for (const m of merged) {
  for (const t of [m.title, m.body ?? '']) {
    for (const x of t.matchAll(REF)) {
      const n = Number(x[1]);
      if (numbers.has(n) && n !== m.number) excluded.add(n); // only PR numbers, not issues
    }
  }
}
const isBot = (l) => /\[bot\]$|bot$|^app\//i.test(l);
const proseCount = (m) => new Set([...splitProse(m.title), ...splitProse(clean(m.body))]).size;
const eligible = merged.filter((m) => m.mergedAt <= CUTOFF && !excluded.has(m.number) && !isBot(authors[m.number] ?? ''));
const prefiltered = eligible.filter((m) => proseCount(m) <= MAX_CANDIDATES);
const order = shuffle(prefiltered.map((m) => m.number).sort((a, b) => a - b), SEED);

const stats = { merged: merged.length, excludedRefs: excluded.size, eligible: eligible.length, prefiltered: prefiltered.length };
console.log(stats);
if (DRY) {
  console.log('first 10 in seeded order:', order.slice(0, 10).join(', '));
  process.exit(0);
}

// ---- fetch + convert ----
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const P = join(T, 'praw');
mkdirSync(P, { recursive: true });
mkdirSync(outDir, { recursive: true });
function fetchPr(n) {
  const f = join(P, `${n}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const pr = gh(['pr', 'view', String(n), '-R', REPO, '--json', 'additions,body,changedFiles,deletions,headRefOid,mergedAt,number,title,url']);
  const files = pr.changedFiles > 100 ? null : gh(['api', `repos/${REPO}/pulls/${n}/files?per_page=100`]);
  const commits = gh(['api', `repos/${REPO}/pulls/${n}/commits?per_page=100`, '--jq', '[.[]|{message:.commit.message,sha}]']);
  const checks = gh(['api', `repos/${REPO}/commits/${pr.headRefOid}/check-runs?per_page=100`, '--jq', '[.check_runs[]|{app:.app.slug,conclusion,name,status}]']);
  const raw = { pr, files, commits, checks };
  writeFileSync(f, JSON.stringify(raw));
  return raw;
}

const picked = { L1: [], L2: [] };
const log = [];
let fetched = 0;
for (const n of order) {
  if (picked.L1.length >= QUOTA.L1 && picked.L2.length >= QUOTA.L2) break;
  if (fetched >= MAX_FETCH) break;
  fetched += 1;
  const { pr, files, commits, checks } = fetchPr(n);
  if (!files) { log.push({ n, skip: 'over 100 files' }); continue; }
  const layer = layerOf(files.map((f) => f.filename));
  if (!layer) { log.push({ n, skip: 'neither layer' }); continue; }
  if (picked[layer].length >= QUOTA[layer]) { log.push({ n, layer, skip: 'quota full' }); continue; }
  const id = `precision-${n}`;
  const fixture = {
    id,
    description: `Real change: ${pr.url} at head ${pr.headRefOid}, merged ${pr.mergedAt}. No later PR references it as fixed or reverted. Layer ${layer}. Cleaned input. MIT, see NOTICE.`,
    change: {
      title: pr.title,
      description: scrubProse(clean(pr.body)),
      commits: commits.map((c) => ({ sha: c.sha.slice(0, 7), message: scrubProse(clean(c.message)) })),
      files: files.map((f) => ({ path: f.filename, status: STATUS[f.status] ?? 'modified', patch: scrubPatch(f.patch) })),
    },
    checks: checks.filter((c) => c.app === 'github-actions').map((c) => ({ name: c.name, status: CONCLUSION[c.conclusion] ?? 'skipped' })),
    labels: { isBehavior: {}, runtimeObservable: {}, checksAdequate: {}, surface: {}, claimStatus: 'identified', required: false },
  };
  const ctx = buildFixtureContext(fixture, { config: ConfigDefaults, env: {} }).context;
  const texts = [...new Set(ctx.candidates.filter((c) => c.provenance.provider !== 'cli').map((c) => c.text))];
  // Uncleaned count, for the cleaning-effect report.
  const rawFixture = { ...fixture, change: { ...fixture.change, description: scrubProse(pr.body), commits: commits.map((c) => ({ sha: c.sha.slice(0, 7), message: scrubProse(c.message) })) } };
  const rawCount = new Set(buildFixtureContext(rawFixture, { config: ConfigDefaults, env: {} }).context.candidates.map((c) => c.text)).size;
  if (texts.length > MAX_CANDIDATES || texts.length === 0) { log.push({ n, layer, skip: `candidates ${texts.length}` }); continue; }
  for (const t of texts) fixture.labels.isBehavior[t] = false;
  writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  picked[layer].push({ id, n, mergedAt: pr.mergedAt.slice(0, 10), files: files.length, candidates: texts.length, rawCandidates: rawCount, title: pr.title });
  log.push({ n, layer, picked: true });
}
writeFileSync(join(T, 'precision-selection.json'), JSON.stringify({ stats: { ...stats, fetched }, picked, log }, null, 1));
console.log({ fetched, L1: picked.L1.length, L2: picked.L2.length });
console.table([...picked.L1, ...picked.L2].map(({ title, ...r }) => r));
```

## Appendix: precision-run.sh

```bash
#!/usr/bin/env bash
# Runs `ce eval` once per fixture (one process each), Layer 1 first, stopping before the next fixture
# once the cumulative billed requests reach the ceiling.
# Usage: precision-run.sh <repoRoot> <fixturesDir> <outDir> <maxRequests>
set -u
repo=$1; fx=$2; out=$3; max=$4; mkdir -p "$out"
cd "$repo" || exit 1
total=0
l1=$(grep -l '"Layer L1' "$fx"/*.json); l2=$(grep -l '"Layer L2' "$fx"/*.json)
[ -z "$l1" ] && l1=$(grep -l 'Layer L1' "$fx"/*.json); [ -z "$l2" ] && l2=$(grep -l 'Layer L2' "$fx"/*.json)
for f in $l1 $l2; do
  if [ "$total" -ge "$max" ]; then echo "CEILING reached at $total requests; stopping before $(basename "$f")"; break; fi
  id=$(basename "$f" .json); one=$(mktemp -d); cp "$f" "$one/"
  before=$(ls -d .ce/runs/eval-* 2>/dev/null | sort | tail -1)
  if node packages/ce/dist/cli.js eval --fixtures "$one" > "$out/$id.log" 2>&1; then
    after=$(ls -d .ce/runs/eval-* 2>/dev/null | sort | tail -1)
    if [ "$after" != "$before" ] && [ -f "$after/eval.json" ]; then
      cp "$after/eval.json" "$out/$id.json"
      req=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).requests)' "$out/$id.json")
      total=$((total + req)); echo "ok $id requests=$req total=$total"
    else echo "noeval $id"; fi
  else echo "ERROR $id (see $out/$id.log)"; fi
  rm -rf "$one"
done
echo "TOTAL requests=$total"
```

## Appendix: precision-analyze.mjs

```js
// Precision pilot analysis (#29). Usage: node precision-analyze.mjs <repoRoot> <fixturesDir> <runDir>
// <runDir>/<fixtureId>.json is the eval.json of a one-fixture `ce eval` run; a missing file is an errored or unrun fixture.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, fixturesDir, runDir] = process.argv.slice(2);
const dist = (p) => import(pathToFileURL(resolve(repoRoot, 'packages/ce/dist', p)).href);
const { combine } = await dist('assessment/combine.js');
const { buildFixtureContext } = await dist('eval/providers.js');
const { ConfigDefaults } = await dist('config/defaults.js');

/** Exact two-sided 95% Clopper-Pearson interval for k successes in n. */
function cp(k, n) {
  if (n === 0) return [0, 1];
  const cdf = (p, kk) => {
    let s = 0;
    let term = Math.pow(1 - p, n);
    for (let i = 0; i <= kk; i += 1) {
      s += term;
      term *= ((n - i) / (i + 1)) * (p / (1 - p));
    }
    return s;
  };
  const solve = (f) => {
    let lo = 0;
    let hi = 1;
    for (let it = 0; it < 100; it += 1) {
      const mid = (lo + hi) / 2;
      if (f(mid)) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const lower = k === 0 ? 0 : solve((p) => 1 - cdf(p, k - 1) < 0.025);
  const upper = k === n ? 1 : solve((p) => cdf(p, k) > 0.025);
  return [lower, upper];
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN;
};

const rows = [];
let reproduced = 0;
let requests = 0;
for (const name of readdirSync(fixturesDir).filter((n) => n.endsWith('.json')).sort()) {
  const fixture = JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
  const layer = /Layer (L[12])/.exec(fixture.description)[1];
  // Pre-registered L2 split by conventional-commit prefix of the title.
  const kind = /^(fix|feat|refactor|test|perf)\b/.test(fixture.change.title) ? 'change' : 'chore';
  const p = join(runDir, name);
  if (!existsSync(p)) { rows.push({ id: fixture.id, layer, kind, error: true }); continue; }
  const run = JSON.parse(readFileSync(p, 'utf8'));
  requests += run.requests;
  const a = run.assessments.find((x) => x.fixtureId === fixture.id);
  const again = combine(a.perClaim.map(({ needed, uncertain, ...c }) => c), run.settings);
  if (again.required === a.required && again.decidedBy === a.decidedBy) reproduced += 1;
  const ctx = buildFixtureContext(fixture, { config: ConfigDefaults, env: {} }).context;
  const text = Object.fromEntries(ctx.candidates.map((c) => [c.id, c.text]));
  const isBeh = run.samples.filter((s) => s.question.includes('is_behavior'));
  const flagged = a.perClaim.filter((c) => c.needed || c.uncertain);
  rows.push({
    id: fixture.id, layer, kind, required: a.required, decidedBy: a.decidedBy, claimStatus: a.claimStatus,
    candidates: isBeh.length, claims: a.perClaim.length, needed: a.perClaim.filter((c) => c.needed).length, flagged: flagged.length,
    drivers: flagged.slice(0, 3).map((c) => `${c.needed ? 'needed' : 'uncertain'} RO ${c.runtimeObservable} CA ${c.checksAdequate}: "${(text[c.claimId] ?? '').replace(/\s+/g, ' ').slice(0, 70)}"`),
    settings: run.settings, modelIds: run.modelIds,
  });
}
const ok = rows.filter((r) => !r.error);
console.log(`settings: ${JSON.stringify(ok[0]?.settings)}; model ids: ${JSON.stringify([...new Set(ok.flatMap((r) => r.modelIds))])}`);
console.log(`combine reproduction: ${reproduced}/${ok.length}; errored or unrun: ${rows.filter((r) => r.error).map((r) => r.id).join(', ') || 'none'}; billed requests: ${requests}\n`);
console.log('| layer | n | SKIPPED | SKIPPED 95% CI | claims / candidates | flagged claims (pooled) | median per-PR flagged fraction |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
const GROUPS = [
  ['L1', (r) => r.layer === 'L1'],
  ['L2', (r) => r.layer === 'L2'],
  ['L2 change (fix/feat/refactor/test/perf)', (r) => r.layer === 'L2' && r.kind === 'change'],
  ['L2 chore (release, sync, other)', (r) => r.layer === 'L2' && r.kind === 'chore'],
];
for (const [L, f] of GROUPS) {
  const s = ok.filter(f);
  const k = s.filter((r) => !r.required).length;
  const [lo, hi] = cp(k, s.length);
  const claims = s.reduce((x, r) => x + r.claims, 0);
  const flagged = s.reduce((x, r) => x + r.flagged, 0);
  const cands = s.reduce((x, r) => x + r.candidates, 0);
  console.log(`| ${L} | ${s.length} | ${k}/${s.length} | ${pct(lo)} to ${pct(hi)} | ${claims} / ${cands} | ${flagged}/${claims} (${pct(flagged / Math.max(claims, 1))}) | ${pct(median(s.filter((r) => r.claims).map((r) => r.flagged / r.claims)))} |`);
}
console.log('\n| fixture | layer | kind | outcome | claimStatus | candidates | claims | needed | flagged | top drivers |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  if (r.error) { console.log(`| \`${r.id}\` | ${r.layer} | ${r.kind} | ERROR | | | | | | |`); continue; }
  console.log(`| \`${r.id}\` | ${r.layer} | ${r.kind} | ${r.required ? 'EVIDENCED' : 'SKIPPED'} (${r.decidedBy}) | ${r.claimStatus} | ${r.candidates} | ${r.claims} | ${r.needed} | ${r.flagged} | ${r.drivers.join('<br>').replace(/\|/g, '/')} |`);
}
```

## Appendix: recompute.mjs (added with the Results)

Run from the scratch directory that holds `precision-live/` and `troupe-runs/r1..r3/`.

```js
// Zero-request recompute of outcomes under alternative settings, from stored perClaim probabilities.
// Usage: node recompute.mjs <repoRoot>
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const [repo] = process.argv.slice(2);
const L1 = new Set(['84', '819', '1417', '570', '575', '567', '85', '566', '283', '571']);
const CHORE = new Set(['166', '260', '318', '453', '560', '564', '565', '599', '904', '94']);
const S = {
  'shipped 0.7 / evidence': { obs: 0.6, adq: 0.7, band: 0.1, ev: true },
  '0.6 / evidence': { obs: 0.6, adq: 0.6, band: 0.1, ev: true },
  '0.7 / skip': { obs: 0.6, adq: 0.7, band: 0.1, ev: false },
  '0.6 / skip': { obs: 0.6, adq: 0.6, band: 0.1, ev: false },
  '0.7 / evidence, flip-capable band': { obs: 0.6, adq: 0.7, band: 0.1, ev: true, flip: true },
};
const EPS = 0; // match combine.ts: plain |p - t| <= band in floating point
function judge(ro, ca, s) {
  const needed = ro >= s.obs && ca < s.adq;
  const roB = Math.abs(ro - s.obs) <= s.band + EPS, caB = Math.abs(ca - s.adq) <= s.band + EPS;
  const unc = s.flip ? (roB && ca < s.adq + s.band + EPS) || (caB && ro >= s.obs - s.band - EPS) : roB || caB;
  return { needed, unc, flag: needed || (unc && s.ev) };
}
const required = (pcs, s) => { const j = pcs.map((p) => judge(p.runtimeObservable, p.checksAdequate, s)); return j.some((x) => x.needed) || (s.ev && j.some((x) => x.unc)); };
// sanity: shipped must reproduce stored required
const P = 'precision-live';
const prec = readdirSync(P).filter((f) => f.endsWith('.json')).map((f) => { const j = JSON.parse(readFileSync(`${P}/${f}`)); const n = f.match(/\d+/)[0]; return { n, a: j.assessments[0] }; });
for (const { n, a } of prec) if (required(a.perClaim, S['shipped 0.7 / evidence']) !== a.required) throw new Error(`mismatch precision-${n}`);
// troupe
const fx = {};
const ls = execFileSync('git', ['-C', repo, 'ls-tree', '--name-only', 'calibrate/troupe-29', 'fixtures/eval-troupe/'], { encoding: 'utf8' }).split('\n').filter((p) => p.endsWith('.json'));
for (const p of ls) { const f = JSON.parse(execFileSync('git', ['-C', repo, 'show', `calibrate/troupe-29:${p}`], { encoding: 'utf8' })); fx[f.id] = f; }
const runs = ['r1', 'r2', 'r3'];
const tr = [];
for (const r of runs) for (const id of Object.keys(fx)) {
  const p = `troupe-runs/${r}/${id}.json`; if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p)); const a = j.assessments[0];
  if (required(a.perClaim, S['shipped 0.7 / evidence']) !== a.required) throw new Error(`mismatch ${id}@${r}`);
  const f = fx[id]; const reg = Object.keys(f.labels.isBehavior).filter((t) => f.labels.isBehavior[t]);
  const cls = reg.some((t) => f.labels.checksAdequate[t] === true) ? 'C2' : 'C1';
  const prob = (q, t) => j.samples.find((s) => s.question === q && s.subject === t)?.probability;
  const regPairs = reg.filter((t) => (prob('claim.is_behavior', t) ?? 0) >= 0.6).map((t) => [prob('assess.runtime_observable', t), prob('assess.checks_adequate', t)]).filter(([x, y]) => x !== undefined && y !== undefined);
  tr.push({ id, r, cls, a, regPairs });
}
console.log('troupe runs used:', tr.length, '; all shipped required reproduced');
console.log('| setting | L1 SKIPPED | L2 SKIPPED | L2 change SKIPPED | L2 chore SKIPPED | L2 flagged subjects | troupe C1 reg. claim caught r1/r2/r3 | troupe PR required (all runs) |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, s] of Object.entries(S)) {
  const sk = (f) => prec.filter(f).filter(({ a }) => !required(a.perClaim, s)).length + '/' + prec.filter(f).length;
  const l2 = prec.filter(({ n }) => !L1.has(n)).flatMap(({ a }) => a.perClaim);
  const fl = l2.filter((p) => judge(p.runtimeObservable, p.checksAdequate, s).flag).length;
  const c1 = runs.map((r) => { const x = tr.filter((t) => t.r === r && t.cls === 'C1'); return `${x.filter((t) => t.regPairs.some(([ro, ca]) => judge(ro, ca, s).flag)).length}/${x.length}`; }).join(' / ');
  const req = tr.filter((t) => required(t.a.perClaim, s)).length;
  console.log(`| ${name} | ${sk(({ n }) => L1.has(n))} | ${sk(({ n }) => !L1.has(n))} | ${sk(({ n }) => !L1.has(n) && !CHORE.has(n))} | ${sk(({ n }) => CHORE.has(n))} | ${fl}/${l2.length} | ${c1} | ${req}/${tr.length} |`);
}
// which outcomes change under flip-capable
for (const { n, a } of prec) if (required(a.perClaim, S['shipped 0.7 / evidence']) !== required(a.perClaim, S['0.7 / evidence, flip-capable band'])) console.log('precision flip changes:', n);
for (const t of tr) {
  const s0 = S['shipped 0.7 / evidence'], s4 = S['0.7 / evidence, flip-capable band'];
  if (required(t.a.perClaim, s0) !== required(t.a.perClaim, s4)) console.log('troupe PR flip changes:', t.id, t.r);
  if (t.regPairs.some(([ro, ca]) => judge(ro, ca, s0).flag) !== t.regPairs.some(([ro, ca]) => judge(ro, ca, s4).flag)) console.log('troupe reg-claim flip changes:', t.id, t.r, JSON.stringify(t.regPairs));
}
```
