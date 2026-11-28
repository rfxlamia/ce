# Task T5 — `ce init` command, overwrite guard and CLI wiring

**Phase:** 2
**Depends:** T3, T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: `ce init` command, overwrite guard and CLI wiring [depends: T3, T4]

## OBJECTIVE
Create `packages/ce/src/init/command.ts` with `runInitCommand(argv, deps): Promise<number>` (or sync number) and `src/init/index.ts` re-export; route `init` in `src/cli.ts` and the help text.

Deps contract: `{ cwd: string; env: Record<string,string|undefined>; stdout: Writable; stderr: Writable; fs?: InitFs }` where `InitFs` = `{ lstat, stat, readFile, writeFile(path, data, { flag }), rename, unlink }` (sync, node:fs-compatible), defaulting to `node:fs` — injected only to simulate write failures.

Steps:
1. Write failing test for: init writes a detected config end to end (cross-unit: detect → template → next steps → fs)
   Test file: `packages/ce/src/init/command.test.ts`
   Level: integration
   Test intent: Given a temp dir with package.json {"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6"}} and package-lock.json / When runInitCommand([], deps with real fs) / Then exit 0, `ce.yml` exists and `loadConfig({ cwd, flags: {}, env: {} }).ok` is true with target.url http://localhost:5173, stdout contains next steps, stderr empty
   Exercise through: `runInitCommand`
   Test doubles: stdout/stderr capture objects only
   Expected RED: module does not exist
2. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/command.test.ts`
3. Implement the happy path only: read package.json, collect lockfile names, detect → render, create with `wx`, print next steps. Do NOT yet add argv validation, --force, read-error/unparseable notes or existence checks (each gets its own RED cycle below). → PASS → refactor while green. Commit `feat(init): add ce init command`.
4. Write failing test for: overwrite guard (B0, B1, B2, repeat run)
   Test file: `packages/ce/src/init/command.test.ts`
   Level: integration
   Test intent: Given ce.yml with custom content / When init / Then exit 1, file byte-identical, stderr "ce.yml already exists; re-run with --force to overwrite". Given only .ce.yml → exit 1, no ce.yml created, stderr names .ce.yml. Given init succeeded once, second run → exit 1, byte-identical. Given ce.yml is a directory → exit 1 with the same "already exists" message. Given a dangling symlink ce.yml → exit 1 "already exists". Given an injected fs whose `wx` write throws EEXIST (file appeared after the lstat check) → exit 1 with the same message, no overwrite
   Exercise through: `runInitCommand`
   Test doubles: injected `fs` only for the EEXIST race case
   Expected RED: the `.ce.yml`-only case creates a new ce.yml today (wx does not protect it), and no case prints the exact "already exists; re-run with --force to overwrite" message (wx surfaces a raw EEXIST)
5. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/command.test.ts -t "guard"`
6. Implement lstat-based existence check → PASS → refactor while green. Commit `feat(init): refuse to overwrite existing config`.
7. Write failing test for: --force semantics and atomic replace (B3, B5)
   Test file: `packages/ce/src/init/command.test.ts`
   Level: integration
   Test intent: Given ce.yml exists, `--force` → ce.yml replaced with generated content, exit 0. Given only .ce.yml, `--force` → .ce.yml rewritten, no ce.yml. Given both files, `--force` → ce.yml rewritten and stderr notes .ce.yml stays ignored. Given ce.yml directory + .ce.yml file, `--force` → .ce.yml rewritten, exit 0. Given ce.yml directory only, `--force` → exit 1, stderr names ce.yml and EISDIR, no temp file left in cwd. Given ce.yml exists and injected fs `rename` throws ENOSPC → original byte-identical, temp file removed, exit 1, stderr names ce.yml + ENOSPC, stdout has no success text. Given injected `writeFile` throws EACCES on create (no --force) → exit 1 with EACCES
   Exercise through: `runInitCommand`
   Test doubles: injected `fs` for ENOSPC / EACCES only
   Expected RED: --force not implemented
8. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/command.test.ts -t "force"`
9. Implement target selection via stat-isFile (mirrors discoverConfigFile), temp file `.<name>.<random>.tmp` in cwd, rename, cleanup on error → PASS → refactor while green. Commit `feat(init): replace config atomically under --force`.
10. Write failing test for: argv contract and fallback/stdout-stderr split (B4, B6, A8)
    Test file: `packages/ce/src/init/command.test.ts`
    Level: integration
    Test intent: Given `--bogus` or a positional `foo` → usage on stderr, exit 1, no file. Given empty dir → exit 0, template written, next steps start with "edit target in ce.yml". Given package.json "{ not json" → exit 0, stderr contains "package.json could not be parsed", stdout has next steps. Given package.json is a directory (unreadable) → exit 0, template written, stderr notes package.json could not be read. Given deps.env OPENROUTER_API_KEY "sk-test-123" with a vite project → exit 0 and neither captured stdout nor stderr contains "sk-test-123" (C3 through the command path)
    Exercise through: `runInitCommand`
    Test doubles: none
    Expected RED: today `--bogus` and positional args are ignored and a file is written (exit 0), and no stderr note is printed for unparseable or unreadable package.json
11. Run test — verify FAIL: `cd packages/ce && npx vitest run src/init/command.test.ts -t "argv"`
12. Implement → PASS → refactor while green. Commit `feat(init): handle usage errors and unusable package.json`.
13. Write failing test for: CLI routes `ce init`
    Test file: `packages/ce/src/cli.init.test.ts`
    Level: integration (child process via tsx, as src/cli.env.test.ts)
    Test intent: Given a temp dir with a vite package.json / When `tsx src/cli.ts init` / Then exit 0 and ce.yml exists; When `tsx src/cli.ts --help` / Then help lists `ce init [--force]`; When `tsx src/cli.ts init` again / Then exit 1. Given a fresh temp dir that also has `.env` containing `OPENROUTER_API_KEY=sk-or-DOTENV-0123456789abcdef` and the child env has no key / When `tsx src/cli.ts init` / Then exit 0, stdout/stderr contain no `sk-or-DOTENV` text, and the next steps do NOT say the key is already set (init does not load .env)
    Exercise through: the CLI entry `src/cli.ts`
    Test doubles: none (OPENROUTER_API_KEY removed from child env)
    Expected RED: "Unknown command: init"
14. Run test — verify FAIL: `cd packages/ce && npx vitest run src/cli.init.test.ts`; then add the `case 'init'` (no .env loading) + help line → PASS; run full `cd packages/ce && npx vitest run` and `npm run typecheck`; commit `feat(cli): route ce init`.

## REFERENCES LOADED
Spec — rules B0–B6, A8, C1; scenarios existing ce.yml is protected, existing .ce.yml is protected, second run is a no-op, --force replaces ce.yml, --force rewrites .ce.yml in place, unknown flag, ce.yml is a directory (both), directory ce.yml beside .ce.yml, write fails mid --force, malformed package.json
packages/ce/src/cli.ts, src/run/command.ts (USAGE/parse pattern), src/config/file.ts (discoverConfigFile isFile rule), src/config/load.ts (loadConfig), src/cli.env.test.ts (child-process pattern)
Node.js v22 fs docs (Context7): 'wx' → EEXIST (also on symlinks), rename overwrites files, errors on directory target
packages/ce/src/init/{detect,template,next-steps}.ts (created by: T2, T3, T4)

## WHY THIS APPROACH
Complexity: standard
Justification: file-system edge cases, atomicity, and cross-unit composition.

## SANDWICH CONTEXT
[CRITICAL: never overwrite an existing config without --force; under --force, the original must survive any write failure]
You are implementing the `ce init` command for issue #13.
Spec: docs/pocket/spec/2026-11-28-ce-init-onboarding/ce-init-and-npm-distribution.md
Design decision: Option A — pure command with injected deps
Files in scope: packages/ce/src/init/command.ts, src/init/index.ts, src/init/command.test.ts, src/cli.ts, src/cli.init.test.ts
Available after: T3 (renderConfig), T4 (renderNextSteps)
Architecture rule: runInitCommand uses no process.*; only cli.ts reads process.argv/cwd/env
[RESTATE: never overwrite without --force; original survives failed --force writes]

## DELIVERABLE
Given vite project, When `ce init`, Then ce.yml written, loadConfig ok, exit 0
Given ce.yml or .ce.yml (file, dir or symlink) exists, When `ce init`, Then exit 1, unchanged, stderr names file + --force
Given --force, Then the discovered file is replaced atomically; directory target → EISDIR exit 1; rename failure → original intact, no temp file
Given unknown flag/positional, Then usage, exit 1, no file
Given empty dir / malformed package.json, Then template written, exit 0 (+ stderr note when malformed)
[must-not] Given a file appears between check and create, Then it must NOT be overwritten

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Import detect/template/next-steps; no duplicated logic
  - Success text on stdout, errors/notes on stderr
Must-not-have:
  - .env loading for init; network commands; writing .gitignore/.env/workflows
  - Changing discoverConfigFile or run behaviour
Open question risks:
  - none identified
Rollback note:
  - Revert; command is additive
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: command + CLI tests pass; full packages/ce test suite and typecheck green
Uncertain when: platform rename semantics differ (Windows) → DONE_WITH_CONCERNS noting it
Escalate when: guard behaviour conflicts with discoverConfigFile
