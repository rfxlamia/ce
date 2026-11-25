import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from './env.js';

class Exit extends Error { constructor(public code: number) { super('exit'); } }
const exit = (code: number): never => { throw new Exit(code); };
const tmp = () => mkdtempSync(join(tmpdir(), 'spike-env-'));

describe('loadEnv', () => {
  it('loads from file without overriding already-set vars', () => {
    const p = join(tmp(), '.env');
    writeFileSync(p, 'OPENROUTER_API_KEY=fromfile\nTYPESAFE_API_KEY=tsfile\n');
    const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'preset' };
    const s = loadEnv({ envPath: p, env, exit, log: () => {} });
    expect(env.OPENROUTER_API_KEY).toBe('preset');
    expect(env.TYPESAFE_API_KEY).toBe('tsfile');
    expect(s).toEqual({ openrouterKeyPresent: true, typesafeKeyPresent: true });
  });

  it('does not throw for a missing file when vars are set', () => {
    const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'k' };
    expect(() => loadEnv({ envPath: join(tmp(), 'nope'), env, exit, log: () => {} })).not.toThrow();
  });

  it('exits naming OPENROUTER_API_KEY, never its value, when unset', () => {
    const logs: string[] = [];
    expect(() => loadEnv({ envPath: join(tmp(), 'nope'), env: { TYPESAFE_API_KEY: 'secret-ts' }, exit, log: (m) => logs.push(m) })).toThrow(Exit);
    expect(logs.join('\n')).toContain('OPENROUTER_API_KEY');
    expect(logs.join('\n')).not.toContain('secret-ts');
  });

  it('reports TYPESAFE_API_KEY absent without failing', () => {
    const logs: string[] = [];
    const s = loadEnv({ envPath: join(tmp(), 'nope'), env: { OPENROUTER_API_KEY: 'k' }, exit, log: (m) => logs.push(m) });
    expect(s.typesafeKeyPresent).toBe(false);
    expect(logs.join('\n')).toContain('TYPESAFE_API_KEY');
    expect(logs.join('\n')).toContain('skipped');
  });

  it('does not exit when OPENROUTER_API_KEY is present', () => {
    let exited = false;
    loadEnv({ envPath: join(tmp(), 'nope'), env: { OPENROUTER_API_KEY: 'k' }, exit: (c) => { exited = true; return exit(c); }, log: () => {} });
    expect(exited).toBe(false);
  });
});
