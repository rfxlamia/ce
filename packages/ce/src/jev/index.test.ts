import { describe, expect, it } from 'vitest';
import * as api from '../index.js';

describe('public API (Requirement 13.7)', () => {
  it.each([
    'createJevGateway',
    'FakeJevGateway',
    'FakeRecordingMissingError',
    'JevImageError',
    'RateLimitError',
    'JevUsageError',
    'StageError',
  ])('exports %s as a function', (name) => {
    expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
  });

  it('exports error classes that extend Error', () => {
    for (const name of [
      'FakeRecordingMissingError',
      'JevImageError',
      'RateLimitError',
      'JevUsageError',
      'StageError',
    ]) {
      const ctor = (api as Record<string, unknown>)[name] as { prototype: unknown };
      expect(ctor.prototype instanceof Error).toBe(true);
    }
  });

  it('exports neither a transport nor the probe library nor stateHash', () => {
    const forbidden =
      /transport|probe|stateHash|SdkTransport|JsonTransport|HybridJevGateway/i;
    const offending = Object.keys(api).filter((key) => forbidden.test(key));
    expect(offending).toEqual([]);
  });
});
