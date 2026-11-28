import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Detection, PackageManager } from './detect.js';
import { renderNextSteps } from './next-steps.js';

type Env = Record<string, string | undefined>;

function detected(over: Partial<Extract<Detection, { status: 'detected' }>> = {}): Detection {
  return {
    status: 'detected',
    pm: 'npm',
    pmMajor: null,
    script: 'dev',
    port: 5173,
    portSource: 'framework',
    framework: 'vite',
    hasLockfile: true,
    ceInstalled: true,
    scriptText: 'vite',
    ...over,
  };
}

function fallback(over: Partial<Extract<Detection, { status: 'fallback' }>> = {}): Detection {
  return {
    status: 'fallback',
    reason: 'missing',
    pm: 'npm',
    pmMajor: null,
    hasLockfile: false,
    ceInstalled: false,
    ...over,
  };
}

function render(detection: Detection, env: Env = {}, configPath = '/work/ce.yml'): string {
  return renderNextSteps({ detection, configPath, env });
}

interface Step {
  uses?: string;
  run?: string;
  name?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

function snippet(text: string): { raw: string; doc: any; steps: Step[] } {
  const m = /```yaml\n([\s\S]*?)\n```/.exec(text);
  if (!m) throw new Error('no yaml fence');
  const raw = m[1] as string;
  const doc = parse(raw);
  const jobs = Object.values(doc.jobs) as { steps: Step[] }[];
  return { raw, doc, steps: jobs[0]!.steps };
}

describe('next steps after a detected init', () => {
  const out = render(detected());

  it('lists the steps in order', () => {
    const marks = [
      '/work/ce.yml',
      'OPENROUTER_API_KEY',
      'https://openrouter.ai/keys',
      '.env',
      'npx playwright install chromium',
      '.gitignore',
      'npx ce run',
      '```yaml',
    ];
    let last = -1;
    for (const mark of marks) {
      const i = out.indexOf(mark, last + 1);
      expect(i, mark).toBeGreaterThan(last);
      last = i;
    }
    expect(out).toContain('.ce/');
    expect(out).not.toContain('edit target in ce.yml');
  });

  it('prints a valid workflow snippet', () => {
    const { doc, steps } = snippet(out);
    const on = doc.on;
    expect(on === 'pull_request' || (typeof on === 'object' && on !== null && 'pull_request' in on)).toBe(true);
    const job = Object.values(doc.jobs)[0] as { permissions?: unknown };
    const perms = (doc.permissions ?? job.permissions) as Record<string, string>;
    expect(perms).toMatchObject({ contents: 'read', 'pull-requests': 'write' });
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    const node = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(node?.with?.['node-version']).toBe(22);
    expect(steps.some((s) => s.run === 'npm ci')).toBe(true);
    const ce = steps.find((s) => s.uses === 'rfxlamia/ce@v0');
    expect(ce?.env).toEqual({ OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}' });
    expect(Object.keys(ce?.with ?? {}).filter((k) => k.startsWith('target-'))).toEqual([]);
    expect(snippet(out).raw).not.toMatch(/target-/);
  });
});

describe('install step table', () => {
  const cases: {
    name: string;
    det: Detection;
    run: string;
    setup?: string;
    corepack?: boolean;
    comment?: boolean;
  }[] = [
    { name: 'npm+lock', det: detected(), run: 'npm ci' },
    { name: 'npm no lock', det: detected({ hasLockfile: false }), run: 'npm install' },
    {
      name: 'pnpm+lock',
      det: detected({ pm: 'pnpm' }),
      run: 'pnpm install --frozen-lockfile',
      setup: 'pnpm/action-setup@v4',
    },
    {
      name: 'pnpm no lock',
      det: detected({ pm: 'pnpm', hasLockfile: false }),
      run: 'pnpm install',
      setup: 'pnpm/action-setup@v4',
    },
    {
      name: 'yarn 4+lock',
      det: detected({ pm: 'yarn', pmMajor: 4 }),
      run: 'yarn install --immutable',
      corepack: true,
    },
    {
      name: 'yarn unknown+lock',
      det: detected({ pm: 'yarn', pmMajor: null }),
      run: 'yarn install --frozen-lockfile',
      corepack: true,
    },
    {
      name: 'yarn no lock',
      det: detected({ pm: 'yarn', pmMajor: 4, hasLockfile: false }),
      run: 'yarn install',
      corepack: true,
    },
    {
      name: 'bun+lock',
      det: detected({ pm: 'bun' }),
      run: 'bun install --frozen-lockfile',
      setup: 'oven-sh/setup-bun@v2',
    },
    {
      name: 'bun no lock',
      det: detected({ pm: 'bun', hasLockfile: false }),
      run: 'bun install',
      setup: 'oven-sh/setup-bun@v2',
    },
    { name: 'fallback', det: fallback(), run: 'npm ci', comment: true },
    {
      name: 'fallback pnpm+lock',
      det: fallback({ pm: 'pnpm', hasLockfile: true }),
      run: 'npm ci',
      comment: true,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const { raw, steps } = snippet(render(c.det));
      const nodeIdx = steps.findIndex((s) => s.uses?.startsWith('actions/setup-node@'));
      const installIdx = steps.findIndex((s) => s.run === c.run);
      expect(installIdx).toBeGreaterThan(nodeIdx);
      if (c.setup) {
        const i = steps.findIndex((s) => s.uses === c.setup);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(nodeIdx);
      } else {
        expect(steps.some((s) => s.uses?.startsWith('pnpm/') || s.uses?.startsWith('oven-sh/'))).toBe(false);
      }
      expect(steps.some((s) => s.run === 'corepack enable')).toBe(c.corepack === true);
      if (c.corepack) {
        expect(steps.findIndex((s) => s.run === 'corepack enable')).toBeLessThan(installIdx);
      }
      expect(raw.includes('# adjust to your install command')).toBe(c.comment === true);
    });
  }

  describe('pnpm version input', () => {
    const pnpmStep = (det: Detection): Step | undefined =>
      snippet(render(det)).steps.find((s) => s.uses === 'pnpm/action-setup@v4');

    it('pins version 10 when packageManager is absent', () => {
      for (const hasLockfile of [true, false]) {
        const det = detected({ pm: 'pnpm', pmMajor: null, hasLockfile });
        expect(pnpmStep(det)?.with).toEqual({ version: 10 });
        expect(render(det)).toContain('# match your pnpm version');
      }
    });

    it('adds no with block when packageManager declares the version', () => {
      const step = pnpmStep(detected({ pm: 'pnpm', pmMajor: 9 }));
      expect(step).toBeDefined();
      expect(step?.with).toBeUndefined();
    });
  });

  it('covers every package manager', () => {
    const pms: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];
    for (const pm of pms) expect(cases.some((c) => c.det.pm === pm)).toBe(true);
  });
});

describe('not installed', () => {
  it('puts install guidance before any npx ce run', () => {
    const out = render(detected({ ceInstalled: false }));
    const install = out.indexOf('npm i -D continuous-evidence');
    expect(install).toBeGreaterThanOrEqual(0);
    expect(out).toContain('npx continuous-evidence run');
    const runs = [...out.matchAll(/npx ce run/g)].map((m) => m.index as number);
    expect(runs.length).toBeGreaterThan(0);
    for (const i of runs) expect(i).toBeGreaterThan(install);
  });

  it('does not suggest installing when installed', () => {
    const out = render(detected());
    expect(out).not.toContain('npm i -D continuous-evidence');
  });

  it('puts the edit-target step before the key step for a fallback', () => {
    const out = render(fallback());
    const edit = out.indexOf('edit target in ce.yml');
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(edit).toBeGreaterThan(out.indexOf('/work/ce.yml'));
    expect(edit).toBeLessThan(out.indexOf('OPENROUTER_API_KEY'));
  });
});

describe('key never echoed', () => {
  it('says already set without the value', () => {
    const out = render(detected(), { OPENROUTER_API_KEY: 'sk-test-123' });
    expect(out).not.toContain('sk-test-123');
    expect(out).toContain('already set');
  });

  it('treats an empty key as not set', () => {
    const out = render(detected(), { OPENROUTER_API_KEY: '' });
    expect(out).not.toContain('already set');
    expect(out).toContain('https://openrouter.ai/keys');
  });
});
