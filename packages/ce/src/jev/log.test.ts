import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CallLogEntrySchema, createJsonlCallLog, type CallLogEntry } from './log.js';

function entry(overrides: Partial<CallLogEntry> = {}): CallLogEntry {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    stage: 'runtime',
    transport: 'fake',
    provider: 'openrouter',
    requestedModel: 'typesafe/jev-1.14',
    model: 'typesafe/jev-1.14-20260101',
    questions: [{ id: 'runtime.next_action', version: 1, type: 'choice' }],
    answers: { next: { type: 'choice', probabilities: { '0': 0.7, done: 0.3 } } },
    latencyMs: 12,
    usage: { input_tokens: 10, output_tokens: 2 },
    stateHash: 'a'.repeat(64),
    status: 'ok',
    attempts: 1,
    ...overrides,
  };
}

describe('createJsonlCallLog', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jev-log-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the parent directory', async () => {
    const path = join(dir, 'nested', 'deeper', 'jev-calls.jsonl');
    await createJsonlCallLog(path).append(entry());
    expect((await stat(join(dir, 'nested', 'deeper'))).isDirectory()).toBe(true);
    expect((await readFile(path, 'utf8')).length).toBeGreaterThan(0);
  });

  it('rejects an invalid entry and writes nothing', async () => {
    const path = join(dir, 'out', 'jev-calls.jsonl');
    const log = createJsonlCallLog(path);
    const bad = entry({ stateHash: 'not-a-hash' });
    await expect(log.append(bad)).rejects.toThrow(/invalid call log entry/);
    await expect(stat(path)).rejects.toThrow();
    await expect(stat(join(dir, 'out'))).rejects.toThrow();
  });

  it('keeps earlier lines intact after a rejected entry', async () => {
    const path = join(dir, 'jev-calls.jsonl');
    const log = createJsonlCallLog(path);
    await log.append(entry());
    await expect(log.append(entry({ attempts: -1 }))).rejects.toThrow();
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('writes one JSON object per line, in call order', async () => {
    const path = join(dir, 'jev-calls.jsonl');
    const log = createJsonlCallLog(path);
    const entries = [entry({ attempts: 1 }), entry({ attempts: 2 }), entry({ attempts: 3 })];
    for (const e of entries) await log.append(e);
    const text = await readFile(path, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.slice(0, -1).split('\n');
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as unknown);
    expect(parsed).toEqual(entries);
    for (const p of parsed) expect(CallLogEntrySchema.safeParse(p).success).toBe(true);
  });
});

describe('CallLogEntrySchema content fields', () => {
  const forbidden = [
    'state',
    'stateText',
    'image',
    'imageBytes',
    'data_base64',
    'instructions',
    'description',
    'options',
    'apiKey',
    'key',
    'authorization',
    'Authorization',
  ];

  it('declares no field for state text, image bytes, instructions, or the key', () => {
    const keys = Object.keys(CallLogEntrySchema.shape);
    for (const name of forbidden) expect(keys).not.toContain(name);
  });

  it.each(forbidden)('rejects an extra top-level field %s', (name) => {
    const result = CallLogEntrySchema.safeParse({ ...entry(), [name]: 'secret-value' });
    expect(result.success).toBe(false);
  });

  it('rejects extra fields inside questions', () => {
    const q = { id: 'x', version: 1, type: 'choice', instructions: 'text' };
    expect(CallLogEntrySchema.safeParse({ ...entry(), questions: [q] }).success).toBe(false);
  });
});
