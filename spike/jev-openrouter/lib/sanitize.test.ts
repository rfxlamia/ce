import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertNoEnvLeak, sanitizeRequest } from './sanitize.js';

const NAMES = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const n of NAMES) saved[n] = process.env[n];
});

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe('assertNoEnvLeak', () => {
  it('throws when a string contains a set env value, naming the variable but not the value', () => {
    process.env.OPENROUTER_API_KEY = 'fake-or-key-123';
    expect(() => assertNoEnvLeak('header: Bearer fake-or-key-123')).toThrow(/OPENROUTER_API_KEY/);
    try {
      assertNoEnvLeak('x fake-or-key-123 y');
    } catch (e) {
      expect((e as Error).message).not.toContain('fake-or-key-123');
    }
  });

  it('throws for the TYPESAFE_API_KEY value inside a nested object', () => {
    process.env.TYPESAFE_API_KEY = 'fake-ts-key-456';
    expect(() => assertNoEnvLeak({ a: [{ b: 'fake-ts-key-456' }] })).toThrow(/TYPESAFE_API_KEY/);
  });

  it('passes when no env value appears', () => {
    process.env.OPENROUTER_API_KEY = 'fake-or-key-123';
    process.env.TYPESAFE_API_KEY = 'fake-ts-key-456';
    expect(() => assertNoEnvLeak('nothing secret here')).not.toThrow();
    expect(() => assertNoEnvLeak({ a: 1 })).not.toThrow();
  });

  it('passes when the env variables are unset', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    expect(() => assertNoEnvLeak('anything')).not.toThrow();
  });
});

describe('sanitizeRequest', () => {
  it('strips the Authorization header and leaves other fields untouched', () => {
    const input = {
      url: 'https://example.test/v1',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      body: { model: 'm', n: 1 },
    };
    expect(sanitizeRequest(input)).toEqual({
      url: 'https://example.test/v1',
      headers: { 'Content-Type': 'application/json' },
      body: { model: 'm', n: 1 },
    });
  });
});
