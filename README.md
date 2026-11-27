# Continuous Evidence

Automated verification that produces inspectable **runtime evidence** for
software changes — when existing checks do not already provide sufficient
evidence, and without duplicating them.

Read [`SPEC.md`](./SPEC.md) for the full v0 specification.

## Status

`v0.1` — specification frozen for the MVP; implementation spike in progress
(Milestone 1: *Prove the Concept*).

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

Run the CE CLI (stub for now):

```bash
npm run build --workspace continuous-evidence
npx ce --version
```

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

- `contents: read`
- `pull-requests: write` (to create or update the comment)

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
| `github-token` | `${{ github.token }}` | Token for GitHub API calls (comment upsert). |
| `comment` | `'true'` | Post the pull request comment. Set to `false` to skip it. |
| `comment-author` | `'github-actions[bot]'` | Login of the account that owns the CE comment. |
| `artifact-name` | `''` | Artifact name. Empty builds a unique name per invocation. |
| `publish` | `'none'` | Evidence publishing mode: `none` or `branch`. Only `none` is implemented. |

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
  degrades to a warning and a job summary.
- **No pushes**: the Action pushes nothing to Git. It writes only the
  artifact upload, the cache save and the comment.
- **`publish: branch`** is not implemented in this release. Setting it fails
  the step.
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

## License

[MIT](./LICENSE)
