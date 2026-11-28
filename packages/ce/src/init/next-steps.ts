// Onboarding text printed after `ce init` writes ce.yml.
// Pure renderer: reads only the passed env object, never echoes a value from it.

import type { Detection } from './detect.js';

export interface NextStepsInput {
  detection: Detection;
  configPath: string;
  env: Record<string, string | undefined>;
}

interface InstallPlan {
  /** Steps placed before actions/setup-node. */
  before: string[];
  /** Steps placed after actions/setup-node and before the install command. */
  after: string[];
  install: string;
  comment?: string;
}

function installPlan(d: Detection): InstallPlan {
  const plan = (install: string, extra: Partial<InstallPlan> = {}): InstallPlan => ({
    before: [],
    after: [],
    install,
    ...extra,
  });
  if (d.status === 'fallback') return plan('npm ci', { comment: '# adjust to your install command' });
  switch (d.pm) {
    case 'pnpm':
      return plan(d.hasLockfile ? 'pnpm install --frozen-lockfile' : 'pnpm install', {
        before: ['      - uses: pnpm/action-setup@v4'],
      });
    case 'yarn': {
      const frozen = d.pmMajor !== null && d.pmMajor >= 2 ? '--immutable' : '--frozen-lockfile';
      return plan(d.hasLockfile ? `yarn install ${frozen}` : 'yarn install', {
        after: ['      - run: corepack enable'],
      });
    }
    case 'bun':
      return plan(d.hasLockfile ? 'bun install --frozen-lockfile' : 'bun install', {
        before: ['      - uses: oven-sh/setup-bun@v2'],
      });
    case 'npm':
      return plan(d.hasLockfile ? 'npm ci' : 'npm install');
  }
}

function workflowSnippet(d: Detection): string {
  const plan = installPlan(d);
  return [
    'name: CE',
    'on: pull_request',
    'permissions:',
    '  contents: read',
    '  pull-requests: write',
    'jobs:',
    '  evidence:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    ...plan.before,
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 22',
    ...plan.after,
    ...(plan.comment ? [`      ${plan.comment}`] : []),
    `      - run: ${plan.install}`,
    '      - uses: rfxlamia/ce@v0',
    '        env:',
    '          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}',
  ].join('\n');
}

function runCommandLines(d: Detection): string[] {
  if (d.ceInstalled) return ['Run: npx ce run'];
  return [
    'Install continuous-evidence: npm i -D continuous-evidence',
    'Then run: npx ce run',
    '(or, without installing: npx continuous-evidence run)',
  ];
}

export function renderNextSteps(input: NextStepsInput): string {
  const { detection } = input;
  const steps: string[][] = [];
  if (detection.status === 'fallback') {
    steps.push(['Please edit target in ce.yml: we could not detect how to start your app.']);
  }
  const keyIsSet = (input.env.OPENROUTER_API_KEY ?? '') !== '';
  steps.push([
    keyIsSet
      ? 'OPENROUTER_API_KEY is already set in your environment.'
      : 'Set OPENROUTER_API_KEY (get one at https://openrouter.ai/keys) in your environment or in .env.',
    'A .env file in the current directory is loaded automatically; keep it out of git.',
  ]);
  steps.push(['Install the browser: npx playwright install chromium']);
  steps.push(['Add .ce/ and .env to .gitignore']);
  steps.push(runCommandLines(detection));

  const lines: string[] = [`Wrote ${input.configPath}`, '', 'Next steps:'];
  steps.forEach((step, i) => {
    step.forEach((text, j) => lines.push(j === 0 ? `  ${i + 1}. ${text}` : `     ${text}`));
  });
  lines.push('');
  lines.push('Optional: run CE on pull requests. Save this as .github/workflows/ce.yml:', '');
  lines.push('```yaml', workflowSnippet(detection), '```');
  return lines.join('\n') + '\n';
}
