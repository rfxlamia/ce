import { describe, expect, it } from 'vitest';
import { resolveBrowsersPath } from './cache.js';

describe('resolveBrowsersPath', () => {
  it('uses PLAYWRIGHT_BROWSERS_PATH when set, on every platform', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      expect(resolveBrowsersPath({ PLAYWRIGHT_BROWSERS_PATH: '/custom/pw' }, platform, '/home/u')).toBe(
        '/custom/pw',
      );
    }
  });

  it('falls back to the default when PLAYWRIGHT_BROWSERS_PATH is unset or empty', () => {
    expect(resolveBrowsersPath({}, 'linux', '/home/u')).toBe('/home/u/.cache/ms-playwright');
    expect(resolveBrowsersPath({ PLAYWRIGHT_BROWSERS_PATH: '' }, 'linux', '/home/u')).toBe(
      '/home/u/.cache/ms-playwright',
    );
    expect(resolveBrowsersPath({}, 'darwin', '/Users/u')).toBe('/Users/u/Library/Caches/ms-playwright');
    expect(resolveBrowsersPath({}, 'win32', 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Local\\ms-playwright',
    );
  });

  it('ignores a trailing slash on home', () => {
    expect(resolveBrowsersPath({}, 'linux', '/home/u/')).toBe('/home/u/.cache/ms-playwright');
  });
});
