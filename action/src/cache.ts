import { createRequire } from 'node:module';

/**
 * Cache_Key: stable across restores, distinct across OS, arch and playwright
 * version (Requirements 4.2, 4.9).
 */
export function buildCacheKey(os: string, arch: string, playwrightVersion: string): string {
  // Escape '%' and '-' so the '-' separator cannot be forged by a component.
  const enc = (s: string): string => s.replace(/%/g, '%25').replace(/-/g, '%2D');
  return `ce-playwright-chromium-${enc(os)}-${enc(arch)}-${enc(playwrightVersion)}`;
}

/**
 * Resolves Browsers_Path the way Playwright does: `PLAYWRIGHT_BROWSERS_PATH`
 * when set and non-empty, otherwise the OS default under `home`
 * (Requirement 4.10).
 */
export function resolveBrowsersPath(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  home: string,
): string {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override !== undefined && override !== '') return override;
  const trim = (p: string): string => p.replace(/[\\/]+$/, '');
  const base = trim(home);
  switch (platform) {
    case 'win32':
      return `${base}\\AppData\\Local\\ms-playwright`;
    case 'darwin':
      return `${base}/Library/Caches/ms-playwright`;
    default:
      return `${base}/.cache/ms-playwright`;
  }
}

/**
 * Reads the version of the `playwright` package installed next to the Action
 * bundle (Requirement 4.2). `resolveFrom` is the module URL or path used to
 * locate the package; it defaults to this module.
 */
export function readPlaywrightVersion(resolveFrom: string = import.meta.url): string {
  const require = createRequire(resolveFrom);
  const pkg = require('playwright/package.json') as { version?: unknown };
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    throw new Error('cannot read the installed playwright version');
  }
  return pkg.version;
}
