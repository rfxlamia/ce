import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigSchema } from '../config/schema.js';
import { readAndParseConfigFile } from '../config/file.js';
import type { Detection } from './detect.js';
import { renderConfig } from './template.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Writes the text as ce.yml and validates it through the real reader + schema. */
export function readRendered(text: string): Record<string, unknown> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-template-'));
  dirs.push(dir);
  const file = path.join(dir, 'ce.yml');
  fs.writeFileSync(file, text);
  const read = readAndParseConfigFile(file);
  if (!read.ok) throw new Error(`reader rejected output: ${JSON.stringify(read)}`);
  const parsed = ConfigSchema.safeParse(read.value);
  if (!parsed.success) throw new Error(`schema rejected output: ${parsed.error.message}`);
  return parsed.data as Record<string, unknown>;
}

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
    ceInstalled: false,
    scriptText: 'vite',
    ...over,
  };
}

function fallback(reason: Extract<Detection, { status: 'fallback' }>['reason']): Detection {
  return { status: 'fallback', reason, pm: 'npm', pmMajor: null, hasLockfile: false, ceInstalled: false };
}

describe('renderConfig detected project', () => {
  it('renders a valid target block for vite/npm/5173', () => {
    const text = renderConfig(detected());
    const cfg = readRendered(text) as {
      target: { start: string; url: string; ready: { path: string } };
    };
    expect(cfg.target.start).toBe('npm run dev');
    expect(cfg.target.url).toBe('http://localhost:5173');
    expect(cfg.target.ready.path).toBe('/');
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^#/);
    expect(text.split('\n').filter((l) => l.startsWith('#')).slice(0, 4).join('\n')).toContain(
      'https://github.com/rfxlamia/ce',
    );
    expect(text).toContain('schemas/ce.schema.json');
    expect(lines.some((l) => l.startsWith('#') && l.includes('vite'))).toBe(true);
    for (const key of ['# context:', '# assessment:', '# runtime:', '# output:']) {
      expect(text).toContain(key);
    }
    for (const key of ['context', 'assessment', 'runtime', 'output']) {
      expect(cfg).not.toHaveProperty(key);
    }
  });
});

describe('renderConfig unknown port and fallback', () => {
  it('writes 3000 with a check comment when the port is not detected', () => {
    const text = renderConfig(detected({ port: 3000, portSource: 'unknown', framework: null }));
    const cfg = readRendered(text) as { target: { url: string } };
    expect(cfg.target.url).toBe('http://localhost:3000');
    const comment = text.split('\n').find((l) => l.startsWith('#') && l.includes('port not detected'));
    expect(comment).toBeDefined();
    expect(comment).toContain('check');
  });

  it.each([
    ['missing', /not found|missing/],
    ['unparseable', /could not be parsed/],
    ['no-script', /no dev or start script/],
    ['not-object', /not an object|not a JSON object/],
  ] as const)('fallback %s: valid file, target commented out with a reason', (reason, pattern) => {
    const text = renderConfig(fallback(reason));
    const cfg = readRendered(text);
    expect(cfg).not.toHaveProperty('target');
    const lines = text.split('\n');
    expect(lines).toContain('# target:');
    expect(lines.some((l) => l.startsWith('#   start:'))).toBe(true);
    expect(lines.some((l) => l.startsWith('#') && pattern.test(l))).toBe(true);
  });
});

describe('renderConfig hostile script text', () => {
  const hostile = [
    'vite\nassessment: {thresholds: {claim: 9}}  # x',
    'vite\rassessment:\r  on-uncertain: skip',
    'vite\u2028assessment: {thresholds: {claim: 9}}',
    'vite\u2029output: {dir: /etc}',
    'vite\u0000\u0007\u001b[2Jruntime: {max-steps: 1}\u0085jev: {}',
    `vite ${'x'.repeat(5000)}`,
    'vite\tPORT=1',
  ];

  it.each(hostile)('cannot inject YAML via script text %#', (scriptText) => {
    const text = renderConfig(detected({ scriptText }));
    const cfg = readRendered(text);
    expect(cfg.assessment).toBeUndefined();
    expect(cfg.output).toBeUndefined();
    expect(cfg.runtime).toBeUndefined();
    expect(cfg.jev).toBeUndefined();
    const hint = text.split('\n').filter((l) => l.startsWith('# Detected:'));
    expect(hint).toHaveLength(1);
    expect(hint[0]!.slice(2).length).toBeLessThanOrEqual(120);
    expect(hint[0]).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(text).not.toMatch(/[\r\u2028\u2029\u0085]/);
  });

  it('shows the sanitised script text in the hint', () => {
    const text = renderConfig(detected({ scriptText: 'vite --host' }));
    expect(text).toContain('# Detected: vite (script "dev": "vite --host")');
  });
});
