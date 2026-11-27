# Implementation Plan: Landing Page Skeleton

## Overview

This plan implements `requirements.md` and `design.md` for issue #17, "[M6] Landing page skeleton (React) at apps/site". The language is TypeScript (React 19, Vite 6, vitest with happy-dom, fast-check), as the design specifies.

Order of work: scaffold the workspace, build pure helpers and content, build the components, wire the `App`, add the example and scan tests, add the Pages workflow and the PR checklist, then run the manual and admin steps that put the Site live and close issue #17.

Tasks marked **[MANUAL]** need a human or a repository administrator. A coding agent MUST NOT attempt them. They are included so that Requirements 11 (criteria 5, 12, 13), 12 and 14 are traceable to a task.

## Tasks

- [x] 1. Scaffold the `@ce/site` workspace package
  - [x] 1.1 Create the package, configuration and lockfile entry
    - Add `"apps/*"` to `workspaces` in the root `package.json`, keeping `packages/*`, `examples/*` and `action`
    - Create `apps/site/package.json` exactly as in the design (name `@ce/site`, `private`, `type: module`, scripts `dev`, `build`, `preview`, `typecheck`, `test`; runtime dependencies `react` and `react-dom` only; devDependencies with the ranges listed in the design, including `@vitejs/plugin-react ^5.2.0`)
    - Create `apps/site/tsconfig.json` (same options as `examples/demo-app`, plus `"jsx": "react-jsx"`, `include: ["src", "tests", "vite.config.ts"]`)
    - Create `apps/site/vite.config.ts` using `defineConfig` from `vitest/config`, with `base` `/ce/` on `build` and `/` otherwise, the react plugin, and the `test` block (`environment: 'happy-dom'`, `include: ['tests/**/*.test.{ts,tsx}']`)
    - Create `apps/site/index.html` with charset, viewport, `<title>`, `<link rel="icon" href="data:," />`, `<div id="root">` and `<script type="module" src="/src/main.tsx">`; no `<style>` block and no third-party URL
    - Run `npm install` at the repository root and commit the regenerated root `package-lock.json`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.10, 1.13, 10.2, 10.3, 10.4, 12.4_

- [x] 2. Implement pure helpers and static content
  - [x] 2.1 Implement `src/lib/tabs.ts` and `src/lib/dialog.ts`
    - `nextTabIndex(current, key, count)`: ArrowRight `(c+1)%n`, ArrowLeft `(c-1+n)%n`, Home `0`, End `n-1`
    - `shouldCloseOnBackdropClick(targetIsDialog, x, y, rect)`: true only if `targetIsDialog` and the point is strictly outside the rectangle
    - _Requirements: 5.5, 5.6, 8.8_

  - [x] 2.2 Write property test for the backdrop click rule
    - Create `apps/site/tests/dialog.property.test.ts`
    - **Property 4: Backdrop click closes only for a dialog-targeted click outside the rectangle**
    - Include the case `(0, 0)` with `targetIsDialog` false returning `false`; at least 100 runs; tag comment `Feature: landing-page-skeleton, Property 4`
    - **Validates: Requirements 8.8**

  - [x] 2.3 Implement `src/content/snippets.ts`, `sections.ts` and `outcomes.ts`
    - `CONFIG_SNIPPET`: the `ce.yml` from the design (`version`, `target.start`, `target.url`, `target.ready.path`, `target.ready.timeout`)
    - `ACTION_SNIPPET`: copy the first `yaml` block under `## GitHub Action` in `README.md` verbatim
    - If that README block lacks an element that Requirement 7 criteria 4 or 5 need, update the README block in the same change so both stay identical
    - `SECTIONS`: ids `problem`, `how-ce-decides`, `sample-report`, `quick-start` with titles in that order
    - `OUTCOMES`: the three definitions `SKIPPED`, `EVIDENCED`, `UNSUPPORTED` with the panel text required by Requirement 5 criteria 8 to 10, upper-case names only, avoiding every forbidden phrase of Requirement 3 criteria 6 and 7
    - _Requirements: 3.1, 3.2, 3.6, 3.7, 5.1, 5.8, 5.9, 5.10, 5.13, 7.2, 7.3, 7.4, 7.5, 7.9, 7.13, 8.12_

- [x] 3. Implement the components
  - [x] 3.1 Implement `CopyButton` and `SnippetBlock`
    - `src/components/CopyButton.tsx`: `<button type="button">` with constant visible text from `label`, no `aria-label`, and an always-present `aria-live="polite"` status span, empty until an attempt
    - Click handler per the design: increment attempt ref, clear timer, `await navigator.clipboard.writeText(text)` in `try/catch` (a missing clipboard also lands in `catch`), drop stale results, set "Copied" or "Copy failed", reset to empty after 2000 ms, clear the timer on unmount
    - `src/components/SnippetBlock.tsx`: `<pre><code>{text}</code></pre>` followed by `CopyButton` with the same `text`
    - _Requirements: 7.1, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [x] 3.2 Write property test for the copy round trip
    - Create `apps/site/tests/helpers/clipboard.ts` (fake clipboard that records `writeText` calls and can resolve, reject or be absent) and `apps/site/tests/copy.property.test.tsx`
    - **Property 1: Copy writes exactly the displayed text**
    - Use arbitrary strings (empty, Unicode, newlines, braces, `${{ }}`) plus the two real snippets; unmount between runs; at least 100 runs
    - **Validates: Requirements 9.2, 9.8, 13.6**

  - [x] 3.3 Write property test for the copy status lifecycle
    - Create `apps/site/tests/copy-status.property.test.tsx` using the fake clipboard from 3.2 and `vi.useFakeTimers()`
    - **Property 3: Copy status follows the latest attempt and resets**
    - Generate sequences of attempts with results `ok`, `reject`, `absent` and gaps from 0 to 4000 ms; check the status model and the reset within 3000 ms of the latest attempt
    - **Validates: Requirements 9.5, 9.6, 9.7**

  - [x] 3.4 Implement `OutcomeTabs`
    - `src/components/OutcomeTabs.tsx`: state `selected` starting at 0, ids from `useId()`, `role="tablist"` with `aria-label`, `<button type="button" role="tab">` with `aria-selected`, `aria-controls`, roving `tabIndex` (0 for selected, -1 for others)
    - `role="tabpanel"` panels with `aria-labelledby` and `hidden` when not selected
    - `onKeyDown` for ArrowRight, ArrowLeft, Home, End: `preventDefault`, use `nextTabIndex`, set selection and move focus through a ref array; click, Enter and Space rely on the native button `click`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 3.5 Write property test for the tab selection invariant
    - Create `apps/site/tests/tabs.property.test.tsx`
    - **Property 2: Tab selection invariant under any interaction sequence**
    - Sequences of up to 30 steps from click tab `i`, ArrowRight, ArrowLeft, Home, End; after each step check one selected tab, roving tabindex, exactly one visible panel, the `aria-controls` and `aria-labelledby` links, and the index against `nextTabIndex`
    - **Validates: Requirements 5.2, 5.4, 5.5, 5.6, 5.7, 13.7**

  - [x] 3.6 Implement `ConfigModal`
    - `src/components/ConfigModal.tsx`: "View ce.yml" button calling `ref.current?.showModal()`; native `<dialog aria-labelledby>` with an `<h2>`, a Close button as the first focusable element calling `close()`, and `SnippetBlock` with `CONFIG_SNIPPET` and label "Copy ce.yml"
    - `onClick` on the dialog calls `shouldCloseOnBackdropClick(e.target === e.currentTarget, e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())` and closes on `true`
    - No React open state, no `autoFocus`, no custom focus trap, no Escape handler, no `::backdrop` CSS
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.14, 8.15_

  - [x] 3.7 Implement `SampleReport`
    - `src/components/SampleReport.tsx`: visible statement that the report is an illustrative example and not a real CE run; `<dl>` with labelled fields Outcome (`EVIDENCED`), Change, Claim, Subject, Actions performed, Observations obtained, Where the Evidence can be inspected
    - Text and semantic HTML only: no image, no link, no secret-like value, no personal data
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 4. Wire the page together
  - [x] 4.1 Implement `App`, `main.tsx` and `styles.css`
    - `src/App.tsx`: one `<h1>`, `<nav aria-label="Sections">` with a `<ul>` of links `#problem`, `#how-ce-decides`, `#sample-report`, `#quick-start`, then four `<section id aria-labelledby>` each with an `<h2>`, then `ConfigModal`
    - Problem copy: a Change can pass Checks while its behavior when executed stays unproven; CE produces inspectable Evidence from runtime observation; CE does not repeat verification that existing Checks already provide adequately; "CE does not promise that every Change is correct"
    - How CE decides copy: deterministic code decides the Outcome and a model answer does not decide it directly; `OutcomeTabs`; a paragraph outside the panels saying `ERROR` means the CE process failed to complete
    - Sample report: `SampleReport`
    - Quick start copy: `SnippetBlock` for the Config_Snippet ("Copy ce.yml") and the Action_Snippet ("Copy workflow"); an OpenRouter API key is required in v0 and stored as the repository secret `OPENROUTER_API_KEY`; the Action posts an evidence comment and uploads Evidence as a workflow artifact; no claim of a hosted report and no mention of `publish: branch`
    - `src/main.tsx`: `createRoot(document.getElementById('root')!).render(<App />)` and import `styles.css`
    - `src/styles.css`: at most 40 lines, only `font-family`, `max-width`, `margin` and `overflow-x: auto` on `pre`
    - Use no placeholder text, no forbidden phrases, no `data-*` test attributes, no inline `style`, and imports only from `react`, `react-dom` and relative paths
    - Run `npm run build` and `npm run typecheck` for `@ce/site` and fix errors
    - _Requirements: 1.8, 1.9, 1.11, 1.12, 1.14, 2.1, 2.2, 2.3, 2.6, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 5.11, 5.12, 7.6, 7.7, 7.8, 10.1, 10.3, 10.4, 10.6_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add example and scan tests under `apps/site/tests/`
  - [x] 6.1 Write page-structure and copy-rule tests
    - Structure: one `<h1>`, four `<h2>` in order, nav links resolve to Section ids
    - Scan `document.body.textContent` (including the closed dialog) for placeholders and forbidden phrases, case-insensitively; Outcome names appear in upper case only
    - Spy on `fetch`, `XMLHttpRequest` and `WebSocket` during render and interactions to confirm no network request
    - Every `button` and `tab` has a non-empty accessible name
    - Content assertions for Requirements 4, 5.8 to 5.12 and 6 (including no link, no image, no secret-like string in the Sample_Report)
    - _Requirements: 2.6, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 13.5_

  - [x] 6.2 Write snippet validation tests
    - Validate `CONFIG_SNIPPET` against `schemas/ce.schema.json` with `new Ajv({ strict: false, validateFormats: false, allErrors: true })` and no `ajv-formats`
    - Parse `ACTION_SNIPPET` with `yaml`: `pull_request` trigger, permissions `contents: read` and `pull-requests: write`, `fetch-depth: 0`, install step, `rfxlamia/ce@v0`, `OPENROUTER_API_KEY` through the secret reference, no literal key
    - Fail if a `with:` key is not in `action.yml` `inputs`; fail if `action.yml` is missing or lacks `runs.using: node24`
    - Compare the first `yaml` block under `## GitHub Action` in `README.md` with `ACTION_SNIPPET` after normalizing line endings and trailing newlines
    - Check that the Quick start renders both snippets in `<pre><code>`, that the modal snippet equals the Quick start snippet, and that the page states no hosted report and no `publish: branch`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 8.12, 13.8_

  - [x] 6.3 Write modal, tabs and copy-button example tests
    - Modal: stub `HTMLDialogElement.prototype.showModal` and `close` where happy-dom lacks native behavior, with a comment documenting each stub; check the "View ce.yml" button, the heading-based name, the Close button, the shared snippet, the dialog without `open` while closed, and that after a dispatched `close` event a second activation calls `showModal` again
    - Tabs: initial `SKIPPED` selection with other panels `hidden`; click, Enter and Space activation
    - Copy buttons: three buttons with the labels from the design, `type="button"`, no `aria-label`, empty status element at first render, "Copied" and "Copy failed" texts
    - _Requirements: 5.3, 5.4, 8.1, 8.2, 8.3, 8.4, 8.6, 8.10, 8.11, 8.13, 8.15, 9.1, 9.3, 9.4, 9.9, 13.5_

  - [x] 6.4 Write source-scan and Style_Guard tests
    - Scan `apps/site/src/`, `apps/site/index.html` and the dependency fields of `apps/site/package.json`: only `react`, `react-dom` and relative imports; no reference to `continuous-evidence`, `packages/ce`, `action/` or other `@ce/*` packages; no `data-testid`, `data-test`, `data-cy`, `data-ce`; no inline `style`; no `autoFocus`, focus-trap or Escape-handler code; no `::backdrop`; no third-party `http(s)://` resource; runtime dependencies exactly `react` and `react-dom`; failure messages include the file path
    - Style_Guard test file (`style-guard.test.ts`): fail if `src/styles.css` exceeds 40 lines or declares `color`, `background*`, `border-radius`, `box-shadow`, `animation*` or `transition`; begin the file with a comment stating it is a snapshot of the "before" state and that the first pull request of issue #19 removes or relaxes it
    - _Requirements: 1.14, 2.1, 2.2, 2.3, 2.4, 2.5, 8.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 13.5_

  - [x] 6.5 Write workspace and workflow tests
    - Root `package.json` lists `apps/*`; `apps/site/package.json` defines `dev`, `build`, `preview`, `typecheck`, `test` with `test` equal to `vitest run --passWithNoTests`
    - Parse `.github/workflows/pages.yml`: triggers `push` to `main` and `workflow_dispatch`, no `pull_request`; `build` permissions exactly `contents: read` and `pages: read`; `deploy` permissions exactly `pages: write` and `id-token: write` with `needs: build`; `github-pages` environment with URL output; `concurrency` with `cancel-in-progress: false`; every `uses` pinned to a 40-character SHA; no `secrets.` reference; header comment states the Pages precondition
    - _Requirements: 1.2, 1.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 13.1, 13.4_

- [x] 7. Add the GitHub Pages workflow
  - [x] 7.1 Create `.github/workflows/pages.yml`
    - Header comment stating the precondition: a repository administrator enables Pages with source "GitHub Actions" once, before the first deployment, for example `gh api -X POST repos/rfxlamia/ce/pages -f build_type=workflow`; the workflow cannot enable Pages itself
    - Triggers `push` to `main` and `workflow_dispatch`; `concurrency` group `pages` with `cancel-in-progress: false`
    - Job `build` (permissions `contents: read`, `pages: read`): checkout and setup-node pinned to the same SHAs as `ci.yml`, `actions/configure-pages`, `npm ci`, `npm run build --workspace @ce/site`, `actions/upload-pages-artifact` with path `apps/site/dist`
    - Job `deploy` (`needs: build`, permissions `pages: write`, `id-token: write`, environment `github-pages` with `url` from the deployment step output): `actions/deploy-pages`
    - Look up the commit SHAs for the three Pages actions and add a version comment to each pinned `uses`
    - Read no secret
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13_

- [x] 8. Add the pull request checklist
  - [x] 8.1 Create `.ce/pr-checklist-issue-17.md`
    - Follow the format of the existing `.ce/pr-checklist-issue-*.md` files
    - Include the reviewer item "Core_Terms used as defined in `SPEC.md` section 3.2, one term per concept"
    - Include items for the manual steps in task 10 (Pages enabled, `pages: read` confirmed, Verification_Record posted on issue #17)
    - _Requirements: 3.5, 12.1, 12.8, 14.2_

- [x] 9. Checkpoint - Ensure all tests pass before the manual steps
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm ci`, `npm run typecheck`, `npm test` and `npm run build` at the repository root and confirm exit code 0 with the committed lockfile.

- [ ] 10. **[MANUAL]** Put the Site live and close issue #17 (human or repository administrator; not for a coding agent)
  - [~] 10.1 **[MANUAL, repository administrator]** Enable GitHub Pages with source "GitHub Actions"
    - Run once, before the first Pages workflow run: `gh api -X POST repos/rfxlamia/ce/pages -f build_type=workflow`, or enable it under Settings, Pages
    - The workflow `GITHUB_TOKEN` cannot do this. Without it, `deploy-pages` fails
    - Merge the pull request to `main` so the Pages workflow runs (or start it with `workflow_dispatch`)
    - _Requirements: 11.12, 11.13, 12.1_

  - [~] 10.2 **[MANUAL, maintainer]** Confirm `pages: read` is enough for the `build` job on the first run
    - Check that the `configure-pages` step in the first Pages workflow run passes with `pages: read`
    - If it fails on permissions, change the `build` job to `pages: write`, update the permissions test in 6.5, and record the change in the pull request as a design change
    - _Requirements: 11.5_

  - [~] 10.3 **[MANUAL, maintainer]** Verify the live Site at `https://rfxlamia.github.io/ce/` in a real browser
    - Raw `GET` returns 200 with a `<title>`, the `#root` container and the bundle reference under `/ce/`; the rendered page (after scripts run) has exactly one `<h1>` (R12.2)
    - Every JavaScript and CSS asset returns 200 under `/ce/`, and the favicon request stays inside the prefix (R12.3, R12.4)
    - No uncaught error, no `console.error`, no failed network request (R12.5)
    - All four Sections render and each navigation link works (R12.6)
    - Outcome tabs (click and keyboard), the Config_Modal (Escape closes, backdrop click closes, focus stays inside while open, focus returns to "View ce.yml" on close) and each Copy_Button behave as specified (R12.7, R8.9, R8.13)
    - Playwright MCP may be used for inspection
    - _Requirements: 8.9, 8.13, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [~] 10.4 **[MANUAL, maintainer]** Post the Verification_Record on issue #17 and close it
    - Comment on issue #17 with the Public_URL and the observed result of each of Requirement 12 criteria 1 to 7, including that an administrator enabled Pages
    - Confirm the issue checklist items map as in Requirement 14, then close the issue. Closing does not depend on CE running on the Site (R13.2 to R13.4 of the journal stay out of scope)
    - _Requirements: 12.1, 12.8, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

- [~] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Requirement 13.5 says the tests SHALL cover the listed requirements, so skipping them leaves Requirement 13 unmet.
- Task 10 is **[MANUAL]**: it needs a repository administrator or maintainer, and no coding agent should run it.
- Each task references specific requirements for traceability. Requirement 3.5 (Core_Terms) is verified by reviewer inspection through task 8.1, not by a test.
- Property tests validate Properties 1 to 4 from the design. Example and scan tests cover the static content, configuration and workflow.
- Native dialog behavior (top layer, backdrop, Escape, focus containment, focus return) cannot be verified in happy-dom. Task 10.3 covers it in a real browser.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "7.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "3.4", "3.7", "8.1"] },
    { "id": 3, "tasks": ["3.2", "3.5", "3.6"] },
    { "id": 4, "tasks": ["3.3", "4.1"] },
    { "id": 5, "tasks": ["5"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 7, "tasks": ["9"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["10.2"] },
    { "id": 10, "tasks": ["10.3"] },
    { "id": 11, "tasks": ["10.4"] },
    { "id": 12, "tasks": ["11"] }
  ]
}
```
