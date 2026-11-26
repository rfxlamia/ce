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

## License

[MIT](./LICENSE)
