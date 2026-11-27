// Workspace and Pages workflow checks (landing-page-skeleton task 6.5).
// Requirements: 1.2, 1.6, 11.1-11.13, 13.1, 13.4.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(here, '..');
const repoRoot = resolve(siteDir, '..', '..');

const readText = (p: string): string => readFileSync(p, 'utf8');
const readJson = (p: string): any => JSON.parse(readText(p));

const workflowPath = resolve(repoRoot, '.github', 'workflows', 'pages.yml');
const workflowText = readText(workflowPath);
const wf: any = parse(workflowText);

describe('workspace', () => {
  it('root package.json lists apps/*', () => {
    const root = readJson(resolve(repoRoot, 'package.json'));
    expect(root.workspaces).toContain('apps/*');
  });

  it('apps/site/package.json defines the required scripts', () => {
    const scripts = readJson(resolve(siteDir, 'package.json')).scripts;
    for (const name of ['dev', 'build', 'preview', 'typecheck', 'test']) {
      expect(scripts[name], `script ${name}`).toEqual(expect.any(String));
    }
    expect(scripts.test).toBe('vitest run --passWithNoTests');
  });
});

describe('pages workflow', () => {
  // YAML 1.1 parsers may read `on` as boolean true; the yaml package uses 1.2, but be safe.
  const triggers = wf.on ?? wf[true as unknown as string];

  it('triggers on push to main and workflow_dispatch only, no pull_request', () => {
    expect(triggers.push.branches).toEqual(['main']);
    expect('workflow_dispatch' in triggers).toBe(true);
    expect(Object.keys(triggers)).not.toContain('pull_request');
    expect(Object.keys(triggers)).not.toContain('pull_request_target');
  });

  it('build job has exactly contents: read and pages: read', () => {
    expect(wf.jobs.build.permissions).toEqual({ contents: 'read', pages: 'read' });
  });

  it('deploy job has exactly pages: write and id-token: write, needs build', () => {
    expect(wf.jobs.deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
    const needs = wf.jobs.deploy.needs;
    expect(Array.isArray(needs) ? needs : [needs]).toContain('build');
  });

  it('deploy uses the github-pages environment with a url output', () => {
    const env = wf.jobs.deploy.environment;
    expect(env.name).toBe('github-pages');
    expect(env.url).toMatch(/\$\{\{\s*steps\.[\w-]+\.outputs\.page_url\s*\}\}/);
  });

  it('concurrency does not cancel in progress', () => {
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
    expect(wf.concurrency.group).toEqual(expect.any(String));
  });

  it('pins every uses to a 40-character SHA', () => {
    const uses: string[] = [];
    for (const job of Object.values<any>(wf.jobs)) {
      for (const step of job.steps ?? []) if (step.uses) uses.push(step.uses);
    }
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      expect(u, `uses: ${u}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }
  });

  it('references no secrets', () => {
    expect(workflowText).not.toMatch(/secrets\./);
  });

  it('header comment states the Pages precondition', () => {
    const header: string[] = [];
    for (const line of workflowText.split(/\r?\n/)) {
      if (!line.startsWith('#')) break;
      header.push(line);
    }
    const text = header.join('\n');
    expect(text).toMatch(/Pages/);
    expect(text).toMatch(/GitHub Actions/);
    expect(text).toMatch(/before the first deployment/);
    expect(text).toMatch(/cannot enable Pages itself/);
  });
});
