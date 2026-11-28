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
