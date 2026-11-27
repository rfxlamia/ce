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
  it('treats prototype-named variables as plain data in env and mirrorEnv', () => {
    const names = ['valueOf', 'toString', 'constructor', '__proto__', 'hasOwnProperty'];
    const own = (o: object) => Object.fromEntries(Object.entries(o));
    const env: Record<string, string> = {};
    const mirror: Record<string, string> = {};
    for (const n of names) {
      Object.defineProperty(env, n, { value: `env-${n}`, enumerable: true, configurable: true, writable: true });
    }
    for (const n of ['toString']) {
      Object.defineProperty(mirror, n, { value: `mirror-${n}`, enumerable: true, configurable: true, writable: true });
    }
    const out = sanitizeChildEnv(env, 'tok', mirror);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(own(out)).toEqual({
      valueOf: 'env-valueOf',
      toString: 'mirror-toString',
      constructor: 'env-constructor',
      ['__proto__']: 'env-__proto__',
      hasOwnProperty: 'env-hasOwnProperty',
    });
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
  });
  it('drops a prototype-named variable whose value equals the Run_Token', () => {
    const out = sanitizeChildEnv({ valueOf: 'tok' }, 'tok', {});
    expect(Object.hasOwn(out, 'valueOf')).toBe(false);
  });
});
