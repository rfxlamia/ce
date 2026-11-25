import { describe, expect, it } from 'vitest';
import { resolveCliArgs } from './cli-args.js';

describe('resolveCliArgs', () => {
  it('is unavailable with no-input when nothing is given', () => {
    expect(resolveCliArgs({})).toEqual({
      claims: [],
      status: { name: 'cli', status: 'unavailable', reason: 'no-input' },
    });
  });

  it('treats empty claim list and empty base as no-input', () => {
    const r = resolveCliArgs({ claim: [], base: '' });
    expect(r.status).toEqual({ name: 'cli', status: 'unavailable', reason: 'no-input' });
    expect(r.base).toBeUndefined();
  });

  it('returns claims in order with cli provenance and 1-based locations', () => {
    const r = resolveCliArgs({ claim: ['first', 'second'] });
    expect(r.status).toEqual({ name: 'cli', status: 'used' });
    expect(r.claims).toEqual([
      { text: 'first', provenance: { provider: 'cli', location: '--claim[1]' } },
      { text: 'second', provenance: { provider: 'cli', location: '--claim[2]' } },
    ]);
    expect(r.base).toBeUndefined();
  });

  it('returns base with provenance --base', () => {
    const r = resolveCliArgs({ base: 'origin/dev' });
    expect(r.status.status).toBe('used');
    expect(r.claims).toEqual([]);
    expect(r.base).toEqual({ ref: 'origin/dev', provenance: { provider: 'cli', location: '--base' } });
  });

  it('keeps claim text unsplit and unmodified', () => {
    const text = '  One sentence. Another sentence.\n- item  ';
    expect(resolveCliArgs({ claim: [text] }).claims[0]?.text).toBe(text);
  });

  it('never carries a reason when used', () => {
    expect(resolveCliArgs({ claim: ['x'], base: 'main' }).status.reason).toBeUndefined();
  });
});
