**Chosen form: single-file bundle** (esbuild, `playwright` and `playwright-core` external, shipped as a pruned `action/dist/node_modules/` tree).

### Commands

```
node scripts/verify-action-bundle.mjs --form=bundle
node scripts/verify-action-bundle.mjs --form=compiled
```

Each run builds `action/dist` with `scripts/build-action.mjs --form=<form>`, copies the repository into a temp directory without any `node_modules/` (only `action/dist/node_modules/` is kept), then runs the packaged entry `action/dist/index.js` in a `node:24` Docker container (Linux, aarch64, OrbStack). In the container it first runs the packaged `playwright-core/cli.js install-deps chromium` (apt libraries, which GitHub's ubuntu runners already have), then the entry. The entry runs `playwright install chromium`, launches Chromium headless and loads `about:blank`.

### Result

| Form | Chromium install | Headless launch and page load | dist size | dist files |
| --- | --- | --- | --- | --- |
| bundle | passed | passed (`chromium 159.0.8154.6 loaded about:blank`) | 15.7 MiB | 133 |
| compiled | passed | passed (same output) | 15.7 MiB | 133 |

Both forms pass. `playwright` and `playwright-core` stay on disk untouched in both, which satisfies F17.

### Why the bundle

With the spike entry the two forms are the same size (about 15.7 MiB, almost all of it `playwright-core`), so size does not separate them today. Diff noise does once the real entry exists. The bundle inlines the Action source, `packages/ce` and its non-Playwright dependencies (zod, the Jev SDK) into one `index.js`, so `node_modules` stays at two packages. The compiled form emits one file per source module and must also ship every runtime dependency's package files, which adds many committed files that change on each dependency bump.

### Limits of this verification

- Run on an aarch64 Linux container, not an x64 GitHub runner. Playwright's installer selects the platform build itself; the x64 path was not exercised here. The first run of the real workflow on `ubuntu-latest` confirms it.
- The `install-deps` step was needed because `node:24` is minimal. It is not part of the packaged entry.
- The spike entry is a stub. The real entry's bundling of `packages/ce` is not yet verified and is covered by the later bundle tests.
