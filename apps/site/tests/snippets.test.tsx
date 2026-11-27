import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { App } from '../src/App';
import { ACTION_SNIPPET, CONFIG_SNIPPET } from '../src/content/snippets';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const schemaPath = resolve(repoRoot, 'schemas', 'ce.schema.json');
const actionYmlPath = resolve(repoRoot, 'action.yml');
const readmePath = resolve(repoRoot, 'README.md');

const normalize = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\n+$/, '');

interface Step {
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}
interface Workflow {
  on?: Record<string, unknown> | string | string[];
  permissions?: Record<string, string>;
  jobs?: Record<string, { steps?: Step[] }>;
}

afterEach(cleanup);

describe('CONFIG_SNIPPET', () => {
  it('validates against schemas/ce.schema.json', () => {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
    const validate = ajv.compile(schema);
    const ok = validate(parse(CONFIG_SNIPPET));
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

describe('ACTION_SNIPPET', () => {
  const wf = parse(ACTION_SNIPPET) as Workflow;
  const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);

  it('triggers on pull_request with the required permissions', () => {
    const on = wf.on;
    const triggers =
      typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
    expect(triggers).toContain('pull_request');
    expect(wf.permissions?.contents).toBe('read');
    expect(wf.permissions?.['pull-requests']).toBe('write');
  });

  it('checks out with fetch-depth 0 and has an install step', () => {
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(steps.some((s) => /^npm (ci|install)\b/.test(s.run ?? ''))).toBe(true);
  });

  it('uses rfxlamia/ce@v0 with the key as a secret reference and no literal key', () => {
    const ce = steps.find((s) => s.uses === 'rfxlamia/ce@v0');
    expect(ce).toBeDefined();
    expect(ce?.env?.OPENROUTER_API_KEY).toBe('${{ secrets.OPENROUTER_API_KEY }}');
    expect(ACTION_SNIPPET).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
  });

  it('uses only with: keys declared in action.yml inputs', () => {
    expect(existsSync(actionYmlPath), 'action.yml is missing').toBe(true);
    const action = parse(readFileSync(actionYmlPath, 'utf8')) as {
      inputs?: Record<string, unknown>;
    };
    const inputs = Object.keys(action.inputs ?? {});
    const ce = steps.find((s) => s.uses === 'rfxlamia/ce@v0');
    const unknown = Object.keys(ce?.with ?? {}).filter((k) => !inputs.includes(k));
    expect(unknown, `with: keys not in action.yml inputs: ${unknown.join(', ')}`).toEqual([]);
  });

  it('action.yml exists and runs on node24', () => {
    expect(existsSync(actionYmlPath), 'action.yml is missing').toBe(true);
    const action = parse(readFileSync(actionYmlPath, 'utf8')) as {
      runs?: { using?: string };
    };
    expect(action.runs?.using).toBe('node24');
  });

  it('equals the first yaml block under "## GitHub Action" in README.md', () => {
    const readme = normalize(readFileSync(readmePath, 'utf8'));
    const start = readme.indexOf('\n## GitHub Action');
    expect(start).toBeGreaterThanOrEqual(0);
    const section = readme.slice(start + 1);
    const match = /```ya?ml\n([\s\S]*?)\n```/.exec(section);
    expect(match, 'no yaml block under ## GitHub Action').not.toBeNull();
    expect(normalize(match![1]!)).toBe(normalize(ACTION_SNIPPET));
  });
});

describe('App Quick start snippets', () => {
  function quickStart() {
    const { container } = render(<App />);
    const section = container.querySelector('#quick-start');
    expect(section).not.toBeNull();
    return { container, section: section as HTMLElement };
  }

  it('shows both snippets in <pre><code>', () => {
    const { section } = quickStart();
    const codes = Array.from(section.querySelectorAll('pre > code')).map((c) => c.textContent);
    expect(codes).toContain(CONFIG_SNIPPET);
    expect(codes).toContain(ACTION_SNIPPET);
  });

  it('modal snippet equals the Quick start snippet', () => {
    const { container, section } = quickStart();
    const modalCode = container.querySelector('dialog pre > code')?.textContent;
    const quickConfig = Array.from(section.querySelectorAll('pre > code'))
      .map((c) => c.textContent)
      .find((t) => t === CONFIG_SNIPPET);
    expect(modalCode).toBe(quickConfig);
  });

  it('claims no hosted report and never mentions publish: branch', () => {
    const { container } = quickStart();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/hosted report/i);
    expect(text).not.toMatch(/publish:\s*branch/i);
  });
});
