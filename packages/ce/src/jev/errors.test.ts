import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StageError } from '../errors.js';
import { JevImageError, JevUsageError, RateLimitError } from './errors.js';

describe('jev errors', () => {
  it('JevImageError and RateLimitError are disjoint', () => {
    const image = new JevImageError('rate_limited', { status: 429 });
    const limit = new RateLimitError(1000);
    expect(image).not.toBeInstanceOf(RateLimitError);
    expect(limit).not.toBeInstanceOf(JevImageError);
  });

  it('omits status when not given', () => {
    const err = new JevImageError('timeout');
    expect('status' in err).toBe(false);
    expect(err.status).toBeUndefined();
    expect(new JevImageError('server', { status: 500 }).status).toBe(500);
  });

  it('carries retryAfterMs for rate_limited only', () => {
    const limited = new JevImageError('rate_limited', { status: 429, retryAfterMs: 1500 });
    expect(limited.retryAfterMs).toBe(1500);
    const other = new JevImageError('server', { status: 500, retryAfterMs: 1500 });
    expect('retryAfterMs' in other).toBe(false);
  });

  it('JevUsageError is neither a JevImageError nor a StageError', () => {
    const err = new JevUsageError('second image request');
    expect(err).not.toBeInstanceOf(JevImageError);
    expect(err).not.toBeInstanceOf(StageError);
    expect(err).not.toBeInstanceOf(RateLimitError);
  });

  it('StageError carries cause and callError', () => {
    const cause = new Error('write failed');
    const callError = new RateLimitError(undefined);
    const err = new StageError('runtime', cause, { callError });
    expect(err.stage).toBe('runtime');
    expect(err.cause).toBe(cause);
    expect(err.callError).toBe(callError);
    const plain = new StageError('context', cause);
    expect(plain.callError).toBeUndefined();
  });

  it('no message contains a generated secret', () => {
    const secret = `sk-${randomBytes(16).toString('hex')}`;
    const tainted = new Error(`Authorization: Bearer ${secret}`);
    const errors: Error[] = [
      new JevImageError('bad_request', { status: 400 }),
      new JevImageError('rate_limited', { status: 429, retryAfterMs: 10 }),
      new RateLimitError(10),
      new StageError('runtime', tainted),
      new StageError('runtime', tainted, { callError: tainted }),
    ];
    for (const err of errors) {
      expect(err.message).not.toContain(secret);
      expect(err.message).not.toMatch(/Authorization|Bearer/);
    }
  });
});
