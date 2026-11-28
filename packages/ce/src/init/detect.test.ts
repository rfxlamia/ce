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
