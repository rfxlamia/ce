import { describe, expect, it } from 'vitest';

import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import {
  DEFAULT_READY_PATH,
  DEFAULT_READY_TIMEOUT,
  buildProbeUrl,
  failureToLastStatus,
  isLoopbackHost,
  probeTimeoutMs,
  resolveReadyDefaults,
  targetOptionsFromConfig,
  TargetConfigError,
} from './target.js';

describe('buildProbeUrl (Requirement 3.2)', () => {
  it('keeps the base path and appends a leading-slash ready path', () => {
    expect(buildProbeUrl('http://h/app', '/health')).toBe('http://h/app/health');
  });

  it('joins a trailing-slash base and a ready path without a leading slash', () => {
    expect(buildProbeUrl('http://h/app/', 'health')).toBe('http://h/app/health');
  });

  it('gives the root URL for a bare host and ready path "/"', () => {
    expect(buildProbeUrl('http://h', '/')).toBe('http://h/');
  });

  it('drops the query and fragment of the base', () => {
    expect(buildProbeUrl('http://h/app?x=1#f', '/health')).toBe('http://h/app/health');
  });
});

describe('failureToLastStatus (Requirement 4.3)', () => {
  it.each([
    [{ cause: { code: 'ECONNREFUSED' } }, 'connection-refused'],
    [{ code: 'ECONNREFUSED' }, 'connection-refused'],
    [{ cause: { code: 'ENOTFOUND' } }, 'dns'],
    [{ cause: { code: 'EAI_AGAIN' } }, 'dns'],
    [{ code: 'EAI_AGAIN' }, 'dns'],
    [{ name: 'AbortError' }, 'timeout'],
    [{ name: 'TimeoutError' }, 'timeout'],
    [{ cause: { code: 'ECONNRESET' } }, 'network'],
    [new Error('boom'), 'network'],
    [undefined, 'network'],
    [null, 'network'],
    ['string error', 'network'],
  ])('maps %j to %s', (error, expected) => {
    expect(failureToLastStatus(error)).toBe(expected);
  });

  it('prefers the error code over the abort name', () => {
    expect(failureToLastStatus({ name: 'AbortError', cause: { code: 'ECONNREFUSED' } })).toBe(
      'connection-refused',
    );
  });
});

describe('isLoopbackHost (Requirement 8.4)', () => {
  it.each(['localhost', '127.0.0.1', '127.1.2.3', '127.255.255.255', '::1', '[::1]', '0.0.0.0'])(
    'treats %s as loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['example.com', 'app', '10.0.0.1', '128.0.0.1', '127.0.0.256', '127.0.0', '::2'])(
    'treats %s as non-loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe('probeTimeoutMs (Requirement 3.6)', () => {
  it('is min(2000, remaining)', () => {
    expect(probeTimeoutMs(10_000)).toBe(2000);
    expect(probeTimeoutMs(2000)).toBe(2000);
    expect(probeTimeoutMs(500)).toBe(500);
    expect(probeTimeoutMs(0)).toBe(0);
  });
});

describe('defaults (Requirement 3.1)', () => {
  it('uses "/" and 30s', () => {
    expect(DEFAULT_READY_PATH).toBe('/');
    expect(DEFAULT_READY_TIMEOUT).toBe('30s');
    expect(resolveReadyDefaults(undefined)).toEqual({ path: '/', timeoutMs: 30_000 });
    expect(resolveReadyDefaults({})).toEqual({ path: '/', timeoutMs: 30_000 });
  });

  it('honours explicit values', () => {
    expect(resolveReadyDefaults({ path: '/health', timeout: '5s' })).toEqual({
      path: '/health',
      timeoutMs: 5000,
    });
  });

  it('throws a TargetConfigError naming target.ready.timeout for an invalid duration', () => {
    let caught: unknown;
    try {
      resolveReadyDefaults({ timeout: 'soon' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TargetConfigError);
    expect((caught as TargetConfigError).key).toBe('target.ready.timeout');
  });
});

describe('targetOptionsFromConfig (Requirements 8.2, 9.2)', () => {
  const env = { PATH: '/bin' };

  it('sets only cwd and env when the config has no target keys', () => {
    const options = targetOptionsFromConfig(ConfigDefaults, { cwd: '/work', env });
    expect(options).toEqual({ cwd: '/work', env });
  });

  it('maps the four target keys and the caller extras, and nothing else', () => {
    const controller = new AbortController();
    const config = {
      ...ConfigDefaults,
      target: {
        url: 'http://localhost:3000',
        start: 'npm run dev',
        ready: { path: '/health', timeout: '10s' },
      },
    } as EffectiveConfig;

    const options = targetOptionsFromConfig(config, {
      cwd: '/work',
      env,
      runDir: '/work/run',
      signal: controller.signal,
    });

    expect(options).toEqual({
      url: 'http://localhost:3000',
      start: 'npm run dev',
      ready: { path: '/health', timeout: '10s' },
      cwd: '/work',
      env,
      runDir: '/work/run',
      signal: controller.signal,
    });
    for (const key of ['fetch', 'spawn', 'now', 'sleep', 'process', 'secrets', 'stopOnSignals']) {
      expect(options).not.toHaveProperty(key);
    }
  });

  it('omits ready keys that are absent', () => {
    const config = {
      ...ConfigDefaults,
      target: { url: 'http://localhost:3000', ready: { path: '/up' } },
    } as EffectiveConfig;
    const options = targetOptionsFromConfig(config, { cwd: '/work', env });
    expect(options.ready).toEqual({ path: '/up' });
    expect(options).not.toHaveProperty('start');
    expect(options).not.toHaveProperty('runDir');
    expect(options).not.toHaveProperty('signal');
  });
});
