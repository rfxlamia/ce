// Task 7.3: a started run must not modify examples/demo-app (Requirements 7.2, 7.3, 7.5).
// Loopback only, no Jev call, no API key.

import { createHash } from 'node:crypto';
import { readdir, readFile, lstat, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_APP_DIR,
  DemoAppCleanup,
  buildDemoApp,
  isPortClosed,
  makeTempDir,
  pickFreePort,
} from './demo-app.testsupport.js';
import { openTarget } from './target.js';

const TIMEOUT = 90000;

/** Directory names skipped at any depth: dependencies and Vite caches only. */
const EXCLUDED = new Set(['node_modules', '.vite']);

/** Content hash over relative paths, entry kinds and file contents (dist included). */
async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(dir: string): Promise<void> {
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      if (EXCLUDED.has(name)) continue;
      const full = join(dir, name);
      const rel = relative(root, full);
      const st = await lstat(full);
      if (st.isDirectory()) {
        hash.update(`D:${rel}\0`);
        await walk(full);
      } else if (st.isSymbolicLink()) {
        hash.update(`L:${rel}\0${await readlink(full)}\0`);
      } else {
        hash.update(`F:${rel}\0`);
        hash.update(await readFile(full));
        hash.update('\0');
      }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

describe('Target_Manager does not modify examples/demo-app', () => {
  const cleanup = new DemoAppCleanup();
  let outDir = '';
  let runDir = '';

  beforeAll(async () => {
    outDir = cleanup.addDir(await makeTempDir('ce-nonmod-build-'));
    runDir = cleanup.addDir(await makeTempDir('ce-nonmod-run-'));
    await buildDemoApp(outDir);
  }, TIMEOUT);

  afterAll(async () => {
    await cleanup.run();
  }, TIMEOUT);

  it(
    'leaves the demo-app content hash unchanged across a started run',
    async () => {
      const port = await pickFreePort();
      const before = await hashTree(DEMO_APP_DIR);

      const handle = await openTarget({
        url: `http://localhost:${port}/`,
        start: `npx --no-install vite preview --outDir ${outDir} --port ${port} --strictPort`,
        ready: { timeout: '60s' },
        cwd: DEMO_APP_DIR,
        env: { ...process.env },
        runDir,
      });
      try {
        expect(handle.mode).toBe('started');
      } finally {
        await handle.stop();
      }
      expect(isPortClosed(port)).toBe(true);

      const after = await hashTree(DEMO_APP_DIR);
      expect(after).toBe(before);
    },
    TIMEOUT,
  );
});
