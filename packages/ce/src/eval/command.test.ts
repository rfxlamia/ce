import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { CallLog } from '../jev/log.js';
import type { Jev_Request } from '../jev/types.js';
import { runEvalCommand } from './command.js';
import type { CreateEvalGateway, EvalCommandDeps } from './command.js';
import type { EvalFixtureFile } from './fixture.js';

const FAKE_KEY = 'sk-or-fake-key-0123456789abcdef';
const BEHAVIOR = 'The page shows a banner.';

const fixture: EvalFixtureFile = {
  id: 'a',
  description: 'test fixture',
  change: {
    description: BEHAVIOR,
    commits: [{ sha: 'abc123', message: 'chore: wip' }],
    files: [{ path: 'src/a.txt', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }],
  },
  checks: [{ name: 'unit', status: 'passed' }],
  labels: {
    isBehavior: { [BEHAVIOR]: true, 'chore: wip': false },
    runtimeObservable: { [BEHAVIOR]: true },
    checksAdequate: { [BEHAVIOR]: true },
    surface: { [BEHAVIOR]: 'browser_ui' },
    claimStatus: 'identified',
    required: true,
  },
};

/** Gateway that answers by question type and writes one entry to the injected call log per ask. */
function stubGateway(callLog: CallLog): JevGateway {
  return {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      const answers: Record<string, unknown> = {};
      for (const [name, q] of Object.entries(request.questions)) {
        answers[name] =
          q.type === 'choice'
            ? {
                type: 'choice',
                probabilities: Object.fromEntries(
                  SURFACE_LABELS.map((l) => [l, l === 'browser_ui' ? 1 : 0]),
                ),
              }
            : { type: 'noul', noul: name === 'checks_adequate' ? 0.01 : 0.99 };
      }
      await callLog.append({
        timestamp: '2026-01-01T00:00:00.000Z',
        stage: 'assessment',
        transport: 'fake',
        provider: 'openrouter',
        requestedModel: 'stub-model',
        model: 'stub-model',
        questions: [],
        answers: {},
        latencyMs: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        stateHash: 'a'.repeat(64),
        status: 'ok',
        attempts: 0,
      });
      return {
        model: 'stub-model',
        answers: answers as Jev_Response['answers'],
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
  };
}

let cwd: string;
let out: string[];
let err: string[];
let createGateway: ReturnType<typeof vi.fn<CreateEvalGateway>>;

function deps(env: Record<string, string | undefined> = { OPENROUTER_API_KEY: FAKE_KEY }): EvalCommandDeps {
  return {
    env,
    cwd,
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    createGateway,
    now: () => new Date('2026-01-02T03:04:05.678Z'),
  };
}

function runDirs(): string[] {
  try {
    return readdirSync(join(cwd, '.ce', 'runs'));
  } catch {
    return [];
  }
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ce-eval-cmd-'));
  out = [];
  err = [];
  createGateway = vi.fn<CreateEvalGateway>((_loaded, _env, { callLog }) => ({
    ok: true,
    gateway: stubGateway(callLog),
  }));
  writeFileSync(join(cwd, 'a.json'), JSON.stringify(fixture));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function expectNoKey(): void {
  expect([...out, ...err].join('')).not.toContain(FAKE_KEY);
}

describe('runEvalCommand', () => {
  it('prints rows, writes eval.json and jev-calls.jsonl, and exits 0', async () => {
    const code = await runEvalCommand(['--fixtures', '.'], deps());
    expect(code).toBe(0);
    expect(err).toEqual([]);
    const stdout = out.join('');
    for (const q of [
      'claim.is_behavior',
      'assess.runtime_observable',
      'assess.checks_adequate',
      'assess.surface',
      'assessment.required',
      'assessment.claimStatus',
    ]) {
      expect(stdout).toContain(q);
    }
    expect(stdout).toContain('Disagreements');

    const dirs = runDirs();
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe('eval-2026-01-02T03-04-05-678Z');
    const dir = join(cwd, '.ce', 'runs', dirs[0]!);
    expect(stdout).toContain(`Eval saved to ${dir}`);

    const result = JSON.parse(readFileSync(join(dir, 'eval.json'), 'utf8'));
    expect(result.fixtureCount).toBe(1);
    expect(result.rows).toHaveLength(6);
    expect(result.modelIds).toEqual(['stub-model']);
    expect(Array.isArray(result.samples)).toBe(true);
    expect(result.assessments).toHaveLength(1);
    expect(result.requiredByDecidedBy[0].samples).toBe(1);
    expect(stdout).toContain('assessment.required[decidedBy=');

    const lines = readFileSync(join(dir, 'jev-calls.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(createGateway).toHaveBeenCalledTimes(1);
    expectNoKey();
  });

  it('accepts --flag=value form and a valid config file', async () => {
    writeFileSync(join(cwd, 'my.yml'), 'jev:\n  provider: openrouter\n');
    const code = await runEvalCommand(['--fixtures=.', '--config=my.yml'], deps());
    expect(code).toBe(0);
    expectNoKey();
  });

  it('exits 1 for a missing credential without creating a gateway', async () => {
    const code = await runEvalCommand(['--fixtures', '.'], deps({ OPENROUTER_API_KEY: '' }));
    expect(code).toBe(1);
    expect(createGateway).not.toHaveBeenCalled();
    expect(err.join('')).toContain('OPENROUTER_API_KEY');
    expect(runDirs()).toEqual([]);
    expectNoKey();
  });

  it('exits 1 for an invalid config file without creating a gateway', async () => {
    writeFileSync(join(cwd, 'ce.yml'), 'jev:\n  provider: not-a-provider\n');
    const code = await runEvalCommand(['--fixtures', '.'], deps());
    expect(code).toBe(1);
    expect(createGateway).not.toHaveBeenCalled();
    expect(err.join('')).toContain('jev.provider');
    expectNoKey();
  });

  it('exits 1 when createGateway reports errors', async () => {
    createGateway.mockReturnValueOnce({
      ok: false,
      errors: [{ path: 'jev.model', value: 'x', expected: 'a valid model', source: 'default' }],
    });
    const code = await runEvalCommand(['--fixtures', '.'], deps());
    expect(code).toBe(1);
    expect(err.join('')).toContain('jev.model');
    expectNoKey();
  });

  describe.each([
    ['unknown option', ['--bogus', 'x']],
    ['duplicate option', ['--fixtures', '.', '--fixtures', '.']],
    ['duplicate option in = form', ['--config=a.yml', '--config', 'b.yml']],
    ['valueless option at end', ['--fixtures']],
    ['valueless option before another option', ['--fixtures', '--config', 'x.yml']],
    ['empty value', ['--fixtures=']],
    ['positional argument', ['extra']],
  ])('malformed flags: %s', (_name, argv) => {
    it('exits 1 with usage and touches no dependency', async () => {
      const code = await runEvalCommand(argv, deps());
      expect(code).toBe(1);
      expect(err.join('')).toContain('Usage: ce eval');
      expect(out).toEqual([]);
      expect(createGateway).not.toHaveBeenCalled();
      expect(runDirs()).toEqual([]);
      expectNoKey();
    });
  });
});
