// Test support for integration tests against examples/demo-app.
// Not a test file (vitest only collects *.test.ts). No Jev call, no API key.
// Builds and serves the Demo_App from a unique temporary directory so that
// nothing is ever written under examples/demo-app (including dist).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of examples/demo-app (this file lives in packages/ce/src/runtime). */
export const DEMO_APP_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../examples/demo-app',
);

/** Pick a free loopback TCP port at run time. */
export function pickFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not determine a free port'));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolvePort(port)));
    });
  });
}

/** Create a unique directory under the OS temporary directory. */
export function makeTempDir(prefix = 'ce-demo-app-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Build the Demo_App into `outDir` (outside the app root, hence --emptyOutDir).
 * Runs with examples/demo-app as the working directory. Rejects with the
 * build output on a non-zero exit.
 */
export function buildDemoApp(outDir: string): Promise<void> {
  return new Promise((resolveBuild, reject) => {
    const child = spawn(
      'npx',
      ['--no-install', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'],
      { cwd: DEMO_APP_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let output = '';
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolveBuild();
      else reject(new Error(`vite build failed (code ${code}, signal ${signal}):\n${output}`));
    });
  });
}

/** A preview server owned by the test. */
export interface DemoServer {
  readonly url: string;
  readonly port: number;
  readonly child: ChildProcess;
  /** Stop the whole process group. Idempotent. */
  stop(): Promise<void>;
}

/** Signal a detached process group; ignore a group that is already gone. */
function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // already gone
  }
}

/**
 * Start `vite preview` for a previously built `outDir` on `port`, as a
 * detached process group, and resolve once it answers on that port.
 */
export async function startPreview(
  outDir: string,
  port: number,
  readyTimeoutMs = 30000,
): Promise<DemoServer> {
  const child = spawn(
    'npx',
    ['--no-install', 'vite', 'preview', '--outDir', outDir, '--strictPort', '--port', String(port)],
    { cwd: DEMO_APP_DIR, detached: true, stdio: 'ignore', env: process.env },
  );
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  child.on('error', () => {
    exited = true;
  });

  const url = `http://localhost:${port}/`;
  const stop = async (): Promise<void> => {
    if (exited) {
      killGroup(child.pid, 'SIGKILL'); // sweep stragglers of the group
      return;
    }
    const done = new Promise<void>((r) => child.once('exit', () => r()));
    killGroup(child.pid, 'SIGTERM');
    const timer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 5000);
    await done;
    clearTimeout(timer);
    killGroup(child.pid, 'SIGKILL');
  };

  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    if (exited) throw new Error('vite preview exited before it became ready');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status >= 200 && res.status < 400) break;
    } catch {
      // not ready yet
    }
    if (Date.now() >= deadline) {
      await stop();
      throw new Error(`vite preview not ready on ${url} within ${readyTimeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, port, child, stop };
}

/** Collects servers and temporary directories and releases them together. */
export class DemoAppCleanup {
  private readonly servers: DemoServer[] = [];
  private readonly dirs: string[] = [];

  addServer(server: DemoServer): DemoServer {
    this.servers.push(server);
    return server;
  }

  addDir(dir: string): string {
    this.dirs.push(dir);
    return dir;
  }

  /** Stop every registered process, then remove every registered directory. */
  async run(): Promise<void> {
    const servers = this.servers.splice(0);
    await Promise.allSettled(servers.map((s) => s.stop()));
    const dirs = this.dirs.splice(0);
    await Promise.allSettled(dirs.map((d) => rm(d, { recursive: true, force: true })));
  }
}

/** Synchronous best-effort check that nothing listens on `port` (for tests). */
export function isPortClosed(port: number): boolean {
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      `const s=require('net').connect(${port},'127.0.0.1');s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));`,
    ],
    { timeout: 5000 },
  );
  return r.status === 0;
}
