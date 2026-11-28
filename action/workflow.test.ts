import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  'runs-on'?: string;
  env?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: unknown };
  jobs?: Record<string, Job>;
}

function load(name: string): { text: string; wf: Workflow } {
  const text = readFileSync(resolve(repoRoot, '.github/workflows', name), 'utf8');
  return { text, wf: parse(text) as Workflow };
}

const allSteps = (wf: Workflow): Step[] =>
  Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);

describe('.github/workflows/ce.yml', () => {
  const { wf } = load('ce.yml');
  const steps = allSteps(wf);

  it('triggers on pull_request', () => {
    expect(wf.on).toHaveProperty('pull_request');
  });

  it('grants only contents: read and pull-requests: write', () => {
    expect(wf.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('uses a per-PR concurrency group with cancel-in-progress', () => {
    expect(wf.concurrency?.group).toContain('github.event.pull_request.number');
    expect(wf.concurrency?.['cancel-in-progress']).toBe(true);
  });

  it('runs only for same-repository pull requests', () => {
    const jobs = Object.values(wf.jobs ?? {});
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    }
  });

  it('runs the local Action with OPENROUTER_API_KEY from secrets through env', () => {
    const ceStep = steps.find((s) => s.uses === './');
    expect(ceStep).toBeDefined();
    expect(ceStep?.env?.OPENROUTER_API_KEY).toBe('${{ secrets.OPENROUTER_API_KEY }}');
    expect(ceStep?.with ?? {}).not.toHaveProperty('openrouter-api-key');
  });

  it('pins every third-party action to a 40-character SHA', () => {
    const thirdParty = steps.map((s) => s.uses).filter((u): u is string => !!u && u !== './' && !u.startsWith('./'));
    expect(thirdParty.length).toBeGreaterThan(0);
    for (const u of thirdParty) {
      expect(u, u).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }
  });
});

describe('.github/workflows/ci.yml', () => {
  const { text, wf } = load('ci.yml');

  it('parses and has no CE job', () => {
    expect(wf.jobs).toBeDefined();
    expect(allSteps(wf).some((s) => s.uses === './')).toBe(false);
    expect(text).not.toContain('rfxlamia/ce');
  });

  describe('smoke-pack job', () => {
    const job = wf.jobs?.['smoke-pack'];
    const steps = job?.steps ?? [];

    it('exists on ubuntu-latest with Node 24.x', () => {
      expect(job).toBeDefined();
      expect(job?.['runs-on']).toBe('ubuntu-latest');
      const setup = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
      expect(setup?.with?.['node-version']).toBe('24.x');
    });

    it('runs npm ci before node scripts/smoke-pack.mjs', () => {
      const runs = steps.map((s) => s.run?.trim());
      const ci = runs.indexOf('npm ci');
      const smoke = runs.indexOf('node scripts/smoke-pack.mjs');
      expect(ci).toBeGreaterThanOrEqual(0);
      expect(smoke).toBeGreaterThan(ci);
    });

    it('needs no secrets and does not install Chromium', () => {
      const raw = JSON.stringify(job ?? {});
      expect(raw).not.toContain('OPENROUTER_API_KEY');
      expect(raw).not.toContain('secrets.');
      expect(raw).not.toMatch(/playwright install/i);
    });
  });
});
