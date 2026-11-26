import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDefaults } from '../config/defaults.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import type { EvalFixtureFile } from './fixture.js';
import { runEval } from './run.js';

const cp = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
  exec: vi.fn(),
  execSync: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  fork: vi.fn(),
}));
vi.mock('node:child_process', () => ({ ...cp, default: cp }));

const REAL_FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/eval');

const BEHAVIOR = 'The page shows a banner.';

function fixture(id: string, over: Partial<EvalFixtureFile> = {}): EvalFixtureFile {
  return {
    id,
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
    ...over,
  };
}

/** A fixture without any behavior claim: only the commit message is a candidate. */
function noClaimFixture(id: string): EvalFixtureFile {
  return fixture(id, {
    change: {
      title: 'Fix typo',
      commits: [{ sha: 'abc123', message: 'Fix typo' }],
      files: [{ path: 'README.md', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }],
    },
    labels: {
      isBehavior: { 'Fix typo': false },
      runtimeObservable: {},
      checksAdequate: {},
      surface: {},
      claimStatus: 'not_identified',
      required: false,
    },
  });
}

/** Stub gateway answering by question type with fixed probabilities. */
class StubGateway implements JevGateway {
  requests: Jev_Request[] = [];
  constructor(
    private readonly p: { isBehavior: number; observable: number; adequate: number },
  ) {}
  async ask(request: Jev_Request): Promise<Jev_Response> {
    this.requests.push(request);
    const answers: Record<string, unknown> = {};
    for (const [name, q] of Object.entries(request.questions)) {
      if (q.type === 'choice') {
        answers[name] = {
          type: 'choice',
          probabilities: Object.fromEntries(
            SURFACE_LABELS.map((l) => [l, l === 'browser_ui' ? 1 : 0]),
          ),
        };
      } else {
        const noul =
          name === 'is_behavior'
            ? this.p.isBehavior
            : name === 'runtime_observable'
              ? this.p.observable
              : this.p.adequate;
        answers[name] = { type: 'noul', noul };
      }
    }
    return {
      model: 'stub-model',
      answers: answers as Jev_Response['answers'],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ce-run-'));
  for (const fn of Object.values(cp)) fn.mockReset();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(value));
}

describe('runEval', () => {
  it('returns rows, aggregate rows and the disagreement list', async () => {
    write('a.json', fixture('a'));
    const gateway = new StubGateway({ isBehavior: 0.99, observable: 0.99, adequate: 0.01 });
    const r = await runEval({ fixturesDir: dir, config: ConfigDefaults, gateway });
    expect(r.ok).toBe(true);
    if (!r.ok || !('result' in r)) return;
    const { result } = r;
    expect(result.fixtureCount).toBe(1);
    expect(result.modelIds).toEqual(['stub-model']);
    expect(result.rows.map((x) => x.question)).toEqual([
      'claim.is_behavior',
      'assess.runtime_observable',
      'assess.checks_adequate',
      'assess.surface',
      'assessment.required',
      'assessment.claimStatus',
    ]);
    const row = (q: string) => result.rows.find((x) => x.question === q)!;
    expect(row('assess.runtime_observable')).toMatchObject({ samples: 1, agreeing: 1, agreement: 1 });
    expect(row('assess.checks_adequate')).toMatchObject({ samples: 1, agreeing: 0, agreement: 0 });
    expect(row('claim.is_behavior')).toMatchObject({ samples: 2, agreeing: 1, agreement: 0.5 });
    expect(row('assessment.claimStatus').samples).toBe(1);
    expect(result.disagreements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fixtureId: 'a',
          question: 'assess.checks_adequate',
          subject: BEHAVIOR,
          predicted: false,
          label: true,
        }),
        expect.objectContaining({
          question: 'claim.is_behavior',
          subject: 'chore: wip',
          predicted: true,
          label: false,
        }),
      ]),
    );
    expect(result.requests).toBe(gateway.requests.length);

    // 13.7: returned probability and threshold are recorded beside the boolean.
    const adequate = result.disagreements.find((d) => d.question === 'assess.checks_adequate')!;
    expect(adequate.probability).toBe(0.01);
    expect(adequate.threshold).toBe(result.settings.adequateThreshold);

    // Every sample is recorded, agreeing or not.
    const total = result.rows.reduce((n, x) => n + x.samples, 0);
    expect(result.samples).toHaveLength(total);
    expect(result.samples.filter((x) => !x.agreed)).toHaveLength(result.disagreements.length);
    const surfaceSample = result.samples.find((x) => x.question === 'assess.surface')!;
    expect(surfaceSample).toMatchObject({ fixtureId: 'a', subject: BEHAVIOR, predicted: 'browser_ui', confidence: 1 });
    expect(result.samples.find((x) => x.question === 'assess.runtime_observable')).toMatchObject({
      probability: 0.99,
      threshold: result.settings.observableThreshold,
      agreed: true,
    });

    // Per-fixture assess() summary and the decidedBy breakdown.
    expect(result.assessments).toHaveLength(1);
    const a = result.assessments[0]!;
    expect(a).toMatchObject({ fixtureId: 'a', claimStatus: 'identified' });
    expect(a.perClaim.length).toBeGreaterThan(0);
    expect(a.perClaim[0]).toEqual(
      expect.objectContaining({
        needed: expect.any(Boolean),
        uncertain: expect.any(Boolean),
        runtimeObservable: expect.any(Number),
        checksAdequate: expect.any(Number),
      }),
    );
    expect(Array.isArray(a.cuts)).toBe(true);
    expect(result.requiredByDecidedBy).toEqual([
      expect.objectContaining({ bucket: a.decidedBy, samples: 1 }),
    ]);
    const req = result.rows.find((x) => x.question === 'assessment.required')!;
    expect(result.requiredByDecidedBy.reduce((n, b) => n + b.samples, 0)).toBe(req.samples);
    expect(result.requiredByDecidedBy.reduce((n, b) => n + b.agreeing, 0)).toBe(req.agreeing);
  });

  it('reports a null agreement for a row without samples', async () => {
    write('n.json', noClaimFixture('n'));
    const gateway = new StubGateway({ isBehavior: 0.01, observable: 0.01, adequate: 0.01 });
    const r = await runEval({ fixturesDir: dir, config: ConfigDefaults, gateway });
    expect(r.ok).toBe(true);
    if (!r.ok || !('result' in r)) return;
    for (const q of ['assess.runtime_observable', 'assess.checks_adequate', 'assess.surface']) {
      expect(r.result.rows.find((x) => x.question === q)).toMatchObject({
        samples: 0,
        agreeing: 0,
        agreement: null,
      });
    }
  });

  it('asks no question when a fixture is invalid', async () => {
    write('a.json', fixture('a'));
    const bad = fixture('b');
    write('b.json', { ...bad, labels: { ...bad.labels, required: 'yes' } });
    const gateway = new StubGateway({ isBehavior: 0.5, observable: 0.5, adequate: 0.5 });
    const r = await runEval({ fixturesDir: dir, config: ConfigDefaults, gateway });
    expect(r).toMatchObject({ ok: false, kind: 'schema', file: 'b.json' });
    expect(gateway.requests).toHaveLength(0);
  });

  it('never spawns a process over the real fixtures', async () => {
    const gateway = new StubGateway({ isBehavior: 0.5, observable: 0.5, adequate: 0.5 });
    const r = await runEval({ fixturesDir: REAL_FIXTURES, config: ConfigDefaults, gateway });
    expect(r.ok).toBe(true);
    for (const fn of Object.values(cp)) expect(fn).not.toHaveBeenCalled();
  });

  it('returns StageError(context) and asks nothing when a stand-in provider returns a headSha', async () => {
    write('a.json', fixture('a'));
    const gateway = new StubGateway({ isBehavior: 0.5, observable: 0.5, adequate: 0.5 });
    const r = await runEval({
      fixturesDir: dir,
      config: ConfigDefaults,
      gateway,
      providersOverride: {
        github: () => ({
          pullRequest: { body: BEHAVIOR, headSha: 'deadbeef' },
          provenance: { provider: 'github', location: 'fixture' },
          status: { name: 'github', status: 'used' },
        }),
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok || !('stageError' in r)) throw new Error('expected a stageError');
    expect(r.stageError).toBeInstanceOf(StageError);
    expect(r.stageError.stage).toBe('context');
    expect(gateway.requests).toHaveLength(0);
    for (const fn of Object.values(cp)) expect(fn).not.toHaveBeenCalled();
  });
});
