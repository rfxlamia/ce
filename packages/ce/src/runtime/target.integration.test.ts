// Integration tests of the Target_Manager against examples/demo-app (task 7.2).
// Real processes, loopback only. No Jev call, no real API key.

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_APP_DIR,
  DemoAppCleanup,
  buildDemoApp,
  isPortClosed,
  makeTempDir,
  pickFreePort,
  startPreview,
} from './demo-app.testsupport.js';
import {
  TargetConfigError,
  TargetUnreachableError,
  openTarget,
  type TargetHandle,
} from './target.js';

const TIMEOUT = 90000;

const cleanup = new DemoAppCleanup();
const handles: TargetHandle[] = [];
let buildDir = '';

/** Environment for runs: the process environment without any real Jev key. */
function baseEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.TYPESAFE_API_KEY;
  return env;
}

/** Recording fetch: delegates to the global fetch and records method and URL. */
function recordingFetch(): { fetch: typeof fetch; calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const fn = ((input: unknown, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(input) });
    return fetch(input as Parameters<typeof fetch>[0], init);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

/** Spawn that records calls and delegates to the real spawn. */
function recordingSpawn(): { spawn: typeof nodeSpawn; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const fn = ((...args: unknown[]) => {
    calls.push(args);
    return (nodeSpawn as (...a: unknown[]) => unknown)(...args);
  }) as unknown as typeof nodeSpawn;
  return { spawn: fn, calls };
}

async function open(options: Parameters<typeof openTarget>[0]): Promise<TargetHandle> {
  const handle = await openTarget(options);
  handles.push(handle);
  return handle;
}

beforeAll(async () => {
  buildDir = cleanup.addDir(await makeTempDir('ce-target-int-'));
  await buildDemoApp(buildDir);
}, TIMEOUT);

afterAll(async () => {
  await Promise.allSettled(handles.splice(0).map((h) => h.stop()));
  await cleanup.run();
}, TIMEOUT);

describe('Target_Manager against the Demo_App', () => {
  it(
    'Attached: resolves a served URL without spawning and leaves the server running',
    async () => {
      const port = await pickFreePort();
      const server = cleanup.addServer(await startPreview(buildDir, port));
      const rec = recordingSpawn();
      const probes = recordingFetch();

      const handle = await open({
        url: server.url,
        cwd: DEMO_APP_DIR,
        env: baseEnv(),
        spawn: rec.spawn,
        fetch: probes.fetch,
      });

      expect(handle.mode).toBe('attached');
      expect(handle.baseUrl).toBe(server.url);
      expect(typeof handle.lastStatus).toBe('number');
      expect(handle.lastStatus as number).toBeGreaterThanOrEqual(200);
      expect(handle.lastStatus as number).toBeLessThanOrEqual(399);
      expect(rec.calls).toHaveLength(0);
      expect(probes.calls.length).toBeGreaterThan(0);
      expect(probes.calls.every((c) => c.method === 'GET')).toBe(true);

      await handle.stop();
      const res = await fetch(server.url, { signal: AbortSignal.timeout(5000) });
      expect(res.status).toBe(200);
    },
    TIMEOUT,
  );

  it(
    'Started: starts vite preview, captures logs, and closes the port on stop',
    async () => {
      const port = await pickFreePort();
      const runDir = cleanup.addDir(await makeTempDir('ce-target-run-'));
      const url = `http://localhost:${port}/`;

      const handle = await open({
        url,
        start: `npx --no-install vite preview --outDir ${buildDir} --port ${port} --strictPort`,
        cwd: DEMO_APP_DIR,
        env: baseEnv(),
        runDir,
        ready: { timeout: '60s' },
      });

      expect(handle.mode).toBe('started');
      expect(handle.baseUrl).toBe(url);
      expect(handle.lastStatus as number).toBeGreaterThanOrEqual(200);
      expect(handle.lastStatus as number).toBeLessThanOrEqual(399);
      expect(handle.logs.length).toBeGreaterThan(0);

      await handle.stop();
      expect(existsSync(join(runDir, 'target.log'))).toBe(true);
      // vite binds `localhost` (possibly IPv6), so probe by URL, not 127.0.0.1.
      await expect(fetch(url, { signal: AbortSignal.timeout(3000) })).rejects.toThrow();
      expect(isPortClosed(port)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'Unreachable: nothing listening resolves to TargetUnreachableError',
    async () => {
      const port = await pickFreePort();
      const url = `http://localhost:${port}/`;
      const rec = recordingSpawn();

      const error = await openTarget({
        url,
        cwd: DEMO_APP_DIR,
        env: baseEnv(),
        ready: { timeout: '1s' },
        spawn: rec.spawn,
      }).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(TargetUnreachableError);
      const err = error as TargetUnreachableError;
      expect(err.url).toBe(url);
      expect(err.lastStatus).toBe('connection-refused');
      expect(rec.calls).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'Pre_Start_Probe: refuses to start when the URL is already served',
    async () => {
      const port = await pickFreePort();
      const server = cleanup.addServer(await startPreview(buildDir, port));
      const rec = recordingSpawn();

      const error = await openTarget({
        url: server.url,
        start: `npx --no-install vite preview --outDir ${buildDir} --port ${port} --strictPort`,
        cwd: DEMO_APP_DIR,
        env: baseEnv(),
        spawn: rec.spawn,
      }).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(TargetConfigError);
      expect((error as Error).message).toContain('already served');
      expect(rec.calls).toHaveLength(0);
      const res = await fetch(server.url, { signal: AbortSignal.timeout(5000) });
      expect(res.status).toBe(200);
    },
    TIMEOUT,
  );

  it(
    'Environment: Jev key names and values never reach the started process or the log',
    async () => {
      const port = await pickFreePort();
      const runDir = cleanup.addDir(await makeTempDir('ce-target-env-'));
      const dummyOpenRouter = 'dummy-openrouter-value-7f3a91';
      const dummyTypesafe = 'dummy-typesafe-value-5c2e48';
      const probes = recordingFetch();

      const script =
        `console.log('ENV_KEYS=' + Object.keys(process.env).join(','));` +
        `console.log('ENV_VALUES=' + Object.values(process.env).join('|'));` +
        `require('http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1');`;
      const start = `node -e "${script.replace(/"/g, '\\"')}"`;

      const handle = await open({
        url: `http://127.0.0.1:${port}/`,
        start,
        cwd: DEMO_APP_DIR,
        env: {
          ...baseEnv(),
          OPENROUTER_API_KEY: dummyOpenRouter,
          TYPESAFE_API_KEY: dummyTypesafe,
        },
        runDir,
        ready: { timeout: '30s' },
        fetch: probes.fetch,
      });

      // Wait for the pipe to deliver the printed line.
      const deadline = Date.now() + 5000;
      while (!handle.logs.includes('ENV_KEYS=') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(handle.logs).toContain('ENV_KEYS=');

      await handle.stop();
      const file = readFileSync(join(runDir, 'target.log'), 'utf8');
      for (const text of [handle.logs, file]) {
        expect(text).not.toContain('OPENROUTER_API_KEY');
        expect(text).not.toContain('TYPESAFE_API_KEY');
        expect(text).not.toContain(dummyOpenRouter);
        expect(text).not.toContain(dummyTypesafe);
      }
    },
    TIMEOUT,
  );

  it(
    'No gateway: the run environment has no Jev key and only loopback GET probes are made',
    async () => {
      const env = baseEnv();
      expect(env.OPENROUTER_API_KEY).toBeUndefined();
      expect(env.TYPESAFE_API_KEY).toBeUndefined();

      const port = await pickFreePort();
      const server = cleanup.addServer(await startPreview(buildDir, port));
      const probes = recordingFetch();
      const handle = await open({
        url: server.url,
        cwd: DEMO_APP_DIR,
        env,
        fetch: probes.fetch,
      });
      await handle.stop();

      expect(probes.calls.length).toBeGreaterThan(0);
      for (const call of probes.calls) {
        expect(call.method).toBe('GET');
        expect(new URL(call.url).hostname).toBe('localhost');
      }
    },
    TIMEOUT,
  );
});
