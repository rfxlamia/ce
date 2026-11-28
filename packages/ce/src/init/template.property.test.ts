import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigSchema } from '../config/schema.js';
import { readAndParseConfigFile } from '../config/file.js';
import { detectProject } from './detect.js';
import { renderConfig } from './template.js';

const RUNS = { numRuns: 200 };
const LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json', 'other.txt'];
const filesArb = fc.subarray(LOCKFILES).map((f) => new Set(f));

// Scripts include newlines, '#', quotes, YAML-looking text and very long strings.
const nasty = fc.constantFrom(
  'vite\nassessment: {x: 1}',
  'a: b # c',
  '"quoted" \'single\' `tick`',
  'next dev -p 4000\r\noutput:\r\n  dir: x',
  'vite runtime: {}',
  'x'.repeat(500),
  '- item\n- item',
  '---\n...',
  'PORT=65535 node a.js',
);
const scriptArb = fc.oneof(fc.string(), fc.string({ unit: 'binary' }), nasty, fc.integer(), fc.constant(null));
const depsArb = fc.oneof(
  fc.dictionary(fc.constantFrom('vite', 'next', 'continuous-evidence', 'astro'), fc.string()),
  fc.string(),
  fc.constant(null),
);
const packageJsonObjArb = fc.record(
  {
    scripts: fc.oneof(fc.record({ dev: scriptArb, start: scriptArb }, { requiredKeys: [] }), fc.string(), fc.constant(null)),
    dependencies: depsArb,
    devDependencies: depsArb,
    packageManager: fc.oneof(fc.string(), fc.constantFrom('pnpm@9.1.0', 'yarn@4', 'bun', 'npm@x'), fc.constant(null)),
  },
  { requiredKeys: [] },
);
const textArb = fc.oneof(
  fc.string(),
  fc.jsonValue().map((v) => JSON.stringify(v)),
  packageJsonObjArb.map((o) => JSON.stringify(o)),
  packageJsonObjArb.map((o) => `﻿${JSON.stringify(o)}`),
  fc.constant(null),
);

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function validate(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; detail: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-template-prop-'));
  dirs.push(dir);
  const file = path.join(dir, 'ce.yml');
  fs.writeFileSync(file, text);
  const read = readAndParseConfigFile(file);
  if (!read.ok) return { ok: false, detail: JSON.stringify(read) };
  const parsed = ConfigSchema.safeParse(read.value);
  if (!parsed.success) return { ok: false, detail: parsed.error.message };
  return { ok: true, value: parsed.data as Record<string, unknown> };
}

describe('renderConfig properties', () => {
  it('every generated file passes the real reader and ConfigSchema', () => {
    fc.assert(
      fc.property(textArb, filesArb, (packageJsonText, files) => {
        const detection = detectProject({ packageJsonText, files });
        const text = renderConfig(detection);
        const result = validate(text);
        expect(result.ok, result.ok ? '' : result.detail).toBe(true);
        if (!result.ok) return;

        for (const key of ['context', 'assessment', 'runtime', 'output', 'jev']) {
          expect(result.value).not.toHaveProperty(key);
        }
        const target = result.value.target as
          | { start: string; url: string; ready: { path: string } }
          | undefined;
        if (detection.status === 'detected') {
          expect(target).toBeDefined();
          expect(target!.start).toBe(`${detection.pm} run ${detection.script}`);
          const m = /^http:\/\/localhost:(\d+)$/.exec(target!.url);
          expect(m).not.toBeNull();
          const port = Number(m![1]);
          expect(port).toBeGreaterThanOrEqual(1);
          expect(port).toBeLessThanOrEqual(65535);
          expect(port).toBe(detection.port);
          expect(target!.ready.path).toBe('/');
          const hints = text.split('\n').filter((l) => l.startsWith('# Detected:'));
          expect(hints).toHaveLength(1);
          expect(hints[0]!.slice(2).length).toBeLessThanOrEqual(120);
        } else {
          expect(target).toBeUndefined();
        }
      }),
      RUNS,
    );
  });
});
