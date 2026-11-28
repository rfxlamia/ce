// report-html-evidence-page task 8.6: run() and runRunCommand() write report.html beside run.json for
// every Outcome, the Terminal_Summary names it, and a report write failure changes nothing else.
// Fake Jev gateway, real temp dir, no Chromium, no API key.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assess } from '../assessment/index.js';
import { loadConfig } from '../config/load.js';
import { resolveContext } from '../context/index.js';
import type { ResolveContextOptions } from '../context/resolve.js';
import type { BundleFs } from '../evidence/bundle.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { FakeJevGateway } from '../jev/fake.js';
import type { Recording } from '../jev/fake.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import type { Outcome, RuntimeResult } from '../outcome/index.js';
import { createCapabilityRegistry, EMPTY_REGISTRY } from './capabilities.js';
import { runRunCommand } from './command.js';
import { run } from './pipeline.js';
import type { CapabilityRegistry, CreateGateway, RunOptions } from './types.js';

vi.mock('./pipeline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipeline.js')>();
  return { ...actual, run: vi.fn(actual.run) };
});

const KEY = 'sk-or-fake-key-0123456789abcdef';
const NOW = new Date('2026-01-02T03:04:05.678Z');
const RUN_DIR_NAME = 'run-2026-01-02T03-04-05-678Z';
const TITLE = 'Add login form';

type Providers = NonNullable<ResolveContextOptions['providers']>;
type Scenario = 'SKIPPED' | 'EVIDENCED' | 'UNSUPPORTED' | 'ERROR';
const SCENARIOS: Scenario[] = ['SKIPPED', 'EVIDENCED', 'UNSUPPORTED', 'ERROR'];

const exec = () => ({ error: Object.assign(new Error('no git'), { code: '1' }) });

function providers(): Providers {
  return {
    git: () => ({
      files: [],
      commits: [],
      truncated: [],
      status: { name: 'git', status: 'unavailable', reason: 'not-a-repository' },
    }),
    github: () => ({ pullRequest: { title: TITLE }, status: { name: 'github', status: 'used' } }),
    cli: () => ({ claims: [], status: { name: 'cli', status: 'unavailable', reason: 'no-input' } }),
    junit: () => ({ checks: [], status: { name: 'junit', status: 'unavailable', reason: 'not-configured' } }),
  } as Providers;
}

function scriptedAnswerer(required: boolean): JevGateway {
  return {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(request.questions)) {
        if (name === 'surface') {
          answers[name] = {
            type: 'choice',
            probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, l === 'browser_ui' ? 1 : 0])),
          };
        } else if (name === 'runtime_observable') {
          answers[name] = { type: 'noul', noul: required ? 0.95 : 0.05 };
        } else if (name === 'checks_adequate') {
          answers[name] = { type: 'noul', noul: required ? 0.05 : 0.95 };
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
}

/** Records the scripted answers for the exact context run() builds, then replays them with FakeJevGateway. */
async function fakeGateway(cwd: string, required: boolean): Promise<FakeJevGateway> {
  const env = { OPENROUTER_API_KEY: KEY };
  const loaded = loadConfig({ cwd, flags: {}, env });
  if (!loaded.ok) throw new Error('expected a valid config');
  const context = resolveContext({ config: loaded.config, cliOptions: {}, env, cwd, providers: providers(), exec });
  const recordings: Recording[] = [];
  const answerer = scriptedAnswerer(required);
  const capturing: JevGateway = {
    async ask(request, options) {
      const response = await answerer.ask(request, options);
      const hash = stateHash(request.state);
      for (const [name, built] of Object.entries(request.questions)) {
        const answer = response.answers[name];
        if (answer === undefined) continue;
        recordings.push({ idVersion: built.idVersion, stateHash: hash, question: name, answer });
      }
      return response;
    },
  };
  await assess(context, loaded.config, capturing);
  return new FakeJevGateway(recordings);
}

function runtimeResult(): RuntimeResult {
  return {
    finalState: 'reached',
    evidence: {
      change: { title: TITLE, files: [] },
      claim: { status: 'not_identified' },
      subject: { url: 'http://localhost:3000' },
      actions: [],
      observations: [{ step: 1, screenshot: 'step-1.png' }],
      artifacts: { runDir: '/tmp/run', reportPath: '/tmp/run/report.html' },
    },
  };
}

function registryFor(scenario: Scenario): CapabilityRegistry {
  if (scenario === 'UNSUPPORTED') return EMPTY_REGISTRY;
  return createCapabilityRegistry([
    {
      name: 'browser',
      surfaces: ['browser_ui'],
      run: async () => {
        if (scenario === 'ERROR') throw new Error('capability failed');
        return runtimeResult();
      },
    },
  ]);
}

/** A BundleFs over node:fs/promises whose rename rejects for report.html.tmp when asked. */
function fsFailing(opts: { reportRename?: boolean; runJsonRename?: boolean }): BundleFs {
  return {
    mkdir: (dir, options) => fsPromises.mkdir(dir, options),
    readdir: (dir) => fsPromises.readdir(dir),
    writeFile: (file, data, encoding) => fsPromises.writeFile(file, data, encoding),
    rm: (file, options) => fsPromises.rm(file, options),
    async rename(from, to) {
      if (opts.reportRename === true && to.endsWith('report.html')) throw new TypeError('rename failed');
      if (opts.runJsonRename === true && to.endsWith('run.json')) throw new TypeError('rename failed');
      await fsPromises.rename(from, to);
    },
  };
}

let cwd: string;
let out: string[];
let err: string[];

const stdoutText = (): string => out.join('');
const stderrText = (): string => err.join('');
const runDirOf = (): string => join(cwd, '.ce', 'runs', RUN_DIR_NAME);

async function invoke(scenario: Scenario, extra: Partial<RunOptions> = {}): Promise<number> {
  const gateway = await fakeGateway(cwd, scenario !== 'SKIPPED');
  const createGateway: CreateGateway = () => ({ ok: true, gateway });
  if (extra.bundleFs !== undefined) {
    const real = (await vi.importActual<typeof import('./pipeline.js')>('./pipeline.js')).run;
    vi.mocked(run).mockImplementationOnce((options) => real({ ...options, ...extra }));
  }
  return runRunCommand([], {
    env: { OPENROUTER_API_KEY: KEY },
    cwd,
    stdout: { write: (t: string) => out.push(t) },
    stderr: { write: (t: string) => err.push(t) },
    createGateway,
    now: () => NOW,
    contextProviders: providers(),
    exec,
    capabilities: registryFor(scenario),
  });
}

const reportLine = (): string => stdoutText().split('\n').find((l) => l.startsWith('Report: ')) ?? '';

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-report-it-'));
  out = [];
  err = [];
  vi.mocked(run).mockClear();
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('report.html beside run.json for every Outcome', () => {
  it.each(SCENARIOS)('%s: writes report.html and the Report line points to it', async (scenario) => {
    await invoke(scenario);
    const record = JSON.parse(readFileSync(join(runDirOf(), 'run.json'), 'utf8')) as {
      outcome: Outcome;
      artifacts: { path: string }[];
    };
    expect(record.outcome).toBe(scenario);
    expect(existsSync(join(runDirOf(), 'report.html'))).toBe(true);
    expect(existsSync(join(runDirOf(), 'report.html.tmp'))).toBe(false);
    expect(record.artifacts.map((a) => a.path)).not.toContain('report.html');
    expect(readFileSync(join(runDirOf(), 'report.html'), 'utf8')).toContain('<html');
    expect(reportLine()).toBe(`Report: ${join(runDirOf(), 'report.html')}`);
    expect(stdoutText().startsWith(`Outcome: ${scenario}\n`)).toBe(true);
  });
});

describe('report write failure', () => {
  it.each(SCENARIOS)('%s: Outcome, exit code and run.json are unchanged and Report points to run.json', async (scenario) => {
    const okCode = await invoke(scenario);
    const okRunJson = readFileSync(join(runDirOf(), 'run.json'), 'utf8');
    const okStdout = stdoutText();
    expect(existsSync(join(runDirOf(), 'report.html'))).toBe(true);
    rmSync(join(cwd, '.ce'), { recursive: true, force: true });
    out = [];
    err = [];

    const failCode = await invoke(scenario, { bundleFs: fsFailing({ reportRename: true }) });

    expect(failCode).toBe(okCode);
    expect(readFileSync(join(runDirOf(), 'run.json'), 'utf8')).toBe(okRunJson);
    expect(existsSync(join(runDirOf(), 'report.html'))).toBe(false);
    expect(existsSync(join(runDirOf(), 'report.html.tmp'))).toBe(false);
    expect(stdoutText().split('\n')[0]).toBe(okStdout.split('\n')[0]);
    expect(reportLine()).toBe(`Report: ${join(runDirOf(), 'run.json')}`);
    const reportErrors = err.filter((l) => l.startsWith('report.html was not written'));
    expect(reportErrors).toEqual(['report.html was not written (TypeError).\n']);
  });

  it('a failed run.json write writes no report.html', async () => {
    await invoke('EVIDENCED', { bundleFs: fsFailing({ runJsonRename: true }) });
    expect(existsSync(join(runDirOf(), 'run.json'))).toBe(false);
    expect(existsSync(join(runDirOf(), 'report.html'))).toBe(false);
    expect(reportLine()).toContain('no bundle was written');
  });
});
