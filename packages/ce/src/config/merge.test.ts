import { describe, expect, it } from 'vitest';
import { mergeSources } from './merge.js';

const empty = {};

describe('mergeSources precedence', () => {
  it('flags win over env', () => {
    const { merged, sources } = mergeSources({
      flags: { runtime: { 'max-steps': 1 } },
      envValues: { runtime: { 'max-steps': 2 } },
      fileValues: empty,
      defaults: empty,
    });
    expect(merged).toEqual({ runtime: { 'max-steps': 1 } });
    expect(sources['runtime.max-steps']).toBe('flag');
  });

  it('env wins over file', () => {
    const { merged, sources } = mergeSources({
      flags: empty,
      envValues: { runtime: { 'max-steps': 2 } },
      fileValues: { runtime: { 'max-steps': 3 } },
      defaults: empty,
    });
    expect(merged).toEqual({ runtime: { 'max-steps': 2 } });
    expect(sources['runtime.max-steps']).toBe('env');
  });

  it('file wins over defaults', () => {
    const { merged, sources } = mergeSources({
      flags: empty,
      envValues: empty,
      fileValues: { runtime: { 'max-steps': 3 } },
      defaults: { runtime: { 'max-steps': 4 } },
    });
    expect(merged).toEqual({ runtime: { 'max-steps': 3 } });
    expect(sources['runtime.max-steps']).toBe('file');
  });

  it('falls back to defaults when no other source defines the leaf', () => {
    const { merged, sources } = mergeSources({
      flags: empty,
      envValues: empty,
      fileValues: empty,
      defaults: { runtime: { 'max-steps': 4 } },
    });
    expect(merged).toEqual({ runtime: { 'max-steps': 4 } });
    expect(sources['runtime.max-steps']).toBe('default');
  });
});

describe('mergeSources nesting and sources map', () => {
  it('keeps untouched sibling leaves from lower sources', () => {
    const { merged, sources } = mergeSources({
      flags: { runtime: { 'max-steps': 1 } },
      envValues: empty,
      fileValues: { runtime: { timeout: '30s' } },
      defaults: { runtime: { 'max-steps': 9, timeout: '60s', headless: true } },
    });
    expect(merged).toEqual({ runtime: { 'max-steps': 1, timeout: '30s', headless: true } });
    expect(sources).toEqual({
      'runtime.max-steps': 'flag',
      'runtime.timeout': 'file',
      'runtime.headless': 'default',
    });
  });

  it('records one source per leaf across all four sources', () => {
    const { sources } = mergeSources({
      flags: { a: { f: 1 } },
      envValues: { a: { e: 2 } },
      fileValues: { b: { g: 3 } },
      defaults: { a: { f: 0, e: 0 }, b: { g: 0, d: 0 } },
    });
    expect(sources).toEqual({
      'a.f': 'flag',
      'a.e': 'env',
      'b.g': 'file',
      'b.d': 'default',
    });
  });

  it('treats list-valued keys as whole leaves without concatenation', () => {
    const { merged, sources } = mergeSources({
      flags: empty,
      envValues: { context: { include: ['x'] } },
      fileValues: { context: { include: ['y', 'z'] } },
      defaults: { context: { include: ['d'] } },
    });
    expect(merged).toEqual({ context: { include: ['x'] } });
    expect(sources['context.include']).toBe('env');
  });

  it('does not mutate inputs', () => {
    const defaults = { a: { b: [1] } };
    const result = mergeSources({ flags: empty, envValues: empty, fileValues: empty, defaults });
    (result.merged.a as { b: number[] }).b.push(2);
    expect(defaults).toEqual({ a: { b: [1] } });
  });
});
