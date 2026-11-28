# Verification: ce init onboarding timing (#13)

## Environment

- macOS (Darwin 27.0.0), Node v26.13.1, npm 11.20.0
- Date: 2026-11-28
- Package under test: `continuous-evidence-0.1.0.tgz`, produced by `npm pack --workspace continuous-evidence` (prepack builds)
- Scratch app: git repo, vite ^6 (resolved to 6.4.6), `index.html` with `<h1>Hello Evidence</h1>`, committed on `main`; branch `change` adds a `Sign up` button.

## Steps and elapsed time

| Step | Command | Elapsed |
| --- | --- | --- |
| (pre) app's own setup, not counted | `npm i` (vite) | 15 s |
| (a) install | `npm i -D <tgz>` | 3 s |
| (b) browser | `npx playwright install chromium` | 1 s (cache hit, see caveat) |
| (c) init | `npx ce init` | under 1 s |
| (d) first run | `npx ce run --base main --claim "The page shows a Sign up button"` | 11 s |
| Total (a)+(b)+(c)+(d) | | 15 s |

Target: under 2 minutes. Measured: 15 s, well within budget on this machine.

## Chromium cache caveat

This machine already had Chromium cached in `~/Library/Caches/ms-playwright` (`chromium-1255`, `chromium_headless_shell-1255`, `ffmpeg-1013`), so step (b) only verified the cache and did not download. The cache was not deleted, so a cold download was not measured. The spec estimates a cold download at roughly 30-90 s depending on network. Adding that estimate gives about 45-105 s total, still under 2 minutes on a typical connection, but this is an estimate, not a measurement.

## Run outcome and readiness

- Exit code 0. Output: `Outcome: EVIDENCED`, `Claim: The page shows a Sign up button (+1 more)`, `Why: final state not_reached after 2 steps`.
- Not a config or target ERROR. `run.json` has `error: null` and 2 steps with screenshots.
- Readiness on `http://localhost:5173` succeeded: `target.log` shows `VITE v6.4.6 ready in 699 ms` with `Local: http://localhost:5173/`, and the run proceeded to drive the page. No need to switch the template to 127.0.0.1.
- No leftover vite process or listener on port 5173 after the run.

## Generated ce.yml (summary)

Header comment linking docs and schema, `version: 0`, comment `# Detected: vite (script "dev": "vite")`, and:

```yaml
target:
  start: npm run dev
  url: http://localhost:5173
  ready:
    path: /
    # timeout: 30s
```

Optional sections (`context`, `assessment`, `runtime`, `output`) appear as commented defaults. `ce init` stdout listed next steps (key env var, Chromium install, `.gitignore` hints, `npx ce run`) and a GitHub workflow snippet.

## Key handling

The OpenRouter key was supplied only through the environment of the single `ce run` process, from the root `.env`. It was never printed or written to any file. The captured run output was checked and did not contain it. No run artifacts (`.ce/`) were committed.
