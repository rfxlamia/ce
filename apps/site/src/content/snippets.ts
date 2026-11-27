export const CONFIG_SNIPPET = `version: 0
target:
  start: npm run dev
  url: http://localhost:5173
  ready:
    path: /
    timeout: 60s`;

// Identical to the first yaml block under "## GitHub Action" in README.md.
// "\${{" is escaped so the template literal keeps the text as written.
export const ACTION_SNIPPET = `name: CE
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
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
        with:
          target-start: npm run dev
          target-ready-path: /`;

export const SNIPPET_LABELS = {
  config: 'Copy ce.yml',
  action: 'Copy workflow',
} as const;
