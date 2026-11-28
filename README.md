# Continuous Evidence

Automated verification that produces inspectable **runtime evidence** for
software changes — when existing checks do not already provide sufficient
evidence, and without duplicating them.

Read [`SPEC.md`](./SPEC.md) for the full v0 specification.

## Status

`v0.1` — specification frozen for the MVP; implementation spike in progress
(Milestone 1: *Prove the Concept*).

## Quick start

CE requires Node.js 22.12 or newer. Install it in your project and run the
setup command:

```sh
npm i -D continuous-evidence
npx ce init
```

Set `OPENROUTER_API_KEY` in your shell, or in a `.env` file that you never
commit. Then install the Chromium browser and run CE:

```sh
npx playwright install chromium
npx ce run
```

Other ways to start:

```sh
npm i -g continuous-evidence && ce init
```

```sh
npx continuous-evidence init
```

> **Warning:** bare `npx ce` without the package installed resolves to the
> unrelated `ce` package on npm, not to CE. Install `continuous-evidence`
> first, as shown above, or run `npx continuous-evidence <command>`.

## Repository layout

```
ce/
├── SPEC.md              # Continuous Evidence SPEC v0.1
├── packages/ce/         # CE core + CLI (TypeScript, Node.js)
└── examples/demo-app/   # Minimal web app used as the spike's verification target
```

The monorepo uses plain npm workspaces — no build orchestration framework.
The demo app is deliberately independent of CE to keep verification
non-invasive (SPEC.md §4.5).

## Development

```bash
npm install
npm run build        # build all workspaces
npm run typecheck    # typecheck all workspaces
```

Run the demo app:

```bash
npm run dev --workspace @ce/demo-app   # serves http://localhost:5173
```

Build the CE CLI and check its version:

```bash
npm run build --workspace continuous-evidence
npx ce --version
```

Inside the workspace, `npx ce` runs the local build. To use CE in your own
project, follow [Quick start](#quick-start).

## CI requirements

CE reads the Change from Git, so the CI checkout must contain the history
of the base branch.

- **`fetch-depth: 0`**: set it on `actions/checkout`. Without it the base
  ref and the merge base may not exist, and the Git provider reports
  `base-unresolved` or `merge-base-missing`.

  ```yaml
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  ```

- **`pull_request_target`**: this event checks out the base branch by
  default, so the pull request head commit is not in the repository and the
  diff is empty. Check out the head commit explicitly, with full history:

  ```yaml
  - uses: actions/checkout@v4
    with:
      ref: ${{ github.event.pull_request.head.sha }}
      fetch-depth: 0
  ```

  If the workflow does not do this, the run records the Git provider as
  `used` with the reason `head-missing`. That reason marks a run whose diff
  was taken from the wrong commit.

- **`context.checks`** (JUnit XML): the value must be a path or glob
  relative to the working directory. An absolute path, such as
  `${{ github.workspace }}/reports/junit.xml`, or a path with a `..`
  segment is rejected, the JUnit provider is recorded as `unavailable` with
  the reason `source-malformed`, and no file is read. Write
  `reports/junit.xml` or `reports/**/*.xml` instead.

## GitHub Action

The Action runs CE on a pull request and posts one evidence comment. Copy
this workflow to `.github/workflows/ce.yml`:

```yaml
name: CE
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  evidence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - uses: rfxlamia/ce@v0
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
        with:
          target-start: npm run dev
          target-ready-path: /
```

To test an app that is already running, use `target-url` instead of
`target-start`. Store the key as a repository secret named
`OPENROUTER_API_KEY`. Reference it only through `${{ secrets.* }}`, never
write its value in a file. For `pull_request_target`, see the checkout rule in
[CI requirements](#ci-requirements).

### Permissions

| `publish` | `permissions` |
| --- | --- |
| `none` (default) | `contents: read` and `pull-requests: write` (to create or update the comment) |
| `branch` | `contents: write` (to push the `ce-evidence` branch) and `pull-requests: write` |

### Inputs

Every input is optional. An empty value means the `ce.yml` value or the CE
default applies. List inputs are split at `,`.

| Input | Default | Meaning |
| --- | --- | --- |
| `target-url` | `''` | `target.url`: URL of the running Subject. |
| `target-start` | `''` | `target.start`: command that starts the Subject. |
| `target-ready-path` | `''` | `target.ready.path`: path polled until the Subject is ready. |
| `target-ready-timeout` | `''` | `target.ready.timeout`: readiness timeout. |
| `target-routes` | `''` | `target.routes`: comma-separated routes. |
| `context-base` | `''` | `context.base`: Git base ref. |
| `context-include` | `''` | `context.include`: comma-separated include globs. |
| `context-exclude` | `''` | `context.exclude`: comma-separated exclude globs. |
| `context-redact` | `''` | `context.redact`: comma-separated redaction patterns. |
| `context-checks` | `''` | `context.checks`: comma-separated existing Check paths. |
| `assessment-thresholds-claim` | `''` | `assessment.thresholds.claim`. |
| `assessment-thresholds-observable` | `''` | `assessment.thresholds.observable`. |
| `assessment-thresholds-adequate` | `''` | `assessment.thresholds.adequate`. |
| `assessment-uncertainty-band` | `''` | `assessment.uncertainty-band`. |
| `assessment-on-uncertain` | `''` | `assessment.on-uncertain`. |
| `runtime-max-steps` | `''` | `runtime.max-steps`. |
| `runtime-timeout` | `''` | `runtime.timeout`. |
| `runtime-viewport-width` | `''` | `runtime.viewport.width`. |
| `runtime-viewport-height` | `''` | `runtime.viewport.height`. |
| `jev-provider` | `''` | `jev.provider`: `openrouter` or `typesafe`. |
| `jev-model` | `''` | `jev.model`. |
| `output-dir` | `''` | `output.dir`: parent directory of the run directory. |
| `output-fail-on` | `''` | `output.fail-on`: comma-separated conditions that fail the step. |
| `config` | `''` | Path to a `ce.yml` config file (passed as `--config`). |
| `base` | `''` | Git base ref (passed as `--base`). |
| `claim` | `''` | Claims, one per line (each passed as `--claim`). |
| `working-directory` | `''` | Working directory for the CE run. Empty means the workspace root. |
| `token` | `''` | Token for the Git push and the comment calls. Empty falls back to `github-token`, then to the workflow token. |
| `github-token` | `''` | Alias of `token`, kept for earlier workflows. `token` wins when both are set. |
| `default-token` | `${{ github.token }}` | Internal. Carries the workflow token into the Action. Do not set it. |
| `comment` | `'true'` | Post the pull request comment. Set to `false` to skip it. |
| `comment-author` | `'github-actions[bot]'` | Login of the account that owns the CE comment. |
| `artifact-name` | `''` | Artifact name. Empty builds a unique name per invocation. |
| `publish` | `''` (none) | Evidence publishing mode: `none` or `branch`. Empty defers to `ce.yml`, and the effective default is `none`. The `ce.yml` key is `publish`. See [Publishing screenshots](#publishing-screenshots-publish-branch). |
| `publish-max-images` | `''` (6) | `publish-max-images`: most screenshots published per run (1 to 50). Empty means 6. |
| `publish-max-image-bytes` | `''` (5242880) | `publish-max-image-bytes`: largest published screenshot in bytes (5 MiB by default, at most 20 MiB). |

### Outputs

| Output | Meaning |
| --- | --- |
| `outcome` | `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` or `ERROR`, or empty when unknown. |
| `run-dir` | Absolute path of the run directory, or empty. |
| `artifact-url` | URL of the uploaded evidence artifact, or empty. |
| `comment-url` | URL of the pull request comment, or empty. |
| `exit-code` | Exit code of the CE CLI. |

### Behavior notes

- **Fork pull requests**: the token is read-only, so the comment step
  degrades to a warning and a job summary. With `publish: branch`, a fork
  pull request publishes nothing and the comment says `publish skipped: fork PR`.
- **No pushes with `publish: none`**: the Action pushes nothing to Git. It
  writes only the artifact upload, the cache save and the comment.
- **`publish: branch`** is described in
  [Publishing screenshots](#publishing-screenshots-publish-branch).
- **`context-redact`**: a pattern that contains a comma cannot pass through
  this input, because the list is split at `,`. Set such patterns in
  `ce.yml`.
- **`base` and `context-base`**: when both are set, `base` wins.
- **Comment author**: the Action finds its comment by the author
  `github-actions[bot]`. A workflow that posts with a personal access token
  must set `comment-author` to that account's login, or the Action creates a
  new comment on each run.
- **`artifact-name`**: when set, it must be unique per step in the job.
  Leave it empty to get a unique name automatically.

### Publishing screenshots (`publish: branch`)

`publish` takes `none` (the default) or `branch`. In `ce.yml` the key is
`publish`. With `publish: branch`, the Action copies the final screenshot and
the step screenshots of the run to Git and shows the final screenshot inline in
the pull request comment. The step screenshots appear as thumbnails in a
`<details>` block. Set these permissions and the input:

```yaml
permissions:
  contents: write
  pull-requests: write
```

```yaml
- uses: rfxlamia/ce@v0
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
  with:
    publish: branch
```

How it works:

- **Where it pushes**: only to the orphan branch `ce-evidence`, under
  `pr-<n>/<run-id>/`. It never pushes to a code branch and never force-pushes.
  CE uses the system `git` binary of the runner.
- **Image URLs**: each image links to the pushed commit SHA, so the link does
  not change when the branch moves.
- **Image cap**: at most 6 images per run by default (`publish-max-images`).
  The final screenshot is kept first, then the last steps. The comment states
  how many were skipped.
- **Per-image limit**: 5 MiB by default (`publish-max-image-bytes`). An
  oversize image stays in the Artifact and counts as skipped.
- **Concurrent runs**: when a push is rejected because another run pushed
  first, the Action fetches, rebuilds its commit and pushes again, at most 3
  retries. After that the comment falls back to the Artifact link.
- **Protected branch or ruleset**: if a branch protection rule or ruleset
  blocks the push, the run does not fail. The comment keeps the Artifact link
  and says why nothing was published.
- **Fork pull requests**: they never publish (`publish skipped: fork PR`).
- **`comment: false`**: `publish: branch` with `comment: false` publishes
  nothing.

> **Warning: published images are permanent.** Images stay on the
> `ce-evidence` branch until a maintainer prunes it. This feature has no
> deletion. Artifacts expire (about 90 days by default), but these images do
> not. A screenshot can show sensitive data of the Subject, such as user
> names, tokens on screen, or personal data, and text redaction does not cover
> an image. In a public repository the images are public. Do not use
> `publish: branch` when the Subject can show sensitive data.

Clone weight: a plain clone, and `actions/checkout` with `fetch-depth: 0` as
the dogfood workflow uses, fetch every branch, including `ce-evidence` and its
PNG files. The branch makes every such clone larger as it grows. The Action
itself fetches only that branch, with `--depth 1`. To avoid the weight, use a
shallow checkout, a `single-branch` clone, or a refspec that excludes
`ce-evidence`.

Other workflows: exclude `ce-evidence` from your other workflows, for example
with `branches-ignore: [ce-evidence]`. A GitHub App token passed as `token` can
trigger workflows on the pushed branch. CE guards against its own loop: when
the ref is `ce-evidence`, the Action does nothing and exits with code 0.

#### Private repositories

**Status: unverified (check deferred).** Whether the inline images render
for people with read access to a private repository, and what a reader without
access sees, has not been checked. The check is tracked as a follow-up and the
result will be recorded in
[`private-repo-image-verification.md`](./.kiro/specs/inline-screenshot-in-pr/private-repo-image-verification.md).
Until then, do not rely on inline images in a private repository. If you need
certainty, set `publish: none`: the comment then links the workflow Artifact and
CE writes nothing to Git.

## Releasing

This section is for maintainers. Pushing one tag releases the GitHub Action and the npm package together.
Action users pin `rfxlamia/ce@v0`, so the `v0` major tag must also move (step 5).

1. Run `npm login` with an account that can publish `continuous-evidence`.
2. After the PR is merged, publish the first release by hand from the
   repository root:

   ```sh
   npm publish --workspace continuous-evidence --access public
   ```

3. On npmjs.com, add a trusted publisher to the package: publisher GitHub
   Actions, repository `rfxlamia/ce`, workflow filename `release.yml`.
4. Bump the version, open a PR and merge it. Then tag `main` with the semver
   tag `vX.Y.Z` (for example `v0.1.1`). Push the tag soon after step 3,
   because a trusted publisher configuration may expire if it goes unused.
   The release workflow fails when the tag and the version in
   `packages/ce/package.json` differ.

   ```sh
   make bump VERSION=X.Y.Z   # updates package.json, version.ts, action/dist
   make check
   # commit, open a PR, merge it, then on an up-to-date main:
   make tag VERSION=X.Y.Z    # asks before pushing vX.Y.Z
   ```

5. After the Release workflow succeeds, move the `v0` major tag to the same
   release so `rfxlamia/ce@v0` users get it. Skip this for prereleases.

   ```sh
   make move-major VERSION=X.Y.Z
   ```

   Without make, the equivalent is:

   ```sh
   git tag -f -a v0 -m "v0: moving major tag (currently vX.Y.Z)" "vX.Y.Z^{}"
   git push --force-with-lease=refs/tags/v0:<old v0 sha> origin refs/tags/v0
   ```

6. Create the GitHub Release for the tag, with generated notes. Prereleases
   are marked as prereleases and not as the latest release.

   ```sh
   make gh-release VERSION=X.Y.Z
   ```

7. Optionally, in the package settings on npmjs.com, select "Require 2FA and disallow tokens".

Pushing a tag runs `.github/workflows/release.yml`. It publishes with OIDC trusted publishing, so the repository stores no npm token. Stable versions go to the `latest` dist-tag. Prerelease versions (for example `0.2.0-rc.1`) go to the `next` dist-tag.

## License

[MIT](./LICENSE)
