import { describe, expect, it } from 'vitest';
import { sanitizeChildEnv } from './env.js';

describe('sanitizeChildEnv (Requirement 5.11)', () => {
  it('removes the six forbidden variables and keeps the others', () => {
    const env = {
      'INPUT_GITHUB-TOKEN': 'a',
      ACTIONS_RUNTIME_TOKEN: 'b',
      ACTIONS_CACHE_URL: 'c',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'd',
      GITHUB_TOKEN: 'e',
      GH_TOKEN: 'f',
      GITHUB_EVENT_PATH: '/tmp/event.json',
      CE_FOO: 'bar',
      PATH: '/usr/bin',
    };
    const out = sanitizeChildEnv(env, 'tok', { CE_MIRROR: '1' });
    expect(out).toEqual({
      GITHUB_EVENT_PATH: '/tmp/event.json',
      CE_FOO: 'bar',
      PATH: '/usr/bin',
      CE_MIRROR: '1',
    });
  });

  it('removes a variable whose value equals the Run_Token', () => {
    const out = sanitizeChildEnv({ OTHER: 'secret', KEEP: 'x' }, 'secret', {});
    expect(out).toEqual({ KEEP: 'x' });
  });
});
