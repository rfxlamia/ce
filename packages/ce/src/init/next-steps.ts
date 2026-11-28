// Onboarding text printed after `ce init` writes ce.yml.
// Pure renderer: reads only the passed env object, never echoes a value from it.

import type { Detection } from './detect.js';

export interface NextStepsInput {
  detection: Detection;
  configPath: string;
  env: Record<string, string | undefined>;
}

function workflowSnippet(): string {
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
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 22',
    '      - run: npm ci',
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
  lines.push('```yaml', workflowSnippet(), '```');
  return lines.join('\n') + '\n';
}
