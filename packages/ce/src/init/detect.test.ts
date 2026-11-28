import { describe, expect, it } from 'vitest';
import { detectProject } from './detect.js';

function pkg(value: unknown): string {
  return JSON.stringify(value);
}

function detect(value: unknown, files: string[] = []) {
  return detectProject({ packageJsonText: pkg(value), files: new Set(files) });
}

describe('detectProject: vite with npm', () => {
  it('detects a vite dev server', () => {
    const d = detectProject({
      packageJsonText: '{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6"}}',
      files: new Set(['package-lock.json']),
    });
    expect(d).toMatchObject({
      status: 'detected',
      pm: 'npm',
      script: 'dev',
      port: 5173,
      portSource: 'framework',
      framework: 'vite',
      hasLockfile: true,
      ceInstalled: false,
    });
  });
});

describe('detectProject: explicit ports and earliest-match rule', () => {
  it('reads -p with pnpm', () => {
    const d = detect({ scripts: { dev: 'next dev -p 4000' }, dependencies: { next: '15' } }, ['pnpm-lock.yaml']);
    expect(d).toMatchObject({ status: 'detected', pm: 'pnpm', port: 4000, portSource: 'explicit' });
  });

  it('reads --port=N', () => {
    expect(detect({ scripts: { dev: 'vite --port=8080' } })).toMatchObject({ port: 8080, portSource: 'explicit' });
  });

  it('reads PORT=N env prefix with no framework', () => {
    expect(detect({ scripts: { dev: 'PORT=5000 node server.js' } })).toMatchObject({
      port: 5000,
      portSource: 'explicit',
      framework: null,
    });
  });

  it('earliest explicit match wins regardless of pattern', () => {
    expect(detect({ scripts: { dev: 'PORT=4100 vite --port 4200' } })).toMatchObject({ port: 4100 });
    expect(detect({ scripts: { dev: 'vite --port 4200 PORT=4100' } })).toMatchObject({ port: 4200 });
  });

  it.each(['vite --port 70000', 'vite --port 0', 'vite --port $PORT', 'PORT=abc vite', 'vite --port 80.5'])(
    'ignores invalid explicit port in %s',
    (dev) => {
      expect(detect({ scripts: { dev } })).toMatchObject({ port: 5173, portSource: 'framework', framework: 'vite' });
    },
  );

  it('falls through an invalid earlier match to a valid later one', () => {
    expect(detect({ scripts: { dev: 'PORT=abc vite --port 9000' } })).toMatchObject({ port: 9000, portSource: 'explicit' });
  });

  it('does not match -p inside other flags or words', () => {
    expect(detect({ scripts: { dev: 'vite --public 99 --pport 98' } })).toMatchObject({ port: 5173, portSource: 'framework' });
  });

  it.each([
    ['next dev', 3000, 'next'],
    ['nuxt dev', 3000, 'nuxt'],
    ['nuxi dev', 3000, 'nuxi'],
    ['astro dev', 4321, 'astro'],
    ['ng serve', 4200, '@angular/cli'],
    ['react-scripts start', 3000, 'react-scripts'],
    ['gatsby develop', 8000, 'gatsby'],
    ['vite', 5173, 'vite'],
  ])('detects framework from script tokens: %s', (dev, port, framework) => {
    expect(detect({ scripts: { dev } })).toMatchObject({ port, framework, portSource: 'framework' });
  });

  it('uses dependencies when the script has no framework token, tokens first otherwise', () => {
    expect(detect({ scripts: { dev: 'node run.js' }, dependencies: { astro: '4' } })).toMatchObject({
      port: 4321,
      framework: 'astro',
    });
    expect(detect({ scripts: { dev: 'vite' }, dependencies: { next: '15' } })).toMatchObject({ framework: 'vite' });
    expect(detect({ scripts: { dev: 'node run.js' }, devDependencies: { '@sveltejs/kit': '2' } })).toMatchObject({
      port: 5173,
      framework: '@sveltejs/kit',
    });
    expect(detect({ scripts: { dev: 'node run.js' }, devDependencies: { '@angular/cli': '18' } })).toMatchObject({
      port: 4200,
    });
  });
});

describe('detectProject: selection of script and package manager', () => {
  it('falls back to start when only start exists', () => {
    expect(detect({ scripts: { start: 'react-scripts start' } })).toMatchObject({
      script: 'start',
      port: 3000,
      framework: 'react-scripts',
      scriptText: 'react-scripts start',
    });
  });

  it('treats whitespace-only dev as absent', () => {
    expect(detect({ scripts: { dev: '  ', start: 'vite' } })).toMatchObject({ script: 'start', scriptText: 'vite' });
  });

  it('treats non-string dev as absent', () => {
    expect(detect({ scripts: { dev: 5, start: 'vite' } })).toMatchObject({ script: 'start' });
  });

  it('prefers dev over start', () => {
    expect(detect({ scripts: { dev: 'vite', start: 'node a.js' } })).toMatchObject({ script: 'dev' });
  });

  it('reports unknown port for a plain node server', () => {
    expect(detect({ scripts: { dev: 'node server.js' } })).toMatchObject({
      port: 3000,
      portSource: 'unknown',
      framework: null,
    });
  });

  it('packageManager field wins over lockfile and yields pmMajor', () => {
    expect(detect({ scripts: { dev: 'vite' }, packageManager: 'yarn@4.1.0' }, ['package-lock.json'])).toMatchObject({
      pm: 'yarn',
      pmMajor: 4,
      hasLockfile: true,
    });
  });

  it('packageManager without a version gives null pmMajor; unknown prefix is ignored', () => {
    expect(detect({ scripts: { dev: 'vite' }, packageManager: 'pnpm' })).toMatchObject({ pm: 'pnpm', pmMajor: null });
    expect(detect({ scripts: { dev: 'vite' }, packageManager: 'deno@2.0.0' }, ['yarn.lock'])).toMatchObject({
      pm: 'yarn',
      pmMajor: null,
    });
  });

  it('ignores a non-string packageManager', () => {
    expect(detect({ scripts: { dev: 'vite' }, packageManager: 42 }, ['pnpm-lock.yaml'])).toMatchObject({ pm: 'pnpm' });
  });

  it.each([
    [['yarn.lock'], 'yarn', true],
    [['bun.lock'], 'bun', true],
    [['bun.lockb'], 'bun', true],
    [['package-lock.json'], 'npm', true],
    [[], 'npm', false],
    [['yarn.lock', 'pnpm-lock.yaml'], 'pnpm', true],
    [['bun.lock', 'yarn.lock'], 'yarn', true],
  ] as const)('lockfiles %j give pm %s (hasLockfile %s)', (files, pm, hasLockfile) => {
    expect(detect({ scripts: { dev: 'vite' } }, [...files])).toMatchObject({ pm, pmMajor: null, hasLockfile });
  });

  it('detects continuous-evidence in devDependencies or dependencies', () => {
    expect(detect({ scripts: { dev: 'vite' }, devDependencies: { 'continuous-evidence': '^0.1.0' } })).toMatchObject({
      ceInstalled: true,
    });
    expect(detect({ scripts: { dev: 'vite' }, dependencies: { 'continuous-evidence': '^0.1.0' } })).toMatchObject({
      ceInstalled: true,
    });
  });

  it('treats non-object dependencies as empty without throwing', () => {
    expect(detect({ scripts: { dev: 'vite' }, dependencies: 'x', devDependencies: ['vite'] })).toMatchObject({
      status: 'detected',
      ceInstalled: false,
      framework: 'vite',
    });
  });
});
