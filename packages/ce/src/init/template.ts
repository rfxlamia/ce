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

const DEFAULT_PORT = 3000;
/** Maximum length of a generated comment's text after the leading "# ". */
const COMMENT_TEXT_MAX = 120;

/** Control, line-separator and invisible format characters become a space so a comment stays on one line. */
function sanitizeForComment(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ');
}

/** Truncates to at most `max` UTF-16 units without splitting a surrogate pair. */
function truncateUtf16(text: string, max: number): string {
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** Single-line detection hint: user-controlled script text is sanitised and the whole line capped. */
function detectedHint(d: Detected): string {
  const prefix = `Detected: ${d.framework ?? 'no known framework'} (script "${d.script}": "`;
  const suffix = '")';
  const room = Math.max(0, COMMENT_TEXT_MAX - prefix.length - suffix.length);
  const clean = sanitizeForComment(d.scriptText);
  const body = clean.length <= room ? clean : `${truncateUtf16(clean, Math.max(0, room - 3))}...`;
  return `# ${prefix}${body}${suffix}`;
}

const FALLBACK_REASONS: Record<Extract<Detection, { status: 'fallback' }>['reason'], string> = {
  missing: 'package.json was not found',
  unparseable: 'package.json could not be parsed',
  'not-object': 'package.json is not an object',
  'no-script': 'package.json has no dev or start script',
};

function targetLines(start: string, port: number, indent: string): string[] {
  return [
    `${indent}target:`,
    `${indent}  start: ${start}`,
    `${indent}  url: http://localhost:${port}`,
    `${indent}  ready:`,
    `${indent}    path: /`,
    `${indent}    # timeout: ${READY_TIMEOUT_EXAMPLE}`,
  ];
}

function targetBlock(d: Detected): string[] {
  const lines = [detectedHint(d)];
  if (d.portSource === 'unknown') {
    lines.push('# Dev server port not detected; check the url below and change it if needed.');
  }
  return [...lines, ...targetLines(`${d.pm} run ${d.script}`, d.port, ''), ''];
}

function fallbackTargetBlock(d: Extract<Detection, { status: 'fallback' }>): string[] {
  return [
    `# Target not detected: ${FALLBACK_REASONS[d.reason]}.`,
    '# Uncomment and adjust this block to tell ce how to start your app:',
    ...targetLines(`${d.pm} run dev`, DEFAULT_PORT, '# '),
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
  const target = detection.status === 'detected' ? targetBlock(detection) : fallbackTargetBlock(detection);
  return [...header(), ...target, ...optionalExamples()].join('\n');
}
