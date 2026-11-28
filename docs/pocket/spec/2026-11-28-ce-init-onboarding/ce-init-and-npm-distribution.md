# `ce init` and npm distribution (issue #13)

**Date:** 2026-11-28
**Status:** approved (2026-11-28; the user's goal is a PR that meets every issue #13 acceptance item so it can close the issue)
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
**Issue:** https://github.com/rfxlamia/ce/issues/13 (R1.3 in `docs/journal/v0.0/requirements.md`)

---

## Summary

Add `ce init`, which detects a project's dev server and writes a commented, schema-valid `ce.yml`. It never overwrites an existing config unless `--force` is passed, and it prints the remaining onboarding steps. Make `packages/ce` publishable as `continuous-evidence`: a lean tarball that is built on pack, a CI smoke test of the packed tarball, and an OIDC release workflow for later releases. Update the README Quick start. The maintainer does the first `npm publish` by hand after merge, because npm trusted publishing cannot create a package.

---

## Context

### Current State
- `packages/ce` is `continuous-evidence@0.1.0`: TypeScript, ESM, Node `>=22.12`. `tsc` compiles `src` into `dist`. bin `ce` points to `dist/cli.js`, and `src/cli.ts:1` is `#!/usr/bin/env node`, which tsc keeps. `files: ["dist"]`. There is no `repository` field, and the package directory has no README or LICENSE.
- `src/cli.ts` routes commands with a `switch` (`run`, `eval`, help, version). Each command is a pure `runXCommand(argv, deps)`, for example `src/run/command.ts` (`RunCommandDeps`, `parseRunArgs`, `USAGE`).
- Config discovery (`src/config/file.ts` `discoverConfigFile`) looks only in cwd. It prefers `ce.yml`; if `.ce.yml` also exists it is reported as ignored, and `.ce.yml` is used only when it is alone. The schema is a strict zod `ConfigSchema` (`src/config/schema.ts`). `target.start` requires `target.url`, and that URL must be loopback (`src/runtime/target.ts`, the `TargetConfigError` paths). `ready` defaults to path `/` and timeout `30s`.
- A missing `OPENROUTER_API_KEY` makes `ce run` resolve to `ERROR`, with a message that names the variable (`src/config/credentials.ts`). `.env` in cwd is auto-loaded (`src/cli.ts` `loadEnvFileIfPresent`).
- The GitHub Action (`action/src/index.ts`) spawns `ce run` in the workspace, so it discovers `ce.yml` there, and it installs Chromium itself.

### Problem / Motivation
- There is no `init` command: `ce init` prints `Unknown command: init` and exits 1 (verified on a packed tarball).
- The tarball is bloated with test files. `npm pack --workspace continuous-evidence --dry-run` lists 970 files, 726 of them `*.test.*`, `*testsupport*`, `*arbitraries*` or `scripts/` output (3.6 MB unpacked). The `arbitraries` modules import `fast-check`, which is a devDependency.
- `dist/` is gitignored and nothing builds it before packing, so a pack from a clean checkout ships no CLI.
- `continuous-evidence` returns 404 on npm. Classic npm tokens were revoked on 2025-12-09, and trusted publishing (OIDC) cannot do a package's first publish.

### Related Areas
`packages/ce/src/cli.ts`, `src/config/{file,schema,load}.ts`, `src/runtime/target.ts`, `packages/ce/package.json`, `packages/ce/tsconfig.json`, `.github/workflows/ci.yml`, `README.md`, `action.yml`.

---

## Scope

### In-Scope
- `ce init [--force]`: detect the package manager, dev script, port and framework hints from cwd `package.json` and lockfiles, then write a commented `ce.yml` that passes the real loader and schema.
- Overwrite guard covering both `ce.yml` and `.ce.yml`, and `--force` semantics.
- Next-steps output: the key env var, the Chromium install, `.gitignore` hints, `ce run`, and a verified workflow snippet.
- Packaging: a lean tarball with no test artifacts, a build on pack (`prepack`), the shebang, a `repository` field, and a package README and LICENSE.
- A CI smoke-test job on every PR: pack, install into an empty git repo, `ce --version`, `ce init`, validate `ce.yml`, then `ce run` without a key must return the credential `ERROR`.
- A tag-triggered OIDC release workflow for releases after the first.
- Root README: Quick start, the bare `npx ce` warning, and a maintainer first-publish runbook.

### Out-of-Scope
- Running `npm publish` itself. The agent has no npm auth (`npm whoami` returns 401). The maintainer runs the first publish by hand after merge, by user decision.
- Detection for projects that are not JavaScript. They get the commented template only.
- Interactive prompts or a wizard.
- Writing `.gitignore`, `.env` or the workflow file. `init` only prints these.
- `init` running network commands such as `playwright install`.
- Fixing the existing README Action snippet that passes `target-start` without `target-url`. That bug predates this work and is only noted here. The new snippet is independent of it.
- Monorepo or workspace detection: a root with no `dev` or `start` script falls back to the template.

---

## Architecture Constraints

- May touch: new `packages/ce/src/init/**`, `src/cli.ts` (route and help), `packages/ce/package.json`, a new `packages/ce/tsconfig.build.json`, new `packages/ce/README.md` and `packages/ce/LICENSE`, root `README.md`, `.github/workflows/ci.yml` (new job), new `.github/workflows/release.yml`, and a new smoke script under `scripts/`.
- Must NOT touch: the run pipeline, the semantics of `ConfigSchema`, or the behaviour of the `action/` bundle.
- Patterns: a pure `runInitCommand(argv, deps)` with injected `cwd`, `env`, `stdout`, `stderr` and fs, with no `process.*` inside. Tests use vitest, plus fast-check for properties. Code and docs are in English.
- Architecture validation result: **PASS**, with the assumptions listed below. See the evidence.

### Validation Evidence

| Claim or constraint | Codebase evidence | External source | Result |
|---|---|---|---|
| tsc keeps the shebang, and the bin works after install | `src/cli.ts:1`; `dist/cli.js` head; empirical: packed tarball → `npm i -D` → `npx ce --version` prints `0.1.0` | npm package.json docs, "bin" ([npm/cli docs](https://github.com/npm/cli/blob/latest/docs/lib/content/configuring-npm/package-json.md), via Context7 `/npm/cli`, 2026-11-28) | PASS |
| `npx continuous-evidence init` runs bin `ce` | the single `bin` entry in `packages/ce/package.json` | npm-exec/npx heuristic: a single `bin` entry is used ([npx.md](https://github.com/npm/cli/blob/latest/docs/lib/content/commands/npx.md), Context7, npm 11.x) | PASS |
| `npm pack --workspace continuous-evidence` works from the root and runs `prepack` | empirical: `npm pack --workspace continuous-evidence` (npm 11.20.0) produced `continuous-evidence-0.1.0.tgz` | `prepack` runs on `npm pack` and `npm publish` ([scripts.md](https://github.com/npm/cli/blob/latest/docs/lib/content/using-npm/scripts.md), Context7) | PASS |
| The tarball currently ships test artifacts | `npm pack --dry-run --json`: 726 of 970 files; `*arbitraries.ts` import `fast-check` (a devDependency) | n/a | FAIL on the current state, which motivates the design: exclude them through `tsconfig.build.json` |
| No runtime code reads files outside `dist` | grep `import.meta.url`/`readFile` in non-test src: only cwd or run-dir reads, plus `demo-app.testsupport.ts` (excluded) | n/a | PASS |
| Nothing consumes `packages/ce/dist` except the bin | `scripts/verify-action-bundle.mjs` uses `action/dist`; the action resolves CE from source (`action/tsconfig.json` paths, `scripts/build-action.mjs`) | n/a | PASS: changing the build tsconfig does not affect the action |
| Generated `target` must pair `start` with a loopback `url` | `runtime/target.ts`: "target.url is required when target.start is set", plus the loopback check | n/a | PASS: init always emits `http://localhost:<port>` |
| Overwrite guard must cover `.ce.yml` | `config/file.ts` `discoverConfigFile` prefers `ce.yml` and ignores `.ce.yml` | n/a | PASS: guard on both |
| The Action honours `ce.yml` from the workspace and installs Chromium | `action/src/index.ts`: `cwd = resolve(deps.cwd, working-directory)`, `spawnCli({args:['run',...], cwd})`, `installChromium` | n/a | PASS: the snippet needs no `target-*` inputs |
| A missing key yields the credential ERROR | empirical: `env -u OPENROUTER_API_KEY npx ce run` → exit 1, message names `OPENROUTER_API_KEY` | n/a | PASS |
| Install time fits the "< 2 min" budget | empirical: `npm i -D <tarball>` took 6 s on an empty repo (excludes the Chromium download, roughly 30–90 s depending on network) | n/a | PASS, with an assumption about network speed |
| Classic tokens are revoked; OIDC cannot do a first publish | n/a | [GitHub changelog 2025-12-09](https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available); [npm/cli#8544](https://github.com/npm/cli/issues/8544); [npm/documentation#1926](https://github.com/npm/documentation/issues/1926) | PASS: the first publish is manual |
| The OIDC workflow needs `id-token: write`, Node 24 / npm ≥ 11.5.1, a GitHub-hosted runner, and a matching `repository` | `package.json` has no `repository` field yet | [docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers/) and [generating-provenance-statements](https://docs.npmjs.com/generating-provenance-statements/) (Context7 `/websites/npmjs`, 2026-11-28) | PASS: add `repository` with `directory: packages/ce`; the workflow asserts the npm version |
| A trusted-publisher config expires 48 h after creation if it is not used | n/a | secondary source ([matthewswong.com, 2026-10-17](https://www.matthewswong.com/en/blog/npm-trusted-publishing-48-hour-expiry-issue-comment)) | UNVERIFIED (non-material): the runbook tells the maintainer to tag a release soon after configuring it |

---

## Dependencies

### Existing (to leverage)
- `yaml@^2` is used in tests to round-trip the generated file through `readAndParseConfigFile`.
- `zod@^4` / `ConfigSchema` validates the generated file.
- `vitest` and `fast-check` are used for tests and properties.

### New (proposed)
None.
- Package-manager detection: `package-manager-detector` was rejected. The detection is about 10 deterministic lines of lockfile checks, the project policy is minimal runtime deps (design.md: "No framework, no daemon"), and every new runtime dep ships to all users.
- YAML emission: generating comments through the `yaml` Document API was rejected in favour of a fixed string template. The comments are mostly static, the values are only fixed tokens and a validated integer port, and a round-trip test guards validity.

---

## Stories + Scenarios

### Story A: init writes a detected config
> As a developer trying CE, I want `ce init` to write a `ce.yml` with my dev server pre-filled, so that `ce run` works without reading the docs.

**Rules**
- A1 Script choice: use `scripts.dev` when it is a non-empty, non-whitespace string. Otherwise use `scripts.start` under the same condition. Otherwise there is no start command.
- A2 Package manager: the `packageManager` field (prefix `npm|pnpm|yarn|bun`) wins. Otherwise check the lockfiles in this order: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock` or `bun.lockb` → bun, and anything else → npm. The start command is always `<pm> run <script>`.
- A2a Wrong types are ignored field by field, without falling back to A8. A non-string `packageManager` counts as absent. A `dependencies` or `devDependencies` value that is not an object counts as empty. A8 applies only to the cases listed there.
- A3 Port: the explicit match that comes earliest in the script text wins, whichever pattern it is: `--port N`, `--port=N`, `-p N`, or `PORT=N`. N must be an integer from 1 to 65535. Anything else is ignored, which means "not explicit". Otherwise use the framework default, detected from the script's command tokens first and from dependencies second: vite or @sveltejs/kit 5173, next 3000, nuxt/nuxi 3000, astro 4321, @angular/cli (`ng serve`) 4200, react-scripts 3000, gatsby 8000. Otherwise the port is unknown.
- A4 Output pairs `target.start: <pm> run <script>` with `target.url: http://localhost:<port>` and `target.ready.path: /`.
- A5 An unknown port writes 3000, with a comment telling the user to check it.
- A6 Framework hints are comments. User-controlled text is sanitised before it reaches a comment: CR, LF and other control characters are replaced, and the length is capped at 120 characters. YAML values come only from fixed tokens (the pm name and script name from fixed sets) and the validated integer port. Raw script text never becomes a YAML value.
- A7 The file starts with a header comment that links the docs and schema. Optional sections (`context`, `assessment`, `runtime`, `output`) appear as commented examples with the defaults. The file must parse and pass `ConfigSchema`.
- A8 Fallback: when `package.json` is missing, unreadable, invalid JSON (a UTF-8 BOM is tolerated), not an object, has a `scripts` value that is not an object, or has no usable script, write a valid template with the whole `target` block commented out and a comment that says why. Exit 0. stderr notes when `package.json` could not be read or parsed.

```gherkin
Scenario: vite with npm
  Given package.json {"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6"}} and package-lock.json
  When  `ce init`
  Then  ce.yml has target.start "npm run dev", target.url "http://localhost:5173", target.ready.path "/"
  And   a comment names vite
  And   exit code is 0

Scenario: explicit -p with pnpm
  Given scripts.dev "next dev -p 4000" and pnpm-lock.yaml
  When  `ce init`
  Then  target.start "pnpm run dev" and target.url "http://localhost:4000"

Scenario: --port= form
  Given scripts.dev "vite --port=8080"
  Then  target.url port is 8080

Scenario: PORT env prefix, no framework
  Given scripts.dev "PORT=5000 node server.js" and no framework deps
  Then  target.url port is 5000

Scenario: earliest explicit port wins
  Given scripts.dev "PORT=4100 vite --port 4200"
  Then  target.url port is 4100

Scenario: BOM-prefixed package.json
  Given package.json starting with U+FEFF and {"scripts":{"dev":"vite"}}
  Then  target.url port is 5173 (parsed normally)

Scenario: wrong-typed packageManager is ignored
  Given packageManager 42, scripts.dev "vite", pnpm-lock.yaml
  Then  target.start "pnpm run dev"

Scenario: invalid explicit port falls through
  Given scripts.dev "vite --port 70000"
  Then  target.url port is 5173 (framework default)

Scenario: start script with react-scripts
  Given only scripts.start "react-scripts start"
  Then  target.start "npm run start", port 3000, a comment names react-scripts

Scenario: empty dev script falls back to start
  Given scripts.dev "  " and scripts.start "vite"
  Then  target.start "npm run start"

Scenario: unknown server
  Given scripts.dev "node server.js"
  Then  port 3000 and a comment "port not detected; check it"

Scenario: packageManager field wins over lockfile
  Given packageManager "yarn@4.1.0" and package-lock.json
  Then  target.start "yarn run dev"

Scenario: no package.json
  Given an empty directory
  When  `ce init`
  Then  ce.yml is written with target commented out, exit 0

Scenario: malformed package.json
  Given package.json "{ not json"
  When  `ce init`
  Then  template with target commented out, exit 0, stderr says package.json could not be parsed

Scenario: hostile script text cannot inject YAML
  Given scripts.dev "vite\nassessment: {thresholds: {claim: 9}}  # x"
  When  `ce init`
  Then  the generated file parses, passes ConfigSchema, and has no assessment key set

Scenario: every generated file is valid (property)
  Given arbitrary package.json shapes, scripts with newlines, '#', quotes and long text, and arbitrary lockfile sets
  When  the generator runs
  Then  readAndParseConfigFile + ConfigSchema accept the output
```

### Story B: never overwrite without --force
**Rules**
- B0 "Exists" is decided with `lstat`. Any directory entry named `ce.yml` or `.ce.yml` counts, whether it is a file, a directory or a symlink.
- B1 When such an entry exists and `--force` is absent, write nothing. Print `<name> already exists; re-run with --force to overwrite` to stderr, naming the first of `ce.yml`, `.ce.yml` that exists, and exit 1. A directory gets the same message.
- B2 Creating the file without `--force` uses an exclusive create (`wx`), so a file that appears between the check and the write is never overwritten. That case also exits 1 with the same message.
- B3 With `--force`, the target is the file that `discoverConfigFile` would load, using the same `isFile` (stat) rule:
  - `ce.yml` when it is a file (a symlink to a file counts; the rename replaces the link itself)
  - otherwise `.ce.yml` when it is a file
  - otherwise `ce.yml`

  If the chosen path is a directory, apply B5 (EISDIR).

  A dangling symlink `ce.yml` counts as existing for B1. Under `--force` it is not a file, so the target is `.ce.yml` if that is a file, otherwise `ce.yml`, and the rename replaces the link. The overwrite writes a temp file in the same directory and then renames it, so a failure leaves the original intact. When both files exist, stderr notes that `.ce.yml` stays ignored.
- B4 An unknown argument or a positional argument prints the usage to stderr, exits 1 and writes nothing.
- B5 When the write fails (EACCES, EISDIR, ENOSPC, or the target is a directory), stderr names the file and the error code, the exit code is 1, no temp file is left behind, and no success text is printed.
- B6 Output contract: the success and next-steps text goes to stdout. Errors and notes go to stderr.

```gherkin
Scenario: existing ce.yml is protected
  Given ce.yml with custom content
  When  `ce init`
  Then  ce.yml is byte-identical, exit 1, stderr mentions "ce.yml" and "--force"

Scenario: existing .ce.yml is protected
  Given only .ce.yml
  When  `ce init`
  Then  no ce.yml is created, exit 1

Scenario: second run is a no-op
  Given `ce init` succeeded once
  When  `ce init` runs again without --force
  Then  exit 1 and the file is byte-identical

Scenario: --force replaces ce.yml
  Given ce.yml exists
  When  `ce init --force`
  Then  ce.yml holds generated content, exit 0

Scenario: --force rewrites .ce.yml in place
  Given only .ce.yml
  When  `ce init --force`
  Then  .ce.yml is rewritten, no ce.yml is created

Scenario: unknown flag
  Given `ce init --bogus`
  Then  usage on stderr, exit 1, no file

Scenario: ce.yml is a directory, no --force
  Given ce.yml is a directory
  When  `ce init`
  Then  exit 1, stderr "ce.yml already exists; re-run with --force to overwrite", nothing written

Scenario: ce.yml is a directory, --force
  Given ce.yml is a directory and no .ce.yml
  When  `ce init --force`
  Then  exit 1, stderr names ce.yml and EISDIR, nothing written, no temp file left

Scenario: directory ce.yml beside a real .ce.yml, --force
  Given ce.yml is a directory and .ce.yml is a file
  When  `ce init --force`
  Then  .ce.yml is rewritten (it is the file discovery loads), exit 0

Scenario: write fails mid --force
  Given ce.yml exists and the temp write fails (injected fs error)
  When  `ce init --force`
  Then  the original ce.yml is unchanged, no temp file remains, exit 1
```

### Story C: next steps
**Rules**
- C1 After a successful write, stdout prints, in order:
  1. the path written
  2. (only when the target was not detected) "edit target in ce.yml"
  3. set `OPENROUTER_API_KEY` (get one at https://openrouter.ai/keys) in the environment or in `.env`, which is auto-loaded and must be kept out of git
  4. `npx playwright install chromium`
  5. add `.ce/` and `.env` to `.gitignore`
  6. the run command, chosen by whether `continuous-evidence` is in the cwd `package.json` `dependencies` or `devDependencies`:
     - when it is, `npx ce run`
     - when it is not, `npm i -D continuous-evidence` and then `npx ce run`, with an alternative of `npx continuous-evidence run`. "Not" covers running via `npx continuous-evidence init`, wrong-typed dependency fields (A2a), and an unreadable `package.json` (A8). The `npx ce run` line is always printed after the install line, never before it and never on its own, because a bare `npx ce` would pull the unrelated `ce` package.
  7. a workflow snippet for `.github/workflows/ce.yml`
- C2 The snippet contains: an `on: pull_request` trigger; `permissions` of `contents: read` and `pull-requests: write`; `actions/checkout` with `fetch-depth: 0`; `actions/setup-node` (node 22); the install steps from the table below; and `uses: rfxlamia/ce@v0` with `env: OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`. It has no `target-*` inputs, because the Action reads `ce.yml`.
  Install steps by package manager:

  | Detected pm | Extra setup step (before setup-node) | Install command |
  |---|---|---|
  | npm with `package-lock.json` | none | `npm ci` |
  | npm without a lockfile | none | `npm install` |
  | pnpm | `pnpm/action-setup@v4`, plus `with: version: 10  # match your pnpm version` when package.json has no `packageManager` field (the action requires `version` then; amended during T4 audit) | `pnpm install --frozen-lockfile` when `pnpm-lock.yaml` exists, else `pnpm install` |
  | yarn | none (`corepack enable` as a run step) | `yarn install --immutable` when `packageManager` is `yarn@2` or later (Berry); otherwise `yarn install --frozen-lockfile` (Yarn 1, also when `packageManager` is absent). Either way, the frozen flag is used only when `yarn.lock` exists, else `yarn install` |
  | bun | `oven-sh/setup-bun@v2` | `bun install --frozen-lockfile` when `bun.lock` or `bun.lockb` exists, else `bun install` |
  | A8 fallback (target not detected) | none | `npm ci`, with the comment `# adjust to your install command` |
- C3 No secret value is ever printed. When the key is already set, the output says "already set" without the value.

```gherkin
Scenario: next steps after a detected init
  Given the vite scenario succeeded
  Then  stdout contains "OPENROUTER_API_KEY", "playwright install chromium", "ce run",
        and a YAML block with "uses: rfxlamia/ce@v0", "fetch-depth: 0", "secrets.OPENROUTER_API_KEY"

Scenario: run command when installed
  Given package.json devDependencies has "continuous-evidence"
  When  `ce init`
  Then  next steps show "npx ce run"

Scenario: run command when not installed
  Given package.json without continuous-evidence (e.g. ran via `npx continuous-evidence init`)
  When  `ce init`
  Then  next steps contain "npm i -D continuous-evidence" and "npx continuous-evidence run"
  And   any "npx ce run" occurrence comes after the "npm i -D continuous-evidence" occurrence (index check)

Scenario: key value never echoed
  Given OPENROUTER_API_KEY=sk-test-123 in env
  When  `ce init`
  Then  stdout and stderr do not contain "sk-test-123"

Scenario: snippet is valid YAML
  Given the printed snippet
  Then  it parses as YAML and has jobs.*.steps containing uses "rfxlamia/ce@v0"
  And   its install step matches the C2 table for the detected pm (one example per row)
```

### Story D: distribution
**Rules**
- D1 `packages/ce/tsconfig.build.json` extends `tsconfig.json` and excludes `**/*.test.ts`, `**/*.testsupport.ts`, `**/*arbitraries.ts` and `src/scripts/**`. `build` uses it. `prepack` cleans `dist` and builds. `typecheck` keeps the full tsconfig, so tests are still checked.
- D2 The tarball contains `dist/**` (runtime JS, `.d.ts` and maps), `package.json`, `README.md` and `LICENSE`. It contains zero test, testsupport, arbitraries or scripts files. `dist/cli.js` starts with `#!/usr/bin/env node`.
- D3 `package.json` gains `repository` (`git+https://github.com/rfxlamia/ce.git`, `directory: packages/ce`), `homepage`, `bugs` and `keywords`. The version stays `0.1.0`.
- D4 The CI smoke job runs on Node 24 on every PR. It runs `npm ci`, then `npm pack --workspace continuous-evidence`, then sets up an empty temp dir with `git init` and package.json `{"scripts":{"dev":"vite"}}`, then `npm i -D <tgz>`. It then asserts:
  - `npx ce --version` equals the package version
  - `npx ce init` exits 0, and the written `ce.yml` passes the loader. The check runs a Node script in the temp dir: `import { loadConfig } from 'continuous-evidence'` (exported from `src/index.ts`; resolved through `main`) and assert `loadConfig({ cwd, flags: {}, env: {} }).ok === true`. The env is empty on purpose, so `CE_*` variables in CI cannot affect the result. This rules out `fileError` and schema errors alike.
  - `env -u OPENROUTER_API_KEY npx ce run` exits 1, and the combined stdout and stderr contain `OPENROUTER_API_KEY` and `Outcome: ERROR`. Config validity is proven separately by the `loadConfig` assertion.
  - a second `npx ce init` exits 1
  - the tarball file list has no test artifacts and the shebang is present

  The smoke logic lives in `scripts/smoke-pack.mjs`, so it can also run locally.
- D5 `release.yml` runs on a push of a semver tag matching `v[0-9]+.[0-9]+.[0-9]+*` (user decision). Floating tags such as the existing `v0` Action tag must never trigger it. It uses `permissions: id-token: write, contents: read`, `ubuntu-latest`, Node 24 with `registry-url`, and no cache. Its steps:
  1. fail fast if the tag version differs from `packages/ce/package.json`
  2. install npm ≥ 11.5.1 when the bundled npm is older, then assert the version
  3. `npm ci`
  4. `npx playwright install --with-deps chromium` (the tests need it, as in `ci.yml`)
  5. typecheck, test, build
  6. run the smoke script
  7. `npm publish --workspace continuous-evidence --access public`, adding `--tag next` when the version has a prerelease suffix

  No `NODE_AUTH_TOKEN` secret is used.
- D6 Root README: a Quick start with `npm i -D continuous-evidence && npx ce init`, or `npm i -g continuous-evidence && ce init`, or `npx continuous-evidence init`. It warns that bare `npx ce` without the package installed pulls the unrelated `ce` package. A "Releasing" section is the maintainer runbook:
  1. `npm login`
  2. `npm publish --workspace continuous-evidence --access public` (first publish only)
  3. configure the trusted publisher on npmjs.com (repo `rfxlamia/ce`, workflow `release.yml`)
  4. tag the next release promptly
  5. optionally set "Require 2FA and disallow tokens"

```gherkin
Scenario: clean-checkout pack is lean and runnable
  Given a checkout with no packages/ce/dist
  When  `npm pack --workspace continuous-evidence`
  Then  the tarball has dist/cli.js with the shebang and zero *.test.* / testsupport / arbitraries / scripts files

Scenario: fresh repo onboarding
  Given an empty git repo with package.json {"scripts":{"dev":"vite"}}
  When  the tarball is installed with `npm i -D` and `npx ce init` runs
  Then  ce.yml is written and passes the loader

Scenario: first run without key
  Given that repo and no OPENROUTER_API_KEY
  When  `npx ce run`
  Then  exit 1 and the output names OPENROUTER_API_KEY

Scenario: version mismatch blocks release
  Given tag v0.2.0 and package.json version 0.1.0
  When  release.yml runs
  Then  the job fails before npm publish

Scenario: prerelease goes to next
  Given tag v0.2.0-rc.1 matching package.json
  When  release.yml publishes
  Then  npm publish uses --tag next
```

---

## Acceptance Criteria

Mapped to the issue #13 checklist.

```
ACCEPTANCE CRITERIA — ce init + npm distribution
Date: 2026-11-28 | Scope confirmed: yes

Rule: Detect and write commented ce.yml            [issue: detect dev script, port, framework hints]
  ✓ Given vite dev script + npm lock, When ce init, Then start "npm run dev", url localhost:5173, vite comment
  ✓ Given explicit -p/--port/PORT=, When ce init, Then that port (1–65535) is used
  ✓ Given pnpm/yarn/bun lock or packageManager, When ce init, Then "<pm> run <script>"
  ✓ Given no/invalid package.json or no script, When ce init, Then valid template with target commented, exit 0
  ✓ Given hostile script text, When ce init, Then output still validates and no injected key
  ✓ Property: every generated file passes readAndParseConfigFile + ConfigSchema

Rule: Never overwrite without --force             [issue: never overwrite without --force]
  ✗ Given ce.yml or .ce.yml exists, When ce init, Then exit 1, file unchanged, stderr names --force
  ✓ Given config exists, When ce init --force, Then the discovered file is atomically replaced
  ✗ Given unknown flag / write error / ce.yml is a dir, When ce init, Then exit 1, nothing partial left

Rule: Next steps                                   [issue: print next steps (key env var, workflow snippet)]
  ✓ Given success, When ce init, Then stdout lists OPENROUTER_API_KEY, playwright install chromium, .gitignore, ce run, and a valid workflow snippet
  ✓ Given key set in env, When ce init, Then its value is never printed

Rule: Publishable package                          [issue: publish as continuous-evidence; shebang; smoke test]
  ✓ Given clean checkout, When npm pack --workspace continuous-evidence, Then lean tarball with shebanged dist/cli.js
  ✓ Given empty repo, When install tarball → ce init → ce run (no key), Then ce.yml valid and credential ERROR naming OPENROUTER_API_KEY
  ✓ CI runs the smoke test on every PR

Rule: Publish path                                 [issue: npm publish --workspace continuous-evidence --access public]
  ✓ README runbook documents the exact first-publish command (maintainer, manual, after merge)
  ✓ release.yml publishes later tags via OIDC, guarded by version match; prerelease → --tag next

Rule: README Quick start                           [issue: Quick start + bare npx ce warning]
  ✓ README shows npm i -g continuous-evidence && ce init, npx continuous-evidence init, and the npx ce warning

Rule: Done-when timing                             [issue: npm i -D → first ce run < 2 min]
  ✓ Smoke script prints elapsed time
  ✓ PR body records one measured, keyed local run in a temp vite app: npm i -D <tgz> → npx playwright install chromium → npx ce init → npx ce run reaching a non-config outcome against http://localhost:5173 (exercises the localhost assumption). Uses the maintainer's key only with explicit approval at that time.

OPEN QUESTIONS (risks if unresolved):
  - Chromium download time depends on network → assumed: fits within budget (~30–90 s); measured value goes in the PR.
  - localhost vs 127.0.0.1 on IPv6-first hosts → assumed: localhost; readiness error already names the URL.

OUT-OF-SCOPE (remind pocket-planning):
  - Running npm publish; non-JS detection; wizard; writing .gitignore/.env/workflow; README Action snippet bug.
```

**Closing note for the PR:** every checklist item except the actual `npm publish` execution is verifiable in the PR. Publishing is a documented manual step that the maintainer approved (user decision, 2026-11-28). The PR uses `Closes #13` and states that the first publish follows the merge.

---

## Design Decision

**Chosen option:** Option A, a pure detector, a template writer and a separate build config.

**Summary:** `src/init/detect.ts` is pure: it takes package.json text and a set of lockfile names, and returns `{pm, script, port, portSource, framework}`. `src/init/template.ts` is pure: it takes the detection result and returns the YAML text. `src/init/command.ts` holds `runInitCommand(argv, deps)` with the injected fs: guard, exclusive create, or temp-and-rename under `--force`, then the next steps. The lean tarball comes from `tsconfig.build.json`. `scripts/smoke-pack.mjs` is reused by CI and by the release workflow.

**Rejected options:**
- Option B, emitting through the `yaml` Document API: it is more code for mostly static comments. A string template plus a property round-trip test gives the same guarantee. Every scenario is satisfied either way, but B is costlier.
- Option C, a `files` allowlist with negation globs (`"!dist/**/*.test.*"`) instead of a build config: a stale `dist` could still ship removed files, and it leaves the testsupport and arbitraries modules compiled. It fails the "zero test artifacts from any local dist state" scenario unless `prepack` cleans anyway, and then the build config is simpler.
- Option D, a library for package-manager detection: it adds a runtime dep for about 10 lines (see Dependencies).

**Key tradeoffs accepted:**
- Framework port defaults are a hardcoded table, so new frameworks fall back to 3000 with a "check it" comment.
- The first publish is manual and the release workflow cannot be exercised end to end before that publish.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|---|---|---|
| Is the first publish automated? | No. It is manual by the maintainer after merge (user decision). OIDC is for later releases. | The issue is closed before the package is live. Mitigated by the runbook and the PR note. |
| `localhost` vs `127.0.0.1` | `localhost`, checked by the keyed run in the PR. The repo's own `.github/workflows/ce.yml` binds 127.0.0.1 to avoid ::1, so this is a known risk. If the keyed run fails on it, switch the template to `127.0.0.1` and add `--host 127.0.0.1` guidance. | On IPv6-first hosts the readiness timeout fires. |
| Release tag namespace | **Decided by the user: semver `vX.Y.Z`.** The trigger filter is `v[0-9]+.[0-9]+.[0-9]+*`, and the Action and npm release in lockstep. The floating `v0` tag never triggers a publish. If `v0.1.0` is re-pushed, npm rejects republishing 0.1.0, which is harmless. The runbook states the lockstep. | None |
| Unknown port | 3000 plus a comment | The readiness timeout tells the user to fix the port. |
| Monorepo root with no dev script | Template fallback | The user edits the target by hand. |
| Chromium download time | Within the 2-minute budget on a typical network | "Done when" misses on slow networks. Measured and reported in the PR. |
| Trusted publisher 48 h expiry | Runbook: configure, then tag promptly | The first OIDC release fails and must be reconfigured. |
| The credential ERROR lacks a "how to obtain a key" URL (R1.2) | Not in the #13 checklist; `init` next steps carry the URL | None for #13. |

---

## Implementation Notes

- Register `init` in the `src/cli.ts` switch and in the help text. `init` does not need `.env` loading. It reads `env` only to report "key already set".
- Do not add `README.md` and `LICENSE` to `files`: npm always includes them from the package directory. `LICENSE` is a copy of the root MIT license.
- The CI smoke job must not need Chromium or a key. It runs `ce run` with the key unset, so the run stops at the config stage.
- Keep `npm run build` at the root working. The root `build` script runs each workspace's `build`, which now uses `tsconfig.build.json`.
- The `release.yml` publish step uses no cache (npm guidance). It must not run on `pull_request` or `pull_request_target`.

## Rollback Plan

- Code: revert the PR. `init` is additive, and the build change only narrows the emitted files.
- A bad publish: `npm deprecate continuous-evidence@<v> "<reason>"`, then publish a fixed patch. Use `npm unpublish` only within the 72-hour window and only if nothing depends on the version.
- Release workflow: delete or disable `release.yml`. Publishing falls back to the manual runbook.
