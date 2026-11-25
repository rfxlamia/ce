import { describe, it, expect } from 'vitest';
import { buildClient } from './client.js';

describe('buildClient', () => {
  it('points openrouter at openrouter.ai with retries disabled', () => {
    const c = buildClient({ provider: 'openrouter', env: { OPENROUTER_API_KEY: 'x' } });
    expect(c.baseURL).toBe('https://openrouter.ai/api');
    expect(c.retry.maxRetries).toBe(0);
  });
  it('uses the default base URL for typesafe', () => {
    const c = buildClient({ provider: 'typesafe', env: { TYPESAFE_API_KEY: 'x' } });
    expect(c.baseURL).not.toContain('openrouter');
  });
});
