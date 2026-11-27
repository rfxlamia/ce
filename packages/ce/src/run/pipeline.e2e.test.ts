// End-to-end proof of issue #10 through run() (task 11.2): the default capability registry,
// real Chromium, a real build of examples/demo-app started by the Target_Manager from ce.yml,
// a temporary cwd, and a supplied fake gateway. Assessment questions get scripted answers; the
// runtime text questions replay the recordings of task 11.1; the Final_Image_Request is answered
// by question id. No Jev call, no API key.

import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { FakeJevGateway, type Recording } from '../jev/fake.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import {
  DEMO_APP_DIR,
  DemoAppCleanup,
  buildDemoApp,
  makeTempDir,
  pickFreePort,
} from '../runtime/demo-app.testsupport.js';
import { GatewayTestSupport } from '../runtime/gateway.testsupport.js';
import { run } from './pipeline.js';

const TIMEOUT = 180_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CLAIM = 'the theme dropdown is fully visible inside the settings modal';
const NOW = new Date('2026-01-02T03:04:05.678Z');

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '..', 'jev', 'fixtures', 'runtime-dropdown-modal.recordings.json');
const VITE_BIN = resolve(HERE, '../../../../node_modules/vite/bin/vite.js');

/** Same changed files as the loop scenarios of task 11.1, so the recordings match. */
const CHANGE_FILES = [
  {
    path: 'examples/demo-app/src/main.ts',
    patch: '+function wireDropdown(triggerId, listId, onChoose) {}\n+wireDropdown("theme-trigger", "theme-list")',
  },
  { path: 'examples/demo-app/index.html', patch: '+<div role="dialog" aria-label="Settings">' },
];

type Providers = NonNullable<ResolveContextOptions['providers']>;

const providers = {
  git: () => ({
    files: CHANGE_FILES.map((f) => ({
      path: f.path,
      status: 'modified' as const,
      patch: f.patch,
      provenance: { provider: 'git' as const },
    })),
    commits: [],
    truncated: [],
    status: { name: 'git', status: 'used' },
  }),
  github: () => ({ status: { name: 'github', status: 'unavailable', reason: 'source-absent' } }),
  cli: () => ({
    claims: [{ text: CLAIM, provenance: { provider: 'cli', location: '--claim[1]' } }],
    status: { name: 'cli', status: 'used' },
  }),
  junit: () => ({
    checks: [],
    status: { name: 'junit', status: 'unavailable', reason: 'not-configured' },
  }),
} as unknown as Providers;

/** Scripted Jev for the assessment stage: browser_ui, runtime observable, checks inadequate. */
const assessor: JevGateway = {
  async ask(request: Jev_Request): Promise<Jev_Response> {
    const answers: Record<string, unknown> = {};
    for (const name of Object.keys(request.questions)) {
      if (name === 'surface') {
        answers[name] = {
          type: 'choice',
          probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, l === 'browser_ui' ? 1 : 0])),
        };
      } else if (name === 'runtime_observable') {
        answers[name] = { type: 'noul', noul: 0.95 };
      } else if (name === 'checks_adequate') {
        answers[name] = { type: 'noul', noul: 0.05 };
      } else {
        answers[name] = { type: 'noul', noul: 0.01 };
      }
    }
    return {
      model: 'stub-model',
      answers: answers as Jev_Response['answers'],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  },
};

const cleanup = new DemoAppCleanup();
let cwd = '';

beforeAll(async () => {
  cwd = cleanup.addDir(await makeTempDir('ce-run-e2e-cwd-'));
  const outDir = cleanup.addDir(await makeTempDir('ce-run-e2e-build-'));
  await buildDemoApp(outDir);
  const port = await pickFreePort();
  const q = (s: string): string => JSON.stringify(s);
  const start = `node ${q(VITE_BIN)} preview ${q(DEMO_APP_DIR)} --outDir ${q(outDir)} --port ${port} --strictPort`;
  await writeFile(
    join(cwd, 'ce.yml'),
    ['target:', `  url: http://localhost:${port}/`, `  start: ${q(start)}`, '  ready:', '    timeout: 60s', ''].join('\n'),
  );
}, TIMEOUT);

afterAll(async () => {
  await cleanup.run();
}, TIMEOUT);

describe('run() with the default capability registry on the demo-app', () => {
  it(
    'resolves a required browser_ui Assessment to EVIDENCED with screenshots, one run.json and no report.html',
    async () => {
      const text = new FakeJevGateway(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')) as Recording[]);
      const gateway = new GatewayTestSupport({
        inner: {
          ask: (request, options) =>
            'next_action' in request.questions ? text.ask(request, options) : assessor.ask(request),
        },
        finalImage: { stateReached: 0.93 },
      });
      const env: Record<string, string | undefined> = { ...process.env };
      delete env['OPENROUTER_API_KEY'];
      delete env['TYPESAFE_API_KEY'];
      const stderr: string[] = [];

      const result = await run({
        cwd,
        env,
        gateway,
        cliOptions: { claim: [CLAIM] },
        contextProviders: providers,
        now: () => NOW,
        stderr: { write: (t: string) => stderr.push(t) },
      });

      expect(stderr.join('')).toBe('');
      expect(result.error).toBeUndefined();
      expect(result.outcome).toBe('EVIDENCED');
      expect(result.capability).toBe('browser_ui');
      expect(result.exitCode).toBe(0);

      // The run directory holds the screenshots and nothing CE-report shaped.
      const runDir = join(cwd, '.ce', 'runs', 'run-2026-01-02T03-04-05-678Z');
      expect(existsSync(runDir)).toBe(true);
      const files = await readdir(runDir, { recursive: true });
      const pngs = files.filter((f) => f.endsWith('.png'));
      expect(pngs.length).toBeGreaterThanOrEqual(3);
      for (const png of pngs) {
        const bytes = await readFile(join(runDir, png));
        expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
      }
      expect(files.filter((f) => /(^|\/)run\.json$/.test(f))).toEqual(['run.json']);
      expect(files.some((f) => /(^|\/)report\.html$/.test(f))).toBe(false);
      expect(existsSync(join(cwd, '.ce', 'runs', 'run-2026-01-02T03-04-05-678Z', 'jev-calls.jsonl'))).toBe(false);

      // One combined image request; runtime step requests carried no image.
      expect(gateway.finalImageRequests.length).toBe(1);
      expect(gateway.imageRequests.length).toBe(1);
      for (const request of gateway.textRequests) expect(request.hasImage).toBe(false);
    },
    TIMEOUT,
  );
});
