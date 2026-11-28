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

export function renderNextSteps(input: NextStepsInput): string {
  const lines: string[] = [];
  lines.push(`Wrote ${input.configPath}`, '');
  lines.push('Next steps:');
  lines.push('  1. Set OPENROUTER_API_KEY (get one at https://openrouter.ai/keys) in your environment or in .env.');
  lines.push('     A .env file in the current directory is loaded automatically; keep it out of git.');
  lines.push('  2. Install the browser: npx playwright install chromium');
  lines.push('  3. Add .ce/ and .env to .gitignore');
  lines.push('  4. Run: npx ce run');
  lines.push('');
  lines.push('Optional: run CE on pull requests. Save this as .github/workflows/ce.yml:', '');
  lines.push('```yaml', workflowSnippet(input.detection), '```');
  return lines.join('\n') + '\n';
}
