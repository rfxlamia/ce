// ce.yml template for `ce init`.
// YAML values come only from fixed tokens (pm name, script name) and the validated integer port.
// Raw script text may only appear inside a sanitised single-line comment.

import { ConfigDefaults } from '../config/defaults.js';
import type { Detection } from './detect.js';

type Detected = Extract<Detection, { status: 'detected' }>;

const DOCS_URL = 'https://github.com/rfxlamia/ce';
const READY_TIMEOUT_EXAMPLE = '30s';

function header(): string[] {
  return [
    '# ce.yml - configuration for continuous-evidence (ce).',
    `# Docs: ${DOCS_URL}`,
    '# Schema: schemas/ce.schema.json (point your editor at it for completion and validation).',
    '',
    `version: ${ConfigDefaults.version}`,
    '',
  ];
}

function targetBlock(d: Detected): string[] {
  return [
    `# Detected: ${d.framework ?? 'no known framework'} (script "${d.script}")`,
    'target:',
    `  start: ${d.pm} run ${d.script}`,
    `  url: http://localhost:${d.port}`,
    '  ready:',
    '    path: /',
    `    # timeout: ${READY_TIMEOUT_EXAMPLE}`,
    '',
  ];
}

function optionalExamples(): string[] {
  const { assessment, runtime, output } = ConfigDefaults;
  const t = assessment?.thresholds;
  const v = runtime?.viewport;
  return [
    '# Optional sections (shown with their defaults):',
    '#',
    '# context:',
    '#   include: ["src/**"]',
    '#',
    '# assessment:',
    '#   thresholds:',
    `#     claim: ${t?.claim}`,
    `#     observable: ${t?.observable}`,
    `#     adequate: ${t?.adequate}`,
    `#   uncertainty-band: ${assessment?.['uncertainty-band']}`,
    `#   on-uncertain: ${assessment?.['on-uncertain']}`,
    '#',
    '# runtime:',
    `#   max-steps: ${runtime?.['max-steps']}`,
    `#   timeout: ${runtime?.timeout}`,
    '#   viewport:',
    `#     width: ${v?.width}`,
    `#     height: ${v?.height}`,
    '#',
    '# output:',
    `#   dir: ${output?.dir}`,
    `#   fail-on: [${(output?.['fail-on'] ?? []).join(', ')}]`,
    '',
  ];
}

export function renderConfig(detection: Detection): string {
  if (detection.status !== 'detected') throw new Error('fallback rendering not implemented');
  return [...header(), ...targetBlock(detection), ...optionalExamples()].join('\n');
}
