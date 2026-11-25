import { describe, expect, it } from 'vitest';
import { ConfigSchema, SECRETS_IN_ENV_MESSAGE } from './schema.js';
import { INLINE_FLAG_EXPECTED } from './redact-pattern.js';

function issuesOf(input: unknown) {
  const result = ConfigSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues;
}

describe('ConfigSchema: valid input (Requirements 1.1-1.10)', () => {
  it('accepts an empty object (every key optional)', () => {
    expect(ConfigSchema.safeParse({}).success).toBe(true);
  });

  it('accepts every key of Requirement 1 criterion 1 with a valid value', () => {
    const full = {
      version: 0,
      target: {
        url: 'http://localhost:3000',
        start: 'npm start',
        ready: { path: '/health', timeout: '30s' },
        routes: ['/', '/about'],
      },
      context: {
        base: 'main',
        include: ['src/**'],
        exclude: ['dist/**'],
        redact: ['token\\s*[:=]\\s*\\S+'],
        checks: 'junit.xml',
      },
      assessment: {
        thresholds: { claim: 0.6, observable: 0, adequate: 1 },
        'uncertainty-band': 0.1,
        'on-uncertain': 'skip',
      },
      runtime: {
        'max-steps': 12,
        timeout: '500ms',
        viewport: { width: 1280, height: 800 },
        fixtures: { user: 'alice', token: 'abc' },
      },
      jev: { provider: 'typesafe', model: 'typesafe/jev-1.14' },
      output: { dir: '.ce/runs', 'fail-on': ['error', 'unsupported', 'evidenced-not-reached'] },
    };
    const result = ConfigSchema.safeParse(full);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(full);
  });

  it('accepts only 0 for version', () => {
    expect(ConfigSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(ConfigSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it('accepts https URLs and duration units ms, s and m', () => {
    expect(ConfigSchema.safeParse({ target: { url: 'https://example.com/app' } }).success).toBe(true);
    for (const timeout of ['1ms', '90s', '2m']) {
      expect(ConfigSchema.safeParse({ runtime: { timeout } }).success).toBe(true);
    }
  });
});

describe('ConfigSchema: Validation_Error categories (Requirement 9.2)', () => {
  it('rejects a wrong type', () => {
    const issues = issuesOf({ runtime: { 'max-steps': 'twelve' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('invalid_type');
    expect(issues[0]?.path).toEqual(['runtime', 'max-steps']);
  });

  it('rejects an out-of-range number', () => {
    const issues = issuesOf({ assessment: { thresholds: { claim: 1.5 } } });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('too_big');
    expect(issues[0]?.path).toEqual(['assessment', 'thresholds', 'claim']);

    const low = issuesOf({ assessment: { 'uncertainty-band': -0.1 } });
    expect(low[0]?.code).toBe('too_small');
    expect(low[0]?.path).toEqual(['assessment', 'uncertainty-band']);
  });

  it('rejects zero, negative and non-integer values for positive integers', () => {
    for (const value of [0, -1, 1.5]) {
      const issues = issuesOf({ runtime: { viewport: { width: value } } });
      expect(issues[0]?.path).toEqual(['runtime', 'viewport', 'width']);
    }
  });

  it('rejects an invalid enum value', () => {
    const issues = issuesOf({ jev: { provider: 'openai' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('invalid_value');
    expect(issues[0]?.path).toEqual(['jev', 'provider']);

    const failOn = issuesOf({ output: { 'fail-on': ['error', 'nope'] } });
    expect(failOn[0]?.path).toEqual(['output', 'fail-on', 1]);
  });

  it('rejects a malformed duration', () => {
    for (const timeout of ['90', '1h', '0.5s', '-5s', 's', '10 s']) {
      const issues = issuesOf({ runtime: { timeout } });
      expect(issues[0]?.code).toBe('invalid_format');
      expect(issues[0]?.path).toEqual(['runtime', 'timeout']);
    }
    const ready = issuesOf({ target: { ready: { timeout: 'soon' } } });
    expect(ready[0]?.path).toEqual(['target', 'ready', 'timeout']);
  });

  it('rejects an invalid URL, including a non-http scheme', () => {
    for (const url of ['not a url', 'localhost:3000', 'ftp://example.com', 'file:///etc/passwd']) {
      const issues = issuesOf({ target: { url } });
      expect(issues[0]?.path).toEqual(['target', 'url']);
    }
  });

  it('rejects an invalid regular expression', () => {
    const issues = issuesOf({ context: { redact: ['ok', '(unclosed'] } });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(['context', 'redact', 1]);
    expect(issues[0]?.code).toBe('custom');
    expect(issues[0]?.message).toMatch(/RegExp/);
  });

  it('rejects an unknown key and names it', () => {
    const issues = issuesOf({ runtime: { 'max-step': 3 } });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('unrecognized_keys');
    expect(issues[0]?.path).toEqual(['runtime']);
    expect(issues[0]?.message).toContain('max-step');
    expect(issues[0]?.message).not.toContain(SECRETS_IN_ENV_MESSAGE);

    expect(issuesOf({ extra: true })[0]?.path).toEqual([]);
  });

  it.each(['api-key', 'apikey', 'secret', 'token', 'password', 'OPENROUTER_API_KEY'.replace('_API_KEY', '_token')])(
    'rejects credential-named key %s with the secrets-in-env message',
    (key) => {
      const issues = issuesOf({ jev: { [key]: 'x' } });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe('unrecognized_keys');
      expect(issues[0]?.path).toEqual(['jev']);
      expect(issues[0]?.message).toContain(SECRETS_IN_ENV_MESSAGE);
      expect(issues[0]?.message).toContain(key);
    },
  );

  it('accepts credential-named keys inside runtime.fixtures', () => {
    expect(ConfigSchema.safeParse({ runtime: { fixtures: { password: 'p', api_key: 'k' } } }).success).toBe(true);
  });
});

describe('ConfigSchema: context.redact (Requirements 1.11, 1.14-1.17, 9.3)', () => {
  it('accepts a plain RegExp source', () => {
    expect(ConfigSchema.safeParse({ context: { redact: ['token\\s*[:=]\\s*\\S+'] } }).success).toBe(true);
  });

  it('accepts the /pattern/flags form', () => {
    const item = '/token\\s*[:=]\\s*\\S+/i';
    expect(ConfigSchema.safeParse({ context: { redact: [item] } }).success).toBe(true);
    // The loader compiles this item as new RegExp(pattern, flags); it must match case-insensitively.
    expect(new RegExp('token\\s*[:=]\\s*\\S+', 'i').test('TOKEN: abc')).toBe(true);
  });

  it('rejects the (?i) inline-flag form with the /pattern/i guidance at context.redact.0', () => {
    const item = '(?i)token\\s*[:=]\\s*\\S+';
    const result = ConfigSchema.safeParse({ context: { redact: [item] } });
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues).toHaveLength(1);
    const issue = issues[0];
    expect(issue?.path.join('.')).toBe('context.redact.0');
    expect(issue?.message).toMatch(/pattern/i);
    expect(issue?.message).toBe(INLINE_FLAG_EXPECTED);
    expect(issue?.message).toContain('/pattern/i');
    expect(issue?.code).toBe('custom');
    expect((issue as { params?: { expected?: string } }).params?.expected).toBe(INLINE_FLAG_EXPECTED);
    // zod 4 carries the offending value as `input` only when reportInput is set; the item
    // is recoverable from the path in the original input.
    const redact = [item];
    expect(redact[issue?.path[2] as number]).toBe(item);
  });
});
