import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDatedOutputDir, writeSample, type RawSample } from './samples.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'spike-samples-'));
const sample: RawSample = { requestType: 'mixed_state', request: { q: 1 }, response: { a: 2 }, modelId: 'm', latencyMs: 12 };

describe('newDatedOutputDir', () => {
  it('never collides across successive calls', () => {
    const base = tmp();
    const dirs = [newDatedOutputDir(base), newDatedOutputDir(base), newDatedOutputDir(base)];
    expect(new Set(dirs).size).toBe(3);
    for (const d of dirs) expect(existsSync(d)).toBe(true);
    expect(readdirSync(base)).toHaveLength(3);
  });
});

describe('writeSample', () => {
  it('writes the image as a separate file referenced by imageRef', () => {
    const dir = newDatedOutputDir(tmp());
    const bytes = new Uint8Array([137, 80, 78, 71]);
    writeSample(dir, 'mixed', sample, { data: bytes });
    const json = JSON.parse(readFileSync(join(dir, 'mixed.json'), 'utf8'));
    expect(json.imageRef).toBe('mixed.png');
    expect(json.modelId).toBe('m');
    expect(json.latencyMs).toBe(12);
    expect(new Uint8Array(readFileSync(join(dir, json.imageRef)))).toEqual(bytes);
    expect(JSON.stringify(json)).not.toContain('base64');
  });

  it('omits imageRef when no image is given', () => {
    const dir = newDatedOutputDir(tmp());
    writeSample(dir, 'plain', sample);
    expect(JSON.parse(readFileSync(join(dir, 'plain.json'), 'utf8')).imageRef).toBeUndefined();
  });
});
