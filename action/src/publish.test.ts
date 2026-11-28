import { describe, expect, it } from 'vitest';
import { validatePublishMode } from './publish.js';

describe('validatePublishMode (Requirements 12.2, 12.3, 12.4, 15.8)', () => {
  it('maps an empty value to none', () => {
    expect(validatePublishMode('')).toBe('none');
  });

  it('accepts none', () => {
    expect(validatePublishMode('none')).toBe('none');
  });

  it('accepts branch', () => {
    expect(validatePublishMode('branch')).toBe('branch');
  });

  it('rejects an invalid value and lists the allowed values', () => {
    for (const bad of ['nope', 'None', 'BRANCH', ' branch', 'push']) {
      let message = '';
      try {
        validatePublishMode(bad);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('publish: invalid value');
      expect(message).toContain('none');
      expect(message).toContain('branch');
      expect(message).not.toContain('not implemented');
    }
  });
});
