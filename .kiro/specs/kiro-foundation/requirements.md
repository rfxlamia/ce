# Requirements Document

## Introduction

This feature sets up the `.kiro/` directory of the Continuous Evidence (CE) repository (GitHub issue #2 in rfxlamia/ce, "[M0] Kiro foundation: steering, hooks, Playwright MCP", milestone M0 Fondasi Kiro, label `kiro`). After this feature, every following issue can be specced and built inside Kiro without extra explanation from the developer.

The feature delivers four things: three steering documents (`product.md`, `tech.md`, `structure.md`), automation hooks (typecheck and tests on save, and a review hook that checks changed code against the MUST lines of `SPEC.md`), a Playwright MCP server configuration, and a guarantee that `.kiro/` is tracked by Git.

Source of truth for the steering content is `SPEC.md`, `README.md`, `docs/journal/v0.0/requirements.md`, and `docs/journal/v0.0/design.md` (section 2, "Package layout", and the dependency list). Steering documents are written in English, as are the existing project documents.

The Node.js baseline in this spec is 22.12 or later (22 or 24 LTS lines). This intentionally supersedes the "Node 20" text of issue #2, per a user decision.

## Glossary

- **Kiro_Workspace**: The `.kiro/` directory at the repository root of the CE repository.
- **Steering_Document**: A Markdown file in `.kiro/steering/` that Kiro loads as persistent project context.
- **Product_Steering**: The file `.kiro/steering/product.md`.
- **Tech_Steering**: The file `.kiro/steering/tech.md`.
- **Structure_Steering**: The file `.kiro/steering/structure.md`.
- **Hook**: A JSON file in `.kiro/hooks/` that runs a command or an agent prompt when a Kiro event fires.
- **Quality_Hook**: A Hook that runs the typecheck command and the test command after a TypeScript file is saved.
- **Review_Hook**: A Hook that checks changed code against the MUST and MUST NOT lines of `SPEC.md`.
- **MCP_Config**: The file `.kiro/settings/mcp.json`, which declares MCP servers for the workspace.
- **Playwright_MCP**: The Playwright Model Context Protocol server declared in the MCP_Config.
- **SPEC_File**: The file `SPEC.md` at the repository root, the normative CE specification.
- **Design_Journal**: The files `docs/journal/v0.0/requirements.md` and `docs/journal/v0.0/design.md`.
- **Gitignore_File**: The file `.gitignore` at the repository root.
- **Typecheck_Command**: The command `npm run typecheck` run from the repository root.
- **Test_Command**: The command `npm test` run from the repository root.
- **Next_Issue_Spec**: A Kiro spec created for any issue that follows this one, using only the Steering_Documents as project context.

## Requirements

### Requirement 1: Product steering

**User Story:** As a developer starting a new spec, I want Kiro to know what CE is, who it is for, and what it will not do, so that specs stay inside the product scope.

#### Acceptance Criteria

1. THE Kiro_Workspace SHALL contain Product_Steering at `.kiro/steering/product.md`.
2. THE Product_Steering SHALL state the problem CE addresses: the gap between a change that passes existing checks and the runtime evidence available for that change, as described in SPEC_File section 1.2.
3. THE Product_Steering SHALL state the primary audience: software developers and engineering teams, as described in SPEC_File section 1.3.
4. THE Product_Steering SHALL list the non-goals of CE v0: compliance-grade or audit-grade evidence, non-browser capabilities, a keyless or alternative classifier, acting as a merge gate or deploy gate by default, and writing to the target application or to Git.
5. THE Product_Steering SHALL list the four execution outcomes `SKIPPED`, `EVIDENCED`, `UNSUPPORTED`, and `ERROR`, and SHALL state that `SKIPPED` and `UNSUPPORTED` are distinct conditions.
6. THE Product_Steering SHALL name SPEC_File as the normative source and the Design_Journal as the derived source, and SHALL state that SPEC_File takes precedence when the two disagree.
7. THE Product_Steering SHALL use the always-included inclusion mode, so that Kiro loads the file in every session.

### Requirement 2: Technology steering

**User Story:** As a developer starting a new spec, I want Kiro to know the technology stack and the commands of the repository, so that generated designs and tasks use the right tools.

#### Acceptance Criteria

1. THE Kiro_Workspace SHALL contain Tech_Steering at `.kiro/steering/tech.md`.
2. THE Tech_Steering SHALL state the language and runtime: TypeScript on Node.js 22.12 or later (22 or 24 LTS lines), packaged as npm workspaces without a build orchestration framework.
3. THE Tech_Steering SHALL list the technologies named in the Design_Journal: Playwright (Chromium only) for browser runtime, Jev as the classifier accessed through OpenRouter by default, zod for configuration schemas, vitest for unit tests, and fast-check for property-based tests.
4. THE Tech_Steering SHALL state that the Jev provider is selected by configuration, with `OPENROUTER_API_KEY` for the `openrouter` provider and `TYPESAFE_API_KEY` for the `typesafe` provider, and SHALL state that secrets stay in environment variables and never in committed files.
5. THE Tech_Steering SHALL list the repository commands that exist at the time of writing: `npm install`, `npm run build`, and `npm run typecheck`, together with the Test_Command defined in Requirement 5.
6. THE Tech_Steering SHALL state the design rule that Jev chooses among options built from observed facts and never generates text, and that outcomes are decided by deterministic code, as described in Design_Journal design section 1.
7. THE Tech_Steering SHALL state that CI-run tests use a fake Jev gateway and need no API key.
8. THE Tech_Steering SHALL use the always-included inclusion mode.

### Requirement 3: Structure steering

**User Story:** As a developer starting a new spec, I want Kiro to know where code belongs, so that new files follow the planned layout.

#### Acceptance Criteria

1. THE Kiro_Workspace SHALL contain Structure_Steering at `.kiro/steering/structure.md`.
2. THE Structure_Steering SHALL reproduce the package layout of Design_Journal design section 2, including the directories `config/`, `context/`, `jev/`, `assessment/`, `runtime/`, `outcome/`, and `evidence/` under `packages/ce/src/`, together with the top-level `action/` and `schemas/` directories.
3. THE Structure_Steering SHALL describe the current repository layout: `SPEC.md`, `packages/ce/`, `examples/demo-app/`, and `docs/journal/`.
4. THE Structure_Steering SHALL state the responsibility of each directory in `packages/ce/src/` in one sentence.
5. THE Structure_Steering SHALL state that all Jev question text lives in `jev/catalog.ts` and that the outcome is decided only in `outcome/resolve.ts`.
6. THE Structure_Steering SHALL state where Kiro specs live (`.kiro/specs/<feature-name>/`) and that each spec derives from the Design_Journal and SPEC_File.
7. THE Structure_Steering SHALL use the always-included inclusion mode.

### Requirement 4: Steering sufficiency for the next spec

**User Story:** As a developer, I want to create the spec for the next issue without re-explaining the project, so that Kiro is useful from the first prompt.

#### Acceptance Criteria

1. WHEN a Next_Issue_Spec is created in a new Kiro session, THE Kiro_Workspace SHALL provide Product_Steering, Tech_Steering, and Structure_Steering as the project context for that spec.
2. THE Steering_Documents SHALL reference SPEC_File and the Design_Journal by repository-relative path, so that Kiro can open them on demand.
3. THE Steering_Documents SHALL contain no statement that contradicts SPEC_File.
4. THE Steering_Documents SHALL contain no secret, API key, or credential value.
5. THE Steering_Documents SHALL use one term per concept, matching the terms of SPEC_File: Change, Subject, Claim, Check, Assessment, and Evidence.

### Requirement 5: Typecheck and tests on save

**User Story:** As a developer, I want type errors and failing tests reported as soon as I save a file, so that I catch regressions during the spec task loop.

#### Acceptance Criteria

1. THE Kiro_Workspace SHALL contain a Quality_Hook as a JSON file in `.kiro/hooks/`.
2. WHEN a file matching `packages/**/*.ts` or `packages/**/*.tsx` is saved, THE Quality_Hook SHALL run the Typecheck_Command and then the Test_Command.
3. THE repository root `package.json` SHALL define a `test` script that runs the vitest suites of all workspaces.
4. WHERE a workspace contains no test files, THE Test_Command SHALL exit with status 0.
5. IF the Typecheck_Command exits with a non-zero status, THEN THE Quality_Hook SHALL report the compiler output to the Kiro session.
6. IF the Test_Command exits with a non-zero status, THEN THE Quality_Hook SHALL report the failing test names and messages to the Kiro session.
7. THE Quality_Hook SHALL complete within the hook timeout of 120 seconds for the current repository size.
8. THE Quality_Hook SHALL run without requiring a Jev credential.

### Requirement 6: SPEC review hook

**User Story:** As a reviewer, I want changed code checked against the normative MUST lines of the SPEC, so that violations of the CE contract are caught before a pull request.

#### Acceptance Criteria

1. THE Kiro_Workspace SHALL contain a Review_Hook as a JSON file in `.kiro/hooks/`.
2. WHEN the Review_Hook runs, THE Review_Hook SHALL instruct the agent to read the lines of SPEC_File that contain the capitalized keywords MUST or MUST NOT.
3. WHEN the Review_Hook runs, THE Review_Hook SHALL instruct the agent to compare the changed code in the working tree against each of those lines.
4. WHEN the agent finds a changed line of code that conflicts with a MUST or MUST NOT line, THE Review_Hook SHALL instruct the agent to report the SPEC_File section number, the quoted requirement, the file path, and the line range of the conflict.
5. WHEN the agent finds no conflict, THE Review_Hook SHALL instruct the agent to report that no conflict was found and which SPEC_File sections were checked.
6. THE Review_Hook SHALL instruct the agent to treat SPEC_File as the authority when SPEC_File and the Design_Journal disagree.
7. THE Review_Hook SHALL run on a manual trigger or on the end of an agent turn, and SHALL NOT run on every file save.
8. THE Review_Hook SHALL instruct the agent to report findings only and to leave the changed code unmodified.

### Requirement 7: Playwright MCP configuration

**User Story:** As a developer, I want Kiro to drive a browser through Playwright MCP, so that I can inspect the demo app and CE evidence while building.

#### Acceptance Criteria

1. THE Kiro_Workspace SHALL contain MCP_Config at `.kiro/settings/mcp.json`.
2. THE MCP_Config SHALL declare a server named `playwright` that starts the Playwright MCP package through `npx`.
3. THE MCP_Config SHALL contain valid JSON that Kiro loads without a parse error.
4. THE MCP_Config SHALL contain no secret, API key, or credential value.
5. WHERE the declared Playwright_MCP tools are used, THE MCP_Config SHALL list in `autoApprove` only read-only tools such as page snapshot and screenshot tools, so that actions that change page state need user approval.
6. THE Tech_Steering SHALL state that Playwright_MCP serves developer inspection inside Kiro and is separate from the Playwright library used by the CE Capability Runtime.

### Requirement 8: Kiro directory is tracked by Git

**User Story:** As a team member, I want `.kiro/` committed to the repository, so that everyone shares the same steering, hooks, and specs.

#### Acceptance Criteria

1. THE Gitignore_File SHALL contain no pattern that matches `.kiro/` or any file inside the Kiro_Workspace.
2. WHEN `git check-ignore` is run on each file created by this feature, THE Git command SHALL report that the file is not ignored.
3. WHEN a developer opens the repository after cloning, THE Kiro_Workspace SHALL contain the Steering_Documents, the Hooks, the MCP_Config, and the specs created by this feature.

### Requirement 9: Verifiable completion

**User Story:** As the issue owner, I want an objective way to confirm the foundation is complete, so that issue #2 can be closed with confidence.

#### Acceptance Criteria

1. THE Kiro_Workspace SHALL contain exactly these deliverables of issue #2: `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, one Quality_Hook, one Review_Hook, and `.kiro/settings/mcp.json`.
2. WHEN a new Kiro session creates a spec for a sample following issue using only the Steering_Documents as project context, THE generated spec SHALL name the correct language, test libraries, source directory, and normative document without a clarifying question from the developer.
3. WHEN the Typecheck_Command is run on the repository after this feature is applied, THE Typecheck_Command SHALL exit with status 0.
4. THE repository root `package.json` and `packages/ce/package.json` SHALL each declare `engines.node` as `>=22.12`.
