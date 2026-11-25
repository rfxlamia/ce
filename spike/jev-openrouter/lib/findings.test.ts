import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HarnessCallResult } from './call.js';
import { buildFindings, SECTION_TITLES, writeFindings, type FindingsInput } from './findings.js';
import { computeStats } from './stats.js';

const call = (over: Partial<HarnessCallResult> = {}): HarnessCallResult => ({
  requestType: 'choice', provider: 'openrouter', modelRequested: 'typesafe/jev-1.14', modelReturned: 'typesafe/jev-1.14-a',
  ok: true, latencyMs: 1200, raw: { request: {}, response: {} }, ...over,
});

const summary = (requestType: 'next_action' | 'final_image') => ({
  requestType, status: 'ran' as const, modelRequested: 'm', requestedSamples: 20,
  stats: computeStats([1000, 2000, 3000], 1), inputTokens: [900], rateLimits: [],
  budget: { perStepMs: 7500, p50WithinBudget: true, p95WithinBudget: true },
});

function input(over: Partial<FindingsInput> = {}): FindingsInput {
  const c = call();
  return {
    primitives: { results: [c, call({ requestType: 'noul', ok: false, modelReturned: null, errorClass: 'Error', httpStatus: 500 })],
      conformance: [{ requestType: 'choice', compared: true, entries: [] }, { requestType: 'noul', compared: false, entries: [] }] },
    mixedState: { status: 'not-run', notRunReason: 'fixture file absent', fixturePath: 'f.png', imageHeaderSent: false,
      withImage: null, withoutImage: null, shapeChangedWithoutImage: null, shapeComparisonNote: null,
      boxEnclosesSubject: 'UNJUDGED', fallbacks: [], diagnostics: [], calls: [] },
    latency: { budget: { timeoutSeconds: 90, steps: 12, perStepMs: 7500 }, nextAction: summary('next_action'),
      finalImage: summary('final_image'), diagnostics: [], calls: [call({ requestType: 'next_action' }), call({ requestType: 'next_action' })] },
    runDate: '2025-06-01', sdkVersion: '0.7.0', nodeVersion: 'v22.12.0', pinnedModel: 'typesafe/jev-1.14', samplesDir: '2025-06-01T120000Z',
    ...over,
  };
}

describe('findings', () => {
  const saved = process.env.OPENROUTER_API_KEY;
  afterEach(() => { if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved; });

  it('emits the four sections in order, each with a status line', () => {
    const md = buildFindings(input());
    const idx = SECTION_TITLES.map((t) => md.indexOf(`## ${SECTION_TITLES.indexOf(t) + 1}. ${t}`));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(md.match(/\*\*Status:\*\*/g)).toHaveLength(4);
    expect(md).toContain('TODO (human reviewer)');
  });

  it('fills metadata, model ids with counts, and the 7.5 s budget', () => {
    const md = buildFindings(input());
    for (const s of ['2025-06-01', '0.7.0', 'v22.12.0', '2025-06-01T120000Z', '`model` in the response body', 'x 3', '7.5 s']) expect(md).toContain(s);
  });

  it('writes a check that could not run as not confirmed with its cause', () => {
    const md = buildFindings(input({ latency: null, notRunReasons: { latency: 'no key' } }));
    expect(md).toContain('not confirmed. Cause: fixture file absent');
    expect(md).toContain('not confirmed. Cause: no key');
  });

  it('refuses to write when the text contains a credential value, and writes otherwise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'findings-'));
    process.env.OPENROUTER_API_KEY = 'sk-or-fabricated-secret-value';
    expect(() => writeFindings(input({ networkLocation: 'sk-or-fabricated-secret-value' }), join(dir, 'a', 'f.md'))).toThrow(/OPENROUTER_API_KEY/);
    const path = writeFindings(input(), join(dir, 'a', 'f.md'));
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain('sk-or-fabricated-secret-value');
  });
});
