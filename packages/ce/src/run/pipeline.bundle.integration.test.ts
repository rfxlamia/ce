// End-to-end check of the Evidence_Bundle (evidence-bundle task 7.6): run() against
// examples/demo-app with a fake Jev gateway, then the written run.json is validated with the
// zod Run_Schema and with ajv against the committed schemas/run.schema.json.
// Skipped when Chromium is not installed. No Jev call, no API key.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolveContextOptions } from '../context/resolve.js';
import { RunRecordSchema } from '../evidence/schema.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { FakeJevGateway, type Recording } from '../jev/fake.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { launchChromiumForTest } from '../runtime/chromium.testsupport.js';
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
const CLAIM = 'the theme dropdown is fully visible inside the settings modal';
const NOW = new Date('2026-01-02T03:04:05.678Z');

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '..', 'jev', 'fixtures', 'runtime-dropdown-modal.recordings.json');
const SCHEMA_PATH = join(HERE, '..', '..', '..', '..', 'schemas', 'run.schema.json');
const VITE_BIN = resolve(HERE, '../../../../node_modules/vite/bin/vite.js');

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

async function chromiumAvailable(): Promise<boolean> {
  try {
    const browser = await launchChromiumForTest();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const hasChromium = await chromiumAvailable();
const cleanup = new DemoAppCleanup();
let cwd = '';

beforeAll(async () => {
  if (!hasChromium) return;
  cwd = cleanup.addDir(await makeTempDir('ce-bundle-it-cwd-'));
  const outDir = cleanup.addDir(await makeTempDir('ce-bundle-it-build-'));
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

describe('Evidence_Bundle written by run() on the demo-app', () => {
  it.skipIf(!hasChromium)(
    'writes a run.json that validates with zod and with ajv against schemas/run.schema.json',
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

      expect(result.outcome).toBe('EVIDENCED');
      expect(result.bundleWritten).toBe(true);

      const runJsonPath = join(cwd, '.ce', 'runs', 'run-2026-01-02T03-04-05-678Z', 'run.json');
      const record: unknown = JSON.parse(await readFile(runJsonPath, 'utf8'));

      const zodResult = RunRecordSchema.safeParse(record);
      expect(zodResult.success, JSON.stringify(zodResult.error?.issues)).toBe(true);

      const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
      const validate = ajv.compile(JSON.parse(await readFile(SCHEMA_PATH, 'utf8')) as object);
      expect(validate(record), JSON.stringify(validate.errors)).toBe(true);

      expect((record as { outcome: string }).outcome).toBe('EVIDENCED');
    },
    TIMEOUT,
  );
});
