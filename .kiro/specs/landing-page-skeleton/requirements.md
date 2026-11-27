# Requirements Document

## Introduction

This feature implements GitHub issue #17 in rfxlamia/ce, "[M6] Landing page skeleton (React) at apps/site" (labels `dogfood`, `polish`; milestone "M6 Dogfood: CE inside CE"). It covers R13.1 of `docs/journal/v0.0/requirements.md`. `SPEC.md` is normative and wins on any conflict with this document or the journal.

The issue asks for a plain but complete landing page. It is the "before" state: issue #19 makes the page beautiful, one pull request at a time, so that CE has real visual Changes to verify. The page is therefore functional and deliberately unstyled. The page is the Subject that CE will later observe, and it must know nothing about CE.

The issue has five checklist items and a "Done when" line. All of them are in scope. Requirement 14 maps each one to the requirements that cover it.

### Facts verified in the repository

- F1. `apps/` does not exist. The root `package.json` declares the workspaces `packages/*`, `examples/*` and `action`. `apps/*` must be added for `apps/site` to be an npm workspace. The root scripts `build`, `typecheck` and `test` run with `--workspaces --if-present`, so a workspace takes part in `npm test` only if it defines a `test` script. A root `package-lock.json` is committed, and `npm ci` (used by `ci.yml` and the Pages_Workflow) fails when the lockfile does not match the workspaces.
- F2. `examples/demo-app` is the existing Vite app: package `@ce/demo-app`, `"type": "module"`, scripts `dev`, `build`, `preview`, `typecheck`, dev dependencies `typescript ^5.6.0` and `vite ^6.0.0`, and a `tsconfig.json` with `strict: true` and `noEmit: true`. It is the convention to follow.
- F3. The Action is implemented. `action.yml` exists at the repository root with `runs.using: node24` and a committed bundle in `action/dist/`. The tags `v0` and `v0.1.0` exist on the remote, so `uses: rfxlamia/ce@v0` resolves. The README "GitHub Action" section documents the inputs, the permissions (`contents: read`, `pull-requests: write`) and the secret `OPENROUTER_API_KEY`. The Action does not install the repository's dependencies, so a workflow needs a step such as `npm ci`.
- F4. The Action input `publish: branch` is not implemented. Evidence is uploaded as a workflow artifact. No hosted, public CE report exists yet.
- F5. `.github/workflows/` contains `ci.yml` (push to `main`, pull requests, Node 22.12, 24 and 26) and `ce.yml` (CE on pull requests, using `uses: ./` against `examples/demo-app`). Both pin third-party actions to commit SHAs. No workflow deploys to GitHub Pages.
- F6. The repository is public (`https://github.com/rfxlamia/ce`). The GitHub Pages API returns 404 for it, so Pages is not enabled. The default project Pages URL is `https://rfxlamia.github.io/ce/`, which serves the site under the path prefix `/ce/`. The workflow `GITHUB_TOKEN` cannot enable Pages, so a repository administrator must do it once, for example with `gh api -X POST repos/rfxlamia/ce/pages -f build_type=workflow`.
- F7. `schemas/ce.schema.json` is generated from the `ce.yml` zod schema, which is strict. `ce.yml` keys include `version`, `target.url`, `target.start`, `target.ready.path`, `target.ready.timeout`, `target.routes`, `context.*`, `assessment.*`, `runtime.*`, `jev.*` and `output.*`.
- F8. The four outcomes are `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` and `ERROR` (`SPEC.md` section 7.1). `SKIPPED` and `UNSUPPORTED` MUST NOT be treated as the same condition. The v0 capability catalog is browser-first, and the outcome is decided in deterministic code (`outcome/resolve.ts`), not by a model answer.
- F9. Out of scope, with owners elsewhere: CE running on pull requests that touch `apps/site/`, the fork-safety rule and the link to the latest CE report (R13.2, R13.3, R13.4), and visual design (issue #19). Pre-rendering is also out of scope: the Site is client-rendered by React, so a raw `GET` of the Public_URL returns the empty `#root` container, and the page content (including the `<h1>`) exists only after scripts run.
- F10. Versions already used in the repository: `vitest ^5.1.1` and `fast-check ^4.0.0` (`packages/ce`, `action`), `ajv ^8.0.0`, `typescript ^5.6.0` and `@types/node ^22.0.0` (`packages/ce` devDependencies), `yaml ^2.0.0` (`packages/ce` runtime `dependency`, resolved 2.9.1), `vite ^6.0.0` (`examples/demo-app`, resolved 6.4.5). `packages/ce` imports `{ Ajv } from 'ajv'` and `YAML from 'yaml'`. `schemas/ce.schema.json` contains `"format": "uri"` on `target.url`, and Ajv 8 without `ajv-formats` throws "unknown format" on it. The three schema tests in `packages/ce` (`src/config/properties/p03-json-schema-consistency.test.ts`, `src/evidence/schema.ajv-agreement.property.test.ts`, `src/run/pipeline.bundle.integration.test.ts`) all construct Ajv as `new Ajv({ strict: false, validateFormats: false, allErrors: true })`. `packages/ce/tsconfig.json` sets `include: ["src"]` and has no `jsx` option, and `examples/demo-app` also uses `include: ["src"]`, which would leave Site tests and `vite.config.ts` unchecked. The latest `@vitejs/plugin-react` 6.x requires `vite ^8`, so the Site_Package must pick a `@vitejs/plugin-react` release whose peer range includes its Vite version (5.x accepts `vite ^6`).
- F11. jsdom (checked on its `main` branch, 2026) declares `HTMLDialogElement` as an empty class, so `showModal()` and `close()` do not exist there (jsdom issue #3294). happy-dom implements `showModal()`, `show()` and `close()`, but `showModal()` only sets the `open` attribute: it has no top layer, no backdrop, no Escape handling, no focus containment and no inertness. These behaviors can be verified only in a real browser.
- F12. A click event that a browser fires from the keyboard (Enter or Space on a button) has `clientX` and `clientY` equal to 0. A backdrop-click detector that compares coordinates must therefore act only on clicks whose target is the `<dialog>` element itself.

## Glossary

- **Site**: The React landing page in `apps/site/`, published to GitHub Pages. It is the Subject for later dogfooding.
- **Site_Package**: The npm workspace package `@ce/site` located at `apps/site/`.
- **Pages_Workflow**: The GitHub Actions workflow file `.github/workflows/pages.yml` that builds and deploys the Site.
- **Public_URL**: `https://rfxlamia.github.io/ce/`, the GitHub Pages address of the Site.
- **Section**: A top-level region of the Site with its own heading and an `id` used for in-page navigation. The Sections are Problem, How CE decides, Sample report and Quick start.
- **Outcome_Tabs**: The interactive control in the How CE decides Section that shows one Outcome panel at a time.
- **Config_Modal**: The dialog that shows the `ce.yml` snippet.
- **Copy_Button**: A button that copies a code snippet to the system clipboard.
- **Config_Snippet**: The example `ce.yml` text shown on the Site.
- **Action_Snippet**: The example GitHub workflow text that uses `rfxlamia/ce@v0`.
- **Sample_Report**: The static, illustrative example of CE output shown on the Site. It is not a real CE run.
- **Outcome**: One of `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, `ERROR`, as defined in `SPEC.md` section 7.1.
- **Core_Terms**: Change, Subject, Claim, Check, Assessment, Evidence, as defined in `SPEC.md` section 3.2.
- **CE_Coupling**: Any import or dependency on a CE package, any `data-testid` (or equivalent test hook) added for CE, and any CE-specific runtime code in the Site.
- **Basic_Styling**: Browser default styling plus one stylesheet of at most 40 lines that sets only font family, maximum content width, margins and code-block overflow.
- **Style_Guard**: The test in the Site_Package that fails when the stylesheet exceeds the Basic_Styling limits (Requirement 10). It is a snapshot of the "before" state.
- **Copy_Status**: The `aria-live="polite"` element next to a Copy_Button that holds the text "Copied" or "Copy failed" and is otherwise empty.
- **Test_Environment**: The DOM environment in which the Site_Package vitest tests run. It is happy-dom (Requirement 13).
- **Scanned_Files**: The files that the CE_Coupling check inspects: every file under `apps/site/src/`, `apps/site/index.html`, and the dependency fields of `apps/site/package.json`.
- **Verification_Record**: The comment on issue #17 that lists the Public_URL and the observed result of each live-site check (Requirement 12).

## Requirements

### Requirement 1: Workspace package

**User Story:** As a maintainer, I want the Site to be a Vite, React and TypeScript package inside the npm workspaces, so that it builds and typechecks with the same commands as the rest of the repository.

#### Acceptance Criteria

1. THE Site_Package SHALL reside at `apps/site/` with the package name `@ce/site`, `"private": true` and `"type": "module"`.
2. THE root `package.json` SHALL list `apps/*` in `workspaces`, in addition to the existing entries.
3. THE Site_Package SHALL declare `react` and `react-dom` as its only runtime `dependencies`.
4. THE Site_Package SHALL declare as `devDependencies` only: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, and the test tooling that Requirement 13 needs, namely `vitest`, `fast-check`, `happy-dom`, `ajv`, `yaml`, and `@testing-library/*` packages if the tests use them.
5. WHERE `packages/ce`, `action` or `examples/demo-app` already declare a dependency or devDependency that the Site_Package also needs, THE Site_Package SHALL use the same version range (F10), including `@types/node ^22.0.0` and `yaml ^2.0.0`, except for `@vitejs/plugin-react`, whose version range SHALL accept the Vite version that the Site_Package uses. THE Site_Package SHALL declare `yaml` in `devDependencies` even though `packages/ce` declares it in `dependencies`, because the Site uses `yaml` only in tests.
6. THE Site_Package SHALL define the scripts `dev`, `build`, `preview`, `typecheck` and `test`, where `dev`, `build`, `preview` and `typecheck` match the script names of `examples/demo-app` and `test` runs `vitest run --passWithNoTests`, so that the root `npm test` runs the Site tests through `--workspaces --if-present`.
7. THE Site_Package SHALL provide a `tsconfig.json` with `strict: true`, `noEmit: true`, `"jsx": "react-jsx"` and `include` covering `src`, `tests` and `vite.config.ts`, so that `npm run typecheck` checks the Site tests and the Vite configuration as well as the Site source (F10).
8. WHEN `npm run build` runs at the repository root, THE Site_Package SHALL produce a static build in `apps/site/dist/` and exit with code 0.
9. WHEN `npm run typecheck` runs at the repository root, THE Site_Package SHALL typecheck with zero errors.
10. THE Site_Package SHALL configure the Vite `base` as `/ce/` when `command === 'build'` and as `/` otherwise, so that every production asset URL resolves under the Public_URL and the development server serves the Site at `/`.
11. WHEN `npm run dev --workspace @ce/site` runs, THE Site_Package SHALL serve the Site on a local HTTP port and respond to `GET /` with status 200.
12. WHEN `vite preview` runs for the Site_Package, THE preview server SHALL serve the production build under `/ce/`, because the build `base` is `/ce/`.
13. THE commit that adds the Site_Package SHALL include the updated root `package-lock.json`, so that `npm ci` succeeds with the new workspace.
14. THE Site_Package test suite SHALL fail IF any file under `apps/site/src/` imports a package other than `react`, `react-dom` and relative paths, so that the shipped bundle depends on `react` and `react-dom` only and the tooling packages of criterion 4 are used by tests and configuration only.

### Requirement 2: CE-unaware Subject

**User Story:** As a maintainer, I want the Site to know nothing about CE internals, so that CE verifies it as an outside observer and the dogfooding is honest.

#### Acceptance Criteria

1. THE Scanned_Files SHALL contain no import, `require`, dependency, devDependency or path reference to `continuous-evidence`, `packages/ce`, `action/` or any `@ce/*` package other than `@ce/site`.
2. THE Scanned_Files SHALL contain no `data-testid`, `data-test`, `data-cy` or `data-ce` attribute.
3. THE Site SHALL contain no code whose behavior depends on detecting CE, a test runner or an automation driver.
4. IF a Scanned_File contains a CE_Coupling, THEN THE repository's test suite SHALL fail with the offending file path in the message.
5. THE Site_Package SHALL keep its test files under `apps/site/tests/`, outside the Scanned_Files, and those test files MAY read repository files such as `action.yml`, `README.md` and `schemas/ce.schema.json` (Requirements 7 and 13).
6. THE Site SHALL give each interactive element an accessible name through visible text or ARIA attributes, so that an observer can locate it without test hooks.

### Requirement 3: Section structure and copy rules

**User Story:** As a visitor, I want a complete page with real copy for every Section, so that I can understand what CE is and how to adopt it.

#### Acceptance Criteria

1. THE Site SHALL render one `<h1>` and exactly four Sections, in this order: Problem, How CE decides, Sample report, Quick start.
2. THE Site SHALL give each Section an `<h2>` heading and an `id` attribute, and SHALL render a navigation list with one in-page link per Section.
3. WHEN a visitor activates a navigation link, THE Site SHALL move the viewport to the matching Section by its `id`.
4. THE Site SHALL contain no placeholder text, including "lorem ipsum", "TODO", "TBD" and "coming soon" (case-insensitive), in any rendered Section.
5. WHEN the Site names a concept covered by the Core_Terms, THE Site SHALL use the Core_Term spelled as defined in `SPEC.md` section 3.2, and SHALL use one term per concept. This criterion cannot be checked by an automated test, so it is verified by reviewer inspection, and THE pull request checklist SHALL contain an item "Core_Terms used as defined in `SPEC.md` section 3.2, one term per concept" that the reviewer ticks.
6. THE Site SHALL NOT contain, in any rendered text and case-insensitively, any of the phrases "AI-powered CI", "coding agent", "testing framework", "merge gate" or "deploy gate".
7. THE Site SHALL NOT contain, in any rendered text and case-insensitively, any of the phrases "guarantee" (which covers "guarantees" and "guaranteed"), "ensures correctness" or "bug-free".
8. THE forbidden phrases in criteria 6 and 7 SHALL apply to the whole rendered text with no exception for negation, and THE Site SHALL word every statement of what CE is not or does not provide (Requirement 4, criterion 4) without those phrases.
9. THE Site SHALL render every page text as static content that needs no network request after the initial page load.

### Requirement 4: Problem Section

**User Story:** As a visitor, I want the problem CE addresses stated clearly, so that I can decide whether it applies to my work.

#### Acceptance Criteria

1. THE Problem Section SHALL state that a Change can pass builds, tests and other Checks while its behavior when executed remains unproven (`SPEC.md` section 1.2).
2. THE Problem Section SHALL state that CE produces Evidence from runtime observation that a reader can inspect.
3. THE Problem Section SHALL state that CE does not repeat verification that existing Checks already provide adequately.
4. THE Problem Section SHALL state at least one thing CE does not provide, taken from `SPEC.md` section 1.4, for example that CE does not promise that every Change is correct, worded without the phrases forbidden by Requirement 3.

### Requirement 5: How CE decides Section and Outcome tabs

**User Story:** As a visitor, I want to read what each outcome means, one at a time, so that I understand when CE collects Evidence and when it does not.

#### Acceptance Criteria

1. THE How CE decides Section SHALL contain Outcome_Tabs with one tab for each of `SKIPPED`, `EVIDENCED` and `UNSUPPORTED`, labelled with those exact strings.
2. THE Outcome_Tabs SHALL use the ARIA roles `tablist`, `tab` and `tabpanel`, SHALL set `aria-selected` on the active tab, SHALL link each tab to its panel with `aria-controls`, and SHALL link each tabpanel to its tab with `aria-labelledby`.
3. WHEN the Site first renders, THE Outcome_Tabs SHALL show the `SKIPPED` panel, SHALL set `aria-selected="true"` on the `SKIPPED` tab only, and SHALL hide the other panels with the `hidden` attribute.
4. WHEN a visitor activates a tab by click, Enter or Space, THE Outcome_Tabs SHALL show only the matching panel, hide the other panels with the `hidden` attribute, and set `aria-selected="true"` on that tab only.
5. WHEN focus is on a tab and a visitor presses ArrowRight or ArrowLeft, THE Outcome_Tabs SHALL move focus and selection to the next or previous tab, wrapping at the ends.
6. WHEN focus is on a tab and a visitor presses Home or End, THE Outcome_Tabs SHALL move focus and selection to the first or the last tab.
7. THE Outcome_Tabs SHALL set `tabindex="0"` on the selected tab and `tabindex="-1"` on the other tabs (roving tabindex), and SHALL update these values whenever the selection changes.
8. THE `SKIPPED` panel SHALL state that the Assessment determined additional Evidence is not required, and that this is a valid result.
9. THE `EVIDENCED` panel SHALL state that runtime Evidence was collected and can be inspected.
10. THE `UNSUPPORTED` panel SHALL state that Evidence was required but the available capabilities were insufficient, and SHALL state that this differs from `SKIPPED` because CE could not produce Evidence that was needed.
11. THE How CE decides Section SHALL state that `ERROR` means the CE process failed to complete, in text outside the three tab panels.
12. THE How CE decides Section SHALL state that deterministic code decides the Outcome and that a model answer does not decide it directly.
13. THE Site SHALL use `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` and `ERROR` in upper case, and SHALL NOT use any other Outcome name.

### Requirement 6: Sample report Section

**User Story:** As a visitor, I want to see what CE output looks like, so that I know what I would get in a pull request.

#### Acceptance Criteria

1. THE Sample report Section SHALL show a Sample_Report with the Outcome `EVIDENCED`.
2. THE Sample_Report SHALL show, as separate labelled fields, the Change, the Claim, the Subject, the actions performed, the observations obtained, and where the Evidence can be inspected, matching the minimum content of `SPEC.md` section 7.2.
3. THE Sample report Section SHALL state in visible text that the Sample_Report is an illustrative example and not the result of a real CE run.
4. THE Sample_Report SHALL contain no secret-like value, no real API key and no real personal data.
5. THE Sample_Report SHALL NOT contain a link that claims to open a real CE report.
6. THE Sample_Report SHALL contain only text and semantic HTML, with no image file that the Site must fetch.

### Requirement 7: Quick start Section

**User Story:** As a developer, I want a quick start with a `ce.yml` and an Action snippet that I can copy, so that I can try CE on my repository.

#### Acceptance Criteria

1. THE Quick start Section SHALL show the Config_Snippet and the Action_Snippet, each in a `<pre><code>` block.
2. THE Config_Snippet SHALL be a valid `ce.yml` that passes validation against `schemas/ce.schema.json`.
3. THE Config_Snippet SHALL set `target.start`, `target.url` and `target.ready.path`.
4. THE Action_Snippet SHALL be a valid GitHub workflow that triggers on `pull_request`, grants `contents: read` and `pull-requests: write`, checks out with `fetch-depth: 0`, installs dependencies, and runs `rfxlamia/ce@v0`.
5. THE Action_Snippet SHALL pass `OPENROUTER_API_KEY` through `${{ secrets.OPENROUTER_API_KEY }}` in `env`, and SHALL contain no literal key value.
6. THE Quick start Section SHALL state that an OpenRouter API key (used by Jev, CE's classifier) is required in v0 and that the key is stored as the repository secret `OPENROUTER_API_KEY`.
7. THE Quick start Section SHALL state that the Action posts an evidence comment on the pull request and uploads the Evidence as a workflow artifact.
8. THE Quick start Section SHALL NOT state that CE publishes a hosted report, and SHALL NOT mention `publish: branch` as available.
9. THE Action_Snippet and the inputs it uses SHALL match `action.yml` and the README "GitHub Action" section at the commit that ships the Site. The README block (`## GitHub Action`, first `yaml` code block) already contains `on: pull_request`, the permissions `contents: read` and `pull-requests: write`, `fetch-depth: 0`, `npm ci`, `rfxlamia/ce@v0`, the `OPENROUTER_API_KEY` secret reference and the `with:` keys `target-start` and `target-ready-path`, so the README is the reference and THE Action_Snippet SHALL equal it.
10. IF `action.yml` is absent from the repository root or does not declare `runs.using: node24`, THEN THE Site_Package test suite SHALL fail, because the Site names `rfxlamia/ce@v0` as installable.
11. THE Site_Package test suite SHALL parse the Action_Snippet as YAML, read `action.yml`, and fail IF any key under `with:` in the Action_Snippet is not a key of `inputs` in `action.yml`.
12. THE Site_Package test suite SHALL read the first `yaml` code block under the `## GitHub Action` heading of `README.md` and fail IF its text, after normalizing line endings and trailing newlines, differs from the Action_Snippet displayed on the Site.
13. IF the README block lacks an element that criteria 4 or 5 require, THEN THE pull request that ships the Site SHALL update the README block in the same pull request, so that the README block and the Action_Snippet are identical at the commit that ships the Site.

### Requirement 8: Config modal

**User Story:** As a visitor, I want to open the configuration snippet in a dialog, so that I can read and copy it without leaving the page.

#### Acceptance Criteria

1. THE Site SHALL render a button with the visible text "View ce.yml" that opens the Config_Modal.
2. THE Config_Modal SHALL be a native `<dialog>` element, and THE Site SHALL open it by calling `showModal()`.
3. WHEN a visitor activates the "View ce.yml" button, THE Config_Modal SHALL open, show the Config_Snippet and place keyboard focus inside the dialog through the native focusing steps of `showModal()`, or through the plain HTML `autofocus` attribute on the intended element. THE Site SHALL NOT use the React `autoFocus` prop, because React calls `focus()` when the element mounts, and the dialog content is mounted while the dialog is closed.
4. THE Config_Modal SHALL take its accessible name from a heading in the dialog, referenced through `aria-labelledby`, and SHALL rely on the implicit dialog role of the `<dialog>` element.
5. THE Site SHALL leave the backdrop, Escape handling, focus containment and inertness of the rest of the page to the browser's native modal behavior, and SHALL contain no custom focus-trap code, no custom Escape handler and no CSS for `::backdrop`.
6. WHEN a visitor activates the Close button, THE Config_Modal SHALL close.
7. WHEN a visitor presses Escape while the Config_Modal is open, THE Config_Modal SHALL close through the native `cancel` behavior.
8. WHEN a click event has the `<dialog>` element itself as its target and its `clientX` and `clientY` lie outside the rectangle returned by the dialog's `getBoundingClientRect()`, THE Config_Modal SHALL close. The Site SHALL ignore clicks whose target is a descendant of the dialog, including keyboard-initiated clicks with coordinates 0, 0 (F12), and SHALL NOT depend on padding or other styling to detect a backdrop click.
9. WHEN the Config_Modal closes, THE browser's native behavior SHALL return focus to the "View ce.yml" button, and THE verification at the Public_URL (Requirement 12) SHALL confirm this.
10. WHILE the Config_Modal is closed, THE Site SHALL leave the dialog without the `open` attribute, so that the dialog content is absent from the accessibility tree.
11. THE Config_Modal SHALL contain a Copy_Button for the Config_Snippet.
12. THE Config_Snippet in the Config_Modal SHALL be identical, character for character, to the Config_Snippet in the Quick start Section.
13. THE Site_Package tests SHALL run in the Test_Environment, and WHERE a test needs a native behavior that the Test_Environment does not implement (top layer, backdrop, Escape, focus containment, inertness, focus return, or non-zero `getBoundingClientRect()` values), THE test SHALL stub that behavior explicitly and the stub SHALL be documented in a comment, with the native behavior itself verified in a real browser at the Public_URL.
14. THE Site SHALL listen to the native `close` event of the `<dialog>` element and SHALL keep no open or closed state separate from the `open` attribute of the dialog, so that closing through the Close button, Escape or a backdrop click cannot leave React state out of sync with the dialog.
15. WHEN the `<dialog>` element dispatches a `close` event after it was opened, THE Site_Package tests SHALL verify that a second activation of "View ce.yml" opens the Config_Modal again.

### Requirement 9: Copy button

**User Story:** As a developer, I want to copy a snippet with one click, so that I can paste it into my repository.

#### Acceptance Criteria

1. THE Site SHALL render a Copy_Button for the Config_Snippet and a Copy_Button for the Action_Snippet in the Quick start Section, and one Copy_Button inside the Config_Modal.
2. WHEN a visitor activates a Copy_Button, THE Copy_Button SHALL write the exact text of its snippet to the clipboard through `navigator.clipboard.writeText`.
3. THE Copy_Button SHALL keep a constant visible text, "Copy ce.yml" for the Config_Snippet and "Copy workflow" for the Action_Snippet, and SHALL have an accessible name equal to that visible text, with no `aria-label` that differs from it.
4. THE Site SHALL render one Copy_Status next to each Copy_Button, present in the document from the first render and empty until a copy attempt happens.
5. WHEN the clipboard write succeeds, THE Copy_Status SHALL show the text "Copied" and SHALL become empty again within 3 seconds.
6. IF the clipboard write fails or `navigator.clipboard` is unavailable, THEN THE Copy_Status SHALL show the text "Copy failed", SHALL become empty again within 3 seconds, and THE Site SHALL leave the snippet text selectable.
7. WHEN a visitor activates a Copy_Button while its Copy_Status is non-empty or after it has reset, THE Copy_Button SHALL perform a new copy attempt and restart the reset timer of its Copy_Status.
8. FOR ALL snippets, the text written to the clipboard SHALL equal the text displayed in the matching code block (round-trip property).
9. THE Copy_Button SHALL be a `<button type="button">`.

### Requirement 10: Deliberately unstyled

**User Story:** As a maintainer, I want the Site to stay plain, so that issue #19 can change its appearance one pull request at a time and CE has real visual Changes to verify.

#### Acceptance Criteria

1. THE Site SHALL apply only Basic_Styling.
2. THE Site_Package SHALL NOT depend on a CSS framework, a component library, a CSS-in-JS library, an icon library or a web font service.
3. THE Site SHALL contain no inline `style` attribute.
4. THE Site SHALL NOT load any resource from a third-party origin.
5. IF the stylesheet exceeds 40 lines or declares a color, background, border-radius, shadow or animation property, THEN THE Style_Guard SHALL fail the Site_Package test suite.
6. THE Site SHALL remain operable with Basic_Styling alone: every Section, tab, dialog and button SHALL work with no additional CSS.
7. THE Style_Guard SHALL be a snapshot of the "before" state, and the first pull request of issue #19 SHALL remove or relax the Style_Guard as part of its change.
8. THE Style_Guard test file SHALL contain a comment that states criterion 7.

### Requirement 11: GitHub Pages deployment

**User Story:** As a maintainer, I want the Site deployed automatically from `main`, so that the public URL always shows the current page.

#### Acceptance Criteria

1. THE Pages_Workflow SHALL reside at `.github/workflows/pages.yml`.
2. WHEN a commit is pushed to `main`, THE Pages_Workflow SHALL build the Site_Package and deploy `apps/site/dist/` to GitHub Pages.
3. WHERE a maintainer starts the Pages_Workflow manually, THE Pages_Workflow SHALL support `workflow_dispatch`.
4. THE Pages_Workflow SHALL NOT run a deployment on `pull_request` events.
5. THE Pages_Workflow SHALL contain two jobs: `build`, with the permissions `contents: read` and `pages: read` only, and `deploy`, with the permissions `pages: write` and `id-token: write` only, and `deploy` SHALL declare `needs: build`. The `build` job keeps the `actions/configure-pages` step and needs `pages: read` for it. The official `actions/starter-workflows` static Pages workflow grants `pages: write` to the job that runs `configure-pages` and does not document whether `pages: read` suffices, so `pages: read` is the least privilege chosen here and the first run of the Pages_Workflow SHALL confirm it.
6. THE Pages_Workflow SHALL use `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`, each pinned to a commit SHA, together with the checkout and setup-node steps pinned in the same way as `ci.yml`.
7. THE Pages_Workflow SHALL install dependencies with `npm ci` and build with the workspace build command for `@ce/site`.
8. THE Pages_Workflow SHALL use a `concurrency` group that does not cancel an in-progress deployment.
9. THE `deploy` job SHALL run in the `github-pages` environment and SHALL output the deployed URL.
10. THE Pages_Workflow SHALL read no secret.
11. IF the `build` job fails, THEN THE Pages_Workflow SHALL skip the `deploy` job and leave the previously deployed Site unchanged.
12. THE Pages_Workflow SHALL NOT attempt to enable GitHub Pages, because the workflow `GITHUB_TOKEN` cannot do so.
13. THE comment at the top of `pages.yml` SHALL state the precondition that a repository administrator enables Pages with the source "GitHub Actions" once, before the first deployment, for example with `gh api -X POST repos/rfxlamia/ce/pages -f build_type=workflow`.

### Requirement 12: Live and working Site

**User Story:** As a maintainer, I want to confirm the Site is live and every Section works at the Public_URL, so that issue #17 can be closed.

#### Acceptance Criteria

1. THE Verification_Record SHALL state that a repository administrator enabled GitHub Pages with the source "GitHub Actions" (Requirement 11, criterion 13) before the first run of the Pages_Workflow, because every other criterion of this Requirement depends on that precondition.
2. WHEN the Pages_Workflow completes on `main`, THE Public_URL SHALL respond to a raw `GET` (no script execution) with status 200 and an HTML document that contains a `<title>` element, the `#root` container and a reference to the built JavaScript bundle under `/ce/`. WHEN the Public_URL is loaded in a browser and its scripts have run, THE rendered document SHALL contain exactly one `<h1>`. The Site is client-rendered by React, so the raw HTML does not contain the `<h1>`, and pre-rendering is out of scope.
3. THE Public_URL SHALL serve every JavaScript and CSS asset the page references with status 200, with no 404 under the `/ce/` prefix.
4. THE `<head>` of `apps/site/index.html` SHALL contain `<link rel="icon" href="data:,">` or a link to a local favicon file inside `apps/site/`, so that the browser does not request `/favicon.ico` outside the `/ce/` prefix.
5. WHEN a visitor loads the Public_URL, THE Site SHALL produce no uncaught JavaScript error, no `console.error` message and no failed network request.
6. WHEN a visitor loads the Public_URL in a browser and scripts have run, THE Site SHALL render all four Sections and a working navigation link to each.
7. WHEN a visitor operates the Outcome_Tabs, the Config_Modal and each Copy_Button at the Public_URL in a real browser, THE Site SHALL behave as Requirements 5, 8 and 9 specify, including the native modal behaviors listed in Requirement 8, criterion 13.
8. WHEN the final verification runs, THE maintainer SHALL post the Verification_Record as a comment on issue #17 before closing it, listing the Public_URL and the observed result of each of criteria 1 to 7.

### Requirement 13: Automated verification of the Site

**User Story:** As a maintainer, I want automated tests for the Site's behavior, so that the skeleton stays correct without CE and without an API key.

#### Acceptance Criteria

1. WHEN `npm test` runs at the repository root, THE Site_Package SHALL run its tests with vitest through its `test` script and exit with code 0.
2. THE Site_Package tests SHALL need no API key, no network and no browser beyond the Test_Environment.
3. THE Test_Environment SHALL be happy-dom, because jsdom does not implement `HTMLDialogElement.showModal()` (F11), and Requirement 8, criterion 13 governs the native behaviors that happy-dom does not implement.
4. THE Site_Package tests SHALL reside under `apps/site/tests/` and MAY read `action.yml`, `README.md` and `schemas/ce.schema.json` from the repository root.
5. THE Site_Package tests SHALL cover Requirements 2, 5, 7, 8, 9 and 10 and Requirement 3 criteria 1 to 4 and 6 to 9, including the forbidden phrases of Requirement 3, criteria 6 and 7. Requirement 3, criterion 5 (one term per concept) is verified by review through the pull request checklist, not by a test.
6. THE Site_Package tests SHALL include a fast-check property that, for every snippet, the text copied equals the text displayed.
7. THE Site_Package tests SHALL include a fast-check property that, for any sequence of tab activations, exactly one tab has `aria-selected="true"` and `tabindex="0"`, exactly one panel is visible, and the visible panel belongs to the selected tab.
8. THE Site_Package tests SHALL validate the Config_Snippet against `schemas/ce.schema.json` with `ajv` and parse the Action_Snippet as YAML with `yaml`. THE tests SHALL construct Ajv with the same options as the schema tests in `packages/ce`, `new Ajv({ strict: false, validateFormats: false, allErrors: true })`, because `schemas/ce.schema.json` contains `"format": "uri"` and Ajv 8 without `ajv-formats` throws "unknown format" on it (F10). THE Site_Package SHALL NOT add `ajv-formats`.

### Requirement 14: Issue checklist traceability

**User Story:** As a maintainer, I want every checklist item of issue #17 mapped to requirements, so that implementing this spec lets the issue close.

#### Acceptance Criteria

1. THE checklist item "`apps/site/`: Vite + React + TypeScript, npm workspace, CE-unaware (no CE imports, no test ids added for CE)" SHALL be satisfied by Requirements 1 and 2.
2. THE checklist item "All sections present with real copy: the problem, how CE decides (SKIPPED / EVIDENCED / UNSUPPORTED), sample report, quick start (`ce.yml` + Action snippet)" SHALL be satisfied by Requirements 3, 4, 5, 6 and 7, where Requirement 3, criterion 5 is verified by review (Requirement 13, criterion 5).
3. THE checklist item "Interactive parts CE can exercise: outcome tabs, a modal with the config snippet, copy button" SHALL be satisfied by Requirements 5, 8 and 9.
4. THE checklist item "Deploy to GitHub Pages on push to main" SHALL be satisfied by Requirement 11.
5. THE checklist item "Deliberately unstyled beyond basics, this is the 'before'" SHALL be satisfied by Requirement 10.
6. THE "Done when: the public URL is live and every section works" line SHALL be satisfied by Requirement 12, with Requirement 13 as supporting automated evidence.
7. THE reference "R13 in docs/journal/v0.0" SHALL be satisfied for R13.1 by Requirements 1, 2 and 11, with the phrase "deployed to a public URL" satisfied by Requirements 11 and 12, and R13.2, R13.3 and R13.4 SHALL remain outside this spec (F9).
8. THE closing of issue #17 SHALL NOT depend on any CE-on-the-Site workflow, which belongs to R13.2 to R13.4.
