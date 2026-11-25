import { describe, it, expect, afterEach } from 'vitest';
import { timedCall } from './call.js';

const meta = { requestType: 'noul' as const, provider: 'openrouter' as const, modelRequested: 'm', request: { a: 1 } };
let t = 0;
const now = () => (t += 10);

describe('timedCall', () => {
  it('records success fields', async () => {
    const r = await timedCall({ ...meta, optionCount: 3 }, async () => ({ model: 'mr', answers: {}, usage: { input_tokens: 5, output_tokens: 2 } }), now);
    expect(r).toMatchObject({ ok: true, modelReturned: 'mr', inputTokens: 5, outputTokens: 2, optionCount: 3, latencyMs: 10 });
  });
  it('catches a TypeError', async () => {
    const r = await timedCall(meta, async () => { throw new TypeError('boom'); }, now);
    expect(r).toMatchObject({ ok: false, errorClass: 'TypeError', errorMessage: 'boom', modelReturned: null });
  });
  it('catches a non-Error throw', async () => {
    const r = await timedCall(meta, async () => { throw { message: 'plain' }; }, now);
    expect(r).toMatchObject({ ok: false, errorClass: 'NonError', errorMessage: 'plain' });
  });
  it('captures status and retry-after from a rate-limit error', async () => {
    const r = await timedCall(meta, async () => { throw Object.assign(new Error('slow down'), { status: 429, headers: new Headers({ 'retry-after': '7' }) }); }, now);
    expect(r).toMatchObject({ ok: false, httpStatus: 429, retryAfter: '7' });
  });
  it('captures status from a plain object and retry-after from a plain headers record', async () => {
    const r = await timedCall(meta, async () => { throw { status: 503, message: 'down', headers: { 'retry-after': '3' } }; }, now);
    expect(r).toMatchObject({ ok: false, errorClass: 'NonError', httpStatus: 503, retryAfter: '3', errorMessage: 'down' });
  });
  it('captures status from an Error without headers', async () => {
    const r = await timedCall(meta, async () => { throw Object.assign(new Error('bad'), { status: 401 }); }, now);
    expect(r).toMatchObject({ ok: false, httpStatus: 401 });
    expect(r.retryAfter).toBeUndefined();
  });
  it('does not retry', async () => {
    let n = 0;
    await timedCall(meta, async () => { n++; throw new Error('x'); }, now);
    expect(n).toBe(1);
  });

  it('keeps the full message (up to 2000 chars) and the SDK error body in the sample response', async () => {
    const long = 'x'.repeat(1500);
    const err = Object.assign(new Error(`400 ${long}`), { status: 400, body: { detail: 'model not found', loc: ['body', 'model'] }, requestId: 'req-1' });
    const r = await timedCall(meta, async () => { throw err; }, now);
    expect(r.errorMessage?.length).toBe(1504);
    expect(r.raw.response).toMatchObject({ error: { status: 400, message: r.errorMessage, body: { detail: 'model not found' }, requestId: 'req-1' } });
  });
  it('caps the message at 2000 chars and keeps a string body', async () => {
    const r = await timedCall(meta, async () => { throw Object.assign(new Error('y'.repeat(5000)), { body: 'plain text body' }); }, now);
    expect(r.errorMessage?.length).toBe(2000);
    expect(r.raw.response).toMatchObject({ error: { body: 'plain text body' } });
  });
  it('keeps the label', async () => {
    const r = await timedCall({ ...meta, label: 'diag: x' }, async () => ({}), now);
    expect(r.label).toBe('diag: x');
  });
  describe('credential safety', () => {
    const saved = process.env.OPENROUTER_API_KEY;
    afterEach(() => { if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved; });
    it('never keeps a credential value from an error message or body', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-fabricated-secret-value';
      const err = Object.assign(new Error('bad key sk-or-fabricated-secret-value'), { status: 401, body: { echoed: 'sk-or-fabricated-secret-value', authorization: 'Bearer abc' } });
      const r = await timedCall(meta, async () => { throw err; }, now);
      expect(JSON.stringify(r)).not.toContain('sk-or-fabricated-secret-value');
      expect(JSON.stringify(r)).not.toContain('Bearer abc');
      expect(r.errorMessage).toContain('redacted');
    });
  });
});
