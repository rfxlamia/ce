import { describe, expect, it } from 'vitest';
import type { Assessment, Claim, Surface } from '../assessment/types.js';
import { ConfigDefaults } from '../config/defaults.js';
import type { RedactedConfig } from '../config/redact.js';
import type { ChangeContext } from '../context/types.js';
import { StageError } from '../errors.js';
import { resolveOutcome } from '../outcome/resolve.js';
import type { RuntimeResult } from '../outcome/types.js';
import { buildRunRecord } from './build.js';
import type { BuildRunRecordInput } from './build.js';
import { RunRecordSchema } from './schema.js';

const provenance = { provider: 'cli' as const };

const config: RedactedConfig = {
  config: ConfigDefaults,
  meta: { fileRead: null, fileIgnored: null, ignoredEnvNames: [], sources: {} },
  credentials: { provider: 'openrouter', envVar: 'OPENROUTER_API_KEY' },
};

const context: ChangeContext = {
  change: {
    title: 'Add login',
    files: [{ path: 'src/login.ts', status: 'added', patch: '+secret patch', provenance }],
    commits: [{ sha: 'abc', message: 'wip', provenance }],
    claims: [{ text: 'Login shows a welcome message', provenance }],
    provenance: [provenance],
  },
  candidates: [{ id: 'c1', text: 'Login shows a welcome message', provenance }],
  checks: [],
  truncated: [],
  providers: [{ name: 'cli', status: 'used' }],
  redactions: [],
};

const claim: Claim = {
  id: 'c1',
  text: 'Login shows a welcome message',
  probability: 0.9,
  declared: true,
  provenance,
};

function assessmentFor(required: boolean, surface: Surface): Assessment {
  return {
    claimStatus: 'identified',
    subjects: [{ id: 'c1', kind: 'claim', text: claim.text, provenance }],
    perClaim: [
      {
        claimId: 'c1',
        runtimeObservable: 0.9,
        checksAdequate: required ? 0.1 : 0.95,
        surface,
        surfaceConfidence: 0.9,
        needed: required,
        uncertain: false,
      },
    ],
    required,
    decidedBy: 'classifier',
    surface,
    record: {
      questions: [{ idVersion: 'q@1', subjectId: 'c1', probability: 0.9 }],
      candidates: [{ candidateId: 'c1', probability: 0.9, becameClaim: true }],
      modelIds: ['typesafe/jev-1.14-2026'],
      settings: {
        claimThreshold: 0.6,
        observableThreshold: 0.6,
        adequateThreshold: 0.7,
        uncertaintyBand: 0.1,
        onUncertain: 'evidence',
      },
      cuts: [],
    },
  };
}

const timings = {
  startedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 120,
  stages: { config: 1, context: 2, assessment: 3, runtime: null },
};

const base = { config, context, claims: [claim], artifacts: [], timings, error: null, runtime: null };

function runtimeResult(): RuntimeResult {
  return {
    finalState: 'reached',
    evidence: {
      change: { title: 'Add login', files: ['src/login.ts'] },
      claim: { status: 'identified', id: 'c1', text: claim.text, provenance },
      subject: { url: 'http://localhost:3000' },
      actions: [{ kind: 'click', description: 'button "Log in"' }],
      observations: [{ step: 0, screenshot: 'step-0.png' }],
      artifacts: { runDir: '.ce/runs/r1', reportPath: 'run.json' },
    },
    trace: {
      steps: [
        {
          step: 0,
          url: 'http://localhost:3000',
          title: 'Home',
          screenshot: 'step-0.png',
          action: { kind: 'click', description: 'button "Log in"' },
          executed: true,
          probabilities: { 'e1': 0.8 },
        },
      ],
      eventLog: [],
      finalScreenshot: 'final.png',
      finalImageModel: 'typesafe/jev-1.14-2026',
      stopReason: 'reached',
      modelIds: ['typesafe/jev-1.14-2026'],
    },
  };
}

function build(input: BuildRunRecordInput) {
  const record = buildRunRecord(input);
  expect(RunRecordSchema.safeParse(record).success).toBe(true);
  return record;
}

describe('buildRunRecord worked examples', () => {
  it('SKIPPED: evidence not required, no runtime fields, no error', () => {
    const assessment = assessmentFor(false, 'browser_ui');
    const resolution = resolveOutcome({ assessment });
    const r = build({ ...base, resolution, assessment });
    expect(r.outcome).toBe(resolution.outcome);
    expect(r.outcomeReason).toBe('not-required');
    expect(r.assessment?.required).toBe(false);
    expect(r.subject).toBeNull();
    expect(r.steps).toEqual([]);
    expect(r.runtime).toBeNull();
    expect(r.finalState).toBeNull();
    expect(r.error).toBeNull();
    expect(r.context?.change.commits).toBe(1);
    expect(JSON.stringify(r)).not.toContain('secret patch');
  });

  it('UNSUPPORTED: required but surface outside the catalog, no error', () => {
    const assessment = assessmentFor(true, 'http_api');
    const resolution = resolveOutcome({ assessment });
    const r = build({ ...base, resolution, assessment });
    expect(r.outcome).toBe(resolution.outcome);
    expect(r.outcomeReason).toBe('surface-unsupported');
    expect(r.assessment?.required).toBe(true);
    expect(r.assessment?.surface).toBe('http_api');
    expect(r.subject).toBeNull();
    expect(r.steps).toEqual([]);
    expect(r.finalState).toBeNull();
    expect(r.error).toBeNull();
  });

  it('EVIDENCED: carries the trace, final state and no error', () => {
    const assessment = assessmentFor(true, 'browser_ui');
    const runtime = runtimeResult();
    const resolution = resolveOutcome({ assessment, runtime });
    const r = build({ ...base, resolution, assessment, runtime });
    expect(r.outcome).toBe(resolution.outcome);
    expect(r.outcomeReason).toBe('evidence-collected');
    expect(r.subject).toBe('http://localhost:3000');
    expect(r.steps).toHaveLength(1);
    expect(r.finalState).toBe('reached');
    expect(r.runtime).toEqual({ stopReason: 'reached' });
    expect(r.finalImage).toEqual({ model: 'typesafe/jev-1.14-2026', error: null, screenshot: 'final.png' });
    expect(r.jevModels).toEqual(['typesafe/jev-1.14-2026']);
    expect(r.error).toBeNull();
  });

  it('ERROR: stage failure names the stage and cause constructor only', () => {
    const error = new StageError('runtime', new TypeError('boom with details'));
    const resolution = resolveOutcome({ error });
    const r = build({ ...base, resolution, assessment: null, claims: [], error });
    expect(r.outcome).toBe(resolution.outcome);
    expect(r.outcomeReason).toBe('stage-error');
    expect(r.error).toEqual({ stage: 'runtime', reason: 'stage-error', causeName: 'TypeError', fields: [] });
    expect(r.finalState).toBeNull();
    expect(r.assessment).toBeNull();
    expect(r.claims).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('boom with details');
  });

  it('keeps SKIPPED and UNSUPPORTED distinct in outcome and reason', () => {
    const skippedA = assessmentFor(false, 'browser_ui');
    const unsupportedA = assessmentFor(true, 'http_api');
    const skipped = build({
      ...base,
      resolution: resolveOutcome({ assessment: skippedA }),
      assessment: skippedA,
    });
    const unsupported = build({
      ...base,
      resolution: resolveOutcome({ assessment: unsupportedA }),
      assessment: unsupportedA,
    });
    expect(skipped.outcome).not.toBe(unsupported.outcome);
    expect(skipped.outcomeReason).not.toBe(unsupported.outcomeReason);
  });
});
