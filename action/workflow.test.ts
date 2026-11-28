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
  permissions?: Record<string, string>;
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

  it('grants exactly contents: write and pull-requests: write (Req 13.1)', () => {
    expect(wf.permissions).toEqual({ contents: 'write', 'pull-requests': 'write' });
  });

  it('sets publish: branch on the Action step (Req 13.1)', () => {
    const ceStep = steps.find((s) => s.uses === './');
    expect(ceStep?.with?.publish).toBe('branch');
  });

  it('never runs on the ce-evidence branch (Req 13.3, 12.6)', () => {
    const jobs = Object.values(wf.jobs ?? {});
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.if).toContain("github.head_ref != 'ce-evidence'");
      expect(job.if).toContain("github.base_ref != 'ce-evidence'");
    }
  });

  it('keeps fetch-depth 0 on checkout (Req 13.2)', () => {
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
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

describe('.github/workflows/release.yml', () => {
  const { text, wf } = load('release.yml');
  const jobs = Object.values(wf.jobs ?? {});
  const job = jobs[0];
  const steps = job?.steps ?? [];
  const runIndex = (needle: string): number => steps.findIndex((s) => s.run?.includes(needle));

  /** GitHub filter pattern -> regex: `*` = [^/]*, `+` = one or more of preceding atom, `[...]` class, `.` literal. */
  function globToRegex(glob: string): RegExp {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i]!;
      if (c === '[') {
        const end = glob.indexOf(']', i);
        out += glob.slice(i, end + 1);
        i = end;
      } else if (c === '*') out += '[^/]*';
      else if (c === '+') out += '+';
      else out += c.replace(/[.\\^$?()|{}/-]/g, '\\$&');
    }
    return new RegExp(`^${out}$`);
  }

  it('has exactly one job on ubuntu-latest', () => {
    expect(jobs).toHaveLength(1);
    expect(job?.['runs-on']).toBe('ubuntu-latest');
  });

  it('triggers only on semver push tags', () => {
    expect(wf.on).toEqual({ push: { tags: ['v[0-9]+.[0-9]+.[0-9]+*'] } });
    for (const forbidden of ['pull_request', 'pull_request_target', 'issue_comment']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('tag filter matches semver tags and never floating or unrelated tags', () => {
    const re = globToRegex((wf.on as { push: { tags: string[] } }).push.tags[0]!);
    for (const t of ['v0', 'v1', 'latest', 'release-1']) expect(re.test(t), t).toBe(false);
    for (const t of ['v0.1.0', 'v0.2.0-rc.1', 'v10.20.30']) expect(re.test(t), t).toBe(true);
  });

  it('grants only id-token: write and contents: read', () => {
    const perms = job?.permissions ?? wf.permissions;
    expect(perms).toEqual({ 'id-token': 'write', contents: 'read' });
  });

  it('uses Node 24 with the npm registry and no cache', () => {
    const setup = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(setup?.with?.['node-version']).toBe('24.x');
    expect(setup?.with?.['registry-url']).toBe('https://registry.npmjs.org');
    expect(setup?.with ?? {}).not.toHaveProperty('cache');
  });

  it('pins actions to SHAs and does not persist checkout credentials', () => {
    const uses = steps.map((s) => s.uses).filter((u): u is string => !!u);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('references no npm token and no mutable repo action', () => {
    expect(text).not.toContain('NODE_AUTH_TOKEN');
    expect(text).not.toContain('NPM_TOKEN');
    expect(text).not.toContain('secrets.');
    expect(text).not.toContain('rfxlamia/ce@');
  });

  it('runs guard, npm check, install, chromium, typecheck, test, build, smoke, publish in order', () => {
    const order = [
      'release-tag.mjs',
      '11.5.1',
      'npm ci',
      'npx playwright install --with-deps chromium',
      'npm run typecheck',
      'npm test',
      'npm run build',
      'node scripts/smoke-pack.mjs',
      'npm publish --workspace continuous-evidence --access public',
    ].map(runIndex);
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // guard is the first run step
    expect(steps.findIndex((s) => s.run)).toBe(order[0]);
  });

  it('wires the guard output into the publish dist-tag', () => {
    const guard = steps[runIndex('release-tag.mjs')]!;
    const publish = steps[runIndex('npm publish')]!;
    expect((guard as Step & { id?: string }).id).toBe('tag');
    expect(guard.run).toContain('dist-tag=');
    expect(guard.run).toContain('$GITHUB_OUTPUT');
    expect(guard.env?.GITHUB_REF_NAME).toBe('${{ github.ref_name }}');
    expect(guard.run).not.toContain('${{');
    expect(publish.run).toContain('--tag ${{ steps.tag.outputs.dist-tag }}');
  });
});
