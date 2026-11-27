import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';
import { VERSION as LEAF_VERSION } from './version.js';

describe('version constant', () => {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

  it('equals the version field of packages/ce/package.json', () => {
    expect(LEAF_VERSION).toBe(pkg.version);
  });

  it('is re-exported unchanged from index.ts', () => {
    expect(VERSION).toBe(LEAF_VERSION);
  });
});
