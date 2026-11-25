# Jev via OpenRouter spike harness

Throwaway measurement harness for GitHub issue #3. It checks whether Jev works through OpenRouter: primitive compatibility, mixed text and image state, latency, and model identification.

The harness is not a workspace member. It is not part of root `npm test`, `npm run build`, or `npm run typecheck`, and no root script runs it.

## Setup

Run once from the repository root:

```sh
npm install --prefix spike/jev-openrouter
```

`tsx` is installed only in `spike/jev-openrouter`, not at the repository root. A bare `npx tsx ...` from the root does not find it and would try to download it, so use the npm script below.

## Credentials

Copy `.env.example` to `.env` at the repository root and fill in the values:

```sh
cp .env.example .env
```

- `OPENROUTER_API_KEY` is required. The harness exits before sending any request if it is unset.
- `TYPESAFE_API_KEY` is optional. It enables the fallback check through the `typesafe` provider. When it is absent, that check is recorded as skipped.

`.env` is git-ignored. Never commit a key, and never paste one into a sample or the findings document. Variables already set in the shell take precedence over `.env`.

## Capture the screenshot fixture

The mixed-state and latency checks need `fixtures/demo-app-screenshot.png`. Capturing it needs no API key.

1. Install Chromium once:

   ```sh
   npx --prefix spike/jev-openrouter playwright install chromium
   ```

   Alternatively, run `npx playwright install chromium` from `spike/jev-openrouter`.

2. Start the demo app in a separate terminal, from the repository root:

   ```sh
   npm run dev --workspace examples/demo-app
   ```

   Vite serves it at `http://localhost:5173` by default.

3. Capture the screenshot, from `spike/jev-openrouter`:

   ```sh
   npx tsx fixtures/capture-screenshot.ts http://localhost:5173
   ```

   This writes `spike/jev-openrouter/fixtures/demo-app-screenshot.png`. Open it and confirm it shows the intended subject.

## Run the harness

From the repository root:

```sh
npm --prefix spike/jev-openrouter run spike
```

This runs `tsx run.ts` inside the harness directory. The `.env` file is still read from the repository root.

It runs the checks in order (primitives, mixed state, latency) and makes live requests, so it uses your API key and may incur cost. Run it yourself. Do not run it from automation.

## Outputs

- Raw samples: a new timestamped directory under `docs/journal/v0.0/samples/`. Existing directories are never reused or overwritten. Images are written as separate files referenced from the JSON.
- Draft findings: `docs/journal/v0.0/spike-jev-openrouter.md`. Check statuses and the consequences list are left as marked items for a human reviewer. A check that could not run is written as `not confirmed` with its cause.

Partial results are written if one check fails.

## Harness tests

The harness has its own tests. They need no API key and make no network calls:

```sh
npm --prefix spike/jev-openrouter test
```
