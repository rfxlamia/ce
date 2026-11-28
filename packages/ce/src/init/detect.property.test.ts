import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { detectProject } from './detect.js';

const RUNS = { numRuns: 200 };
const LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json', 'other.txt'];
const filesArb = fc.subarray(LOCKFILES).map((f) => new Set(f));

const scriptArb = fc.oneof(
  fc.string(),
  fc.constantFrom('vite', 'next dev -p 4000', 'PORT=99999 node a.js', '--port 0', 'PORT=65535 x', '-p 1'),
  fc.json(),
  fc.integer(),
  fc.constant(null),
);
const depsArb = fc.oneof(fc.dictionary(fc.constantFrom('vite', 'next', 'continuous-evidence', 'astro'), fc.string()), fc.string(), fc.constant(null), fc.array(fc.string()));
const pmFieldArb = fc.oneof(fc.string(), fc.constantFrom('pnpm@9.1.0', 'yarn@4', 'bun', 'npm@x'), fc.integer(), fc.constant(null));

const packageJsonObjArb = fc.record(
  {
    scripts: fc.oneof(fc.record({ dev: scriptArb, start: scriptArb }, { requiredKeys: [] }), fc.string(), fc.constant(null)),
    dependencies: depsArb,
    devDependencies: depsArb,
    packageManager: pmFieldArb,
  },
  { requiredKeys: [] },
);

const textArb = fc.oneof(
  fc.string(),
  fc.json(),
  fc.jsonValue().map((v) => JSON.stringify(v)),
  packageJsonObjArb.map((o) => JSON.stringify(o)),
  packageJsonObjArb.map((o) => `﻿${JSON.stringify(o)}`),
  fc.constant(null),
);

describe('detectProject properties', () => {
  it('never throws and always returns valid fields', () => {
    fc.assert(
      fc.property(textArb, filesArb, (packageJsonText, files) => {
        const d = detectProject({ packageJsonText, files });
        expect(['npm', 'pnpm', 'yarn', 'bun']).toContain(d.pm);
        expect(typeof d.hasLockfile).toBe('boolean');
        expect(typeof d.ceInstalled).toBe('boolean');
        if (d.status === 'detected') {
          expect(Number.isInteger(d.port)).toBe(true);
          expect(d.port).toBeGreaterThanOrEqual(1);
          expect(d.port).toBeLessThanOrEqual(65535);
          expect(['dev', 'start']).toContain(d.script);
          expect(d.scriptText.trim()).not.toBe('');
        }
      }),
      RUNS,
    );
  });
});
