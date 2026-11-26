import { describe, expect, it } from 'vitest';
import type { Surface } from '../assessment/index.js';
import { StageError } from '../errors.js';
import type { EvidenceSummary } from './evidence.js';
import { resolveOutcome } from './resolve.js';
import { OUTCOMES } from './types.js';
import type { ResolveInput, RuntimeResult } from './types.js';

function summary(overrides: Partial<EvidenceSummary> = {}): EvidenceSummary {
  return {
    change: { title: 'Add banner', files: ['src/app.ts'] },
    claim: { status: 'not_identified' },
    subject: { url: 'http://localhost:3000' },
    actions: [{ kind: 'click', description: 'click Save' }],
    observations: [{ step: 0, screenshot: 'step-0.png' }],
    artifacts: { runDir: '.ce/runs/x', reportPath: '.ce/runs/x/report.html' },
    ...overrides,
  };
}

function runtime(
  finalState: RuntimeResult['finalState'] = 'reached',
  evidence: EvidenceSummary = summary(),
): RuntimeResult {
  return { finalState, evidence };
}

describe('resolveOutcome: one example per ResolveReason', () => {
  it('stage-error: an error resolves to ERROR and names the stage', () => {
    const r = resolveOutcome({
      error: new StageError('runtime', new Error('boom')),
      assessment: { required: true, surface: 'browser_ui' },
    });
    expect(r).toEqual({
      outcome: 'ERROR',
      reason: 'stage-error',
      errorStage: 'runtime',
      surface: 'browser_ui',
    });
  });

  it('stage-error: an error wins over required=false', () => {
    const r = resolveOutcome({
      error: new StageError('context', new Error('x')),
      assessment: { required: false, surface: 'cli' },
    });
    expect(r.outcome).toBe('ERROR');
    expect(r.reason).toBe('stage-error');
  });

  it('assessment-missing: no error and no assessment resolves to ERROR', () => {
    expect(resolveOutcome({})).toEqual({ outcome: 'ERROR', reason: 'assessment-missing' });
  });

  it('not-required: required=false resolves to SKIPPED', () => {
    const r = resolveOutcome({
      assessment: { required: false, surface: 'backend_internal' },
      runtime: runtime(),
    });
    expect(r).toEqual({ outcome: 'SKIPPED', reason: 'not-required', surface: 'backend_internal' });
  });

  it('surface-unsupported: required on an unsupported surface resolves to UNSUPPORTED', () => {
    const r = resolveOutcome({ assessment: { required: true, surface: 'http_api' } });
    expect(r).toEqual({ outcome: 'UNSUPPORTED', reason: 'surface-unsupported', surface: 'http_api' });
  });

  it('no-observation: missing runtime resolves to ERROR', () => {
    const r = resolveOutcome({ assessment: { required: true, surface: 'browser_ui' } });
    expect(r).toEqual({ outcome: 'ERROR', reason: 'no-observation', surface: 'browser_ui' });
  });

  it('no-observation: empty observations resolves to ERROR even if other items are incomplete', () => {
    const r = resolveOutcome({
      assessment: { required: true, surface: 'browser_ui' },
      runtime: runtime('reached', summary({ observations: [], subject: { url: '' } })),
    });
    expect(r.outcome).toBe('ERROR');
    expect(r.reason).toBe('no-observation');
  });

  it('evidence-incomplete: observations present but SPEC 7.2 check fails', () => {
    const r = resolveOutcome({
      assessment: { required: true, surface: 'browser_ui' },
      runtime: runtime('reached', summary({ subject: { url: '' } })),
    });
    expect(r).toEqual({ outcome: 'ERROR', reason: 'evidence-incomplete', surface: 'browser_ui' });
  });

  it('evidence-collected: complete evidence resolves to EVIDENCED', () => {
    const r = resolveOutcome({
      assessment: { required: true, surface: 'browser_ui' },
      runtime: runtime('reached'),
    });
    expect(r).toEqual({
      outcome: 'EVIDENCED',
      reason: 'evidence-collected',
      finalState: 'reached',
      surface: 'browser_ui',
    });
  });
});

describe('resolveOutcome: Resolution shape per Outcome', () => {
  it('EVIDENCED copies finalState not_reached and sets no errorStage', () => {
    const r = resolveOutcome({
      assessment: { required: true, surface: 'browser_ui' },
      runtime: runtime('not_reached'),
    });
    expect(r.outcome).toBe('EVIDENCED');
    expect(r.finalState).toBe('not_reached');
    expect(r).not.toHaveProperty('errorStage');
  });

  it('SKIPPED has surface and no finalState or errorStage', () => {
    const r = resolveOutcome({ assessment: { required: false, surface: 'browser_ui' } });
    expect(r.surface).toBe('browser_ui');
    expect(r).not.toHaveProperty('finalState');
    expect(r).not.toHaveProperty('errorStage');
  });

  it('UNSUPPORTED has surface and no finalState or errorStage', () => {
    const r = resolveOutcome({ assessment: { required: true, surface: 'cli' } });
    expect(r.surface).toBe('cli');
    expect(r).not.toHaveProperty('finalState');
    expect(r).not.toHaveProperty('errorStage');
  });

  it('ERROR without stage-error has no errorStage or finalState', () => {
    for (const input of [
      {},
      { assessment: { required: true, surface: 'browser_ui' } },
    ] as ResolveInput[]) {
      const r = resolveOutcome(input);
      expect(r.outcome).toBe('ERROR');
      expect(r).not.toHaveProperty('errorStage');
      expect(r).not.toHaveProperty('finalState');
    }
  });

  it('ERROR from a stage error has errorStage and no finalState', () => {
    const r = resolveOutcome({ error: new StageError('evidence', new Error('x')) });
    expect(r.errorStage).toBe('evidence');
    expect(r).not.toHaveProperty('finalState');
    expect(r).not.toHaveProperty('surface');
  });

  it('always returns one of OUTCOMES', () => {
    expect(OUTCOMES).toContain(resolveOutcome({}).outcome);
  });
});

describe('resolveOutcome: unsupported surfaces (issue #31)', () => {
  it('required=true on backend_internal is UNSUPPORTED (surface-unsupported), not SKIPPED, and no browser run', () => {
    // Combiner output for runtimeObservable 0.73 with checksAdequate below threshold:
    // required = true, dominant surface = backend_internal.
    const r = resolveOutcome({ assessment: { required: true, surface: 'backend_internal' } });
    expect(r.outcome).toBe('UNSUPPORTED');
    expect(r.outcome).not.toBe('SKIPPED');
    expect(r.reason).toBe('surface-unsupported');
    // No runtime result was needed, and none is reported.
    expect(r).not.toHaveProperty('finalState');
  });

  it.each(['http_api', 'cli', 'backend_internal', 'native_app', 'non_runtime'] as Surface[])(
    'required=true with %s resolves to UNSUPPORTED by default',
    (surface) => {
      const r = resolveOutcome({ assessment: { required: true, surface } });
      expect(r).toEqual({ outcome: 'UNSUPPORTED', reason: 'surface-unsupported', surface });
    },
  );

  it('ignores a runtime result when the surface is unsupported', () => {
    const r = resolveOutcome({
      assessment: { required: true, surface: 'backend_internal' },
      runtime: runtime(),
    });
    expect(r.outcome).toBe('UNSUPPORTED');
  });

  it.each(['http_api', 'cli', 'backend_internal', 'native_app', 'non_runtime'] as Surface[])(
    'custom supportedSurfaces containing %s makes it supported',
    (surface) => {
      const r = resolveOutcome({
        assessment: { required: true, surface },
        supportedSurfaces: [surface],
        runtime: runtime(),
      });
      expect(r.outcome).toBe('EVIDENCED');
    },
  );

  it('custom supportedSurfaces without browser_ui makes browser_ui unsupported', () => {
    const r = resolveOutcome({
      assessment: { required: true, surface: 'browser_ui' },
      supportedSurfaces: ['http_api'],
    });
    expect(r.outcome).toBe('UNSUPPORTED');
  });

  it('browser_ui is supported by default', () => {
    const r = resolveOutcome({
      assessment: { required: true, surface: 'browser_ui' },
      runtime: runtime(),
    });
    expect(r.outcome).toBe('EVIDENCED');
  });
});

describe('resolveOutcome: errors', () => {
  it('an error with required=false resolves to ERROR', () => {
    const r = resolveOutcome({
      error: new StageError('assessment', new Error('x')),
      assessment: { required: false, surface: 'browser_ui' },
    });
    expect(r.outcome).toBe('ERROR');
  });

  it('the serialized Resolution does not contain the cause message', () => {
    const secret = 'sk-secret-cause-message-12345';
    const r = resolveOutcome({
      error: new StageError('runtime', new Error(secret)),
      assessment: { required: false, surface: 'browser_ui' },
    });
    const json = JSON.stringify(r);
    expect(json).not.toContain(secret);
    expect(json).not.toContain('cause');
    expect(json).not.toContain('stack');
  });

  it('does not mutate its input', () => {
    const input: ResolveInput = {
      assessment: { required: true, surface: 'browser_ui' },
      runtime: runtime(),
    };
    const copy = structuredClone(input);
    resolveOutcome(input);
    expect(input).toEqual(copy);
  });
});
