import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
const manifest = parse(readFileSync(resolve(repoRoot, 'action.yml'), 'utf8')) as {
  inputs?: Record<string, unknown>;
};
const declaredInputs = new Set(Object.keys(manifest.inputs ?? {}));

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  permissions?: Record<string, string>;
  jobs?: Record<string, { steps?: Step[]; permissions?: Record<string, string> }>;
}

function yamlBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /^[ \t]*```yaml[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    blocks.push(m[1] ?? '');
  }
  return blocks;
}

function findExample(): Workflow {
  for (const block of yamlBlocks(readme)) {
    if (!block.includes('rfxlamia/ce@')) continue;
    return parse(block) as Workflow;
  }
  throw new Error('README has no fenced yaml block that uses rfxlamia/ce');
}

const workflow = findExample();
const steps = Object.values(workflow.jobs ?? {}).flatMap((j) => j.steps ?? []);
const ceStep = steps.find((s) => s.uses?.startsWith('rfxlamia/ce@'));

describe('README Action example', () => {
  it('has a rfxlamia/ce step (Req 13.8)', () => {
    expect(ceStep).toBeDefined();
  });

  it('uses only inputs declared in action.yml under with: (Req 13.8)', () => {
    const keys = Object.keys(ceStep?.with ?? {});
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(declaredInputs.has(key), `undeclared input: ${key}`).toBe(true);
    }
  });

  it('declares contents: read and pull-requests: write (Req 13.8)', () => {
    expect(workflow.permissions?.contents).toBe('read');
    expect(workflow.permissions?.['pull-requests']).toBe('write');
  });
});

describe('README credentials', () => {
  it('contains no key-like credential value (Req 13.9)', () => {
    const patterns = [
      /sk-[A-Za-z0-9_-]{16,}/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}/,
      /github_pat_[A-Za-z0-9_]{20,}/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bBearer\s+[A-Za-z0-9._-]{20,}/,
    ];
    for (const p of patterns) expect(readme).not.toMatch(p);
    // A credential-named variable must never be assigned a literal value.
    const assignments = readme.matchAll(
      /\b(?:OPENROUTER_API_KEY|TYPESAFE_API_KEY|[A-Z_]*(?:TOKEN|SECRET|PASSWORD))[ \t]*[:=][ \t]*(\S.*)$/gm,
    );
    for (const m of assignments) {
      expect((m[1] ?? '').trim(), `literal credential value: ${m[0]}`).toMatch(/^\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}$/);
    }
  });

  it('references secrets only through ${{ secrets.NAME }} (Req 13.9)', () => {
    const mentions = readme.match(/secrets\.[^\s}]*/g) ?? [];
    expect(mentions.length).toBeGreaterThan(0);
    for (const ref of readme.matchAll(/\$\{\{([^}]*)\}\}/g)) {
      const expr = (ref[1] ?? '').trim();
      if (expr.startsWith('secrets.')) {
        expect(expr).toMatch(/^secrets\.(?:[A-Za-z0-9_]+|\*)$/);
      }
    }
    const example = yamlBlocks(readme).find((b) => b.includes('rfxlamia/ce@')) ?? '';
    expect(example).toContain('${{ secrets.OPENROUTER_API_KEY }}');
  });
});
