import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { ChangeContext } from '../context/types.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { assess, resolveAssessmentSettings } from './assess.js';

const prob = fc.double({ min: 0, max: 1, noNaN: true });
const D = ConfigDefaults.assessment!;

// Feature: claims-assessment-eval, Property 18: resolveAssessmentSettings fallback
// **Validates: Requirements 10.7, 10.8**
describe('Feature: claims-assessment-eval, Property 18: resolveAssessmentSettings fallback', () => {
  const partialArb = fc.record({
    claim: fc.option(prob, { nil: undefined }),
    observable: fc.option(prob, { nil: undefined }),
    adequate: fc.option(prob, { nil: undefined }),
    band: fc.option(prob, { nil: undefined }),
    onUncertain: fc.option(fc.constantFrom<'evidence' | 'skip'>('evidence', 'skip'), { nil: undefined }),
  });

  it('uses each config value when present and the default for that value alone when absent', () => {
    fc.assert(
      fc.property(partialArb, (p) => {
        const config: EffectiveConfig = {
          version: 0,
          assessment: {
            thresholds: {
              ...(p.claim !== undefined && { claim: p.claim }),
              ...(p.observable !== undefined && { observable: p.observable }),
              ...(p.adequate !== undefined && { adequate: p.adequate }),
            },
            ...(p.band !== undefined && { 'uncertainty-band': p.band }),
            ...(p.onUncertain !== undefined && { 'on-uncertain': p.onUncertain }),
          },
        };
        const s = resolveAssessmentSettings(config);
        expect(s.claimThreshold).toBe(p.claim ?? D.thresholds!.claim);
        expect(s.observableThreshold).toBe(p.observable ?? D.thresholds!.observable);
        expect(s.adequateThreshold).toBe(p.adequate ?? D.thresholds!.adequate);
        expect(s.uncertaintyBand).toBe(p.band ?? D['uncertainty-band']);
        expect(s.onUncertain).toBe(p.onUncertain ?? D['on-uncertain']);
      }),
      { numRuns: 100 },
    );
  });

  it('raises StageError("assessment") when a value is absent from both config and defaults', () => {
    const names = ['claim', 'observable', 'adequate', 'band', 'onUncertain'] as const;
    fc.assert(
      fc.property(fc.constantFrom(...names), partialArb, (missing, p) => {
        const full = { claim: 0.5, observable: 0.5, adequate: 0.5, band: 0.1, onUncertain: 'skip' as const };
        const build = (v: Record<string, unknown>): EffectiveConfig => ({
          version: 0,
          assessment: {
            thresholds: {
              ...(v['claim'] !== undefined && { claim: v['claim'] as number }),
              ...(v['observable'] !== undefined && { observable: v['observable'] as number }),
              ...(v['adequate'] !== undefined && { adequate: v['adequate'] as number }),
            },
            ...(v['band'] !== undefined && { 'uncertainty-band': v['band'] as number }),
            ...(v['onUncertain'] !== undefined && {
              'on-uncertain': v['onUncertain'] as 'evidence' | 'skip',
            }),
          },
        });
        const defaults = build({ ...full, [missing]: undefined });
        const config = build({ ...p, [missing]: undefined });
        let thrown: unknown;
        try {
          resolveAssessmentSettings(config, defaults);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(StageError);
        expect((thrown as StageError).stage).toBe('assessment');
        expect((thrown as StageError).cause).toBeInstanceOf(Error);
      }),
      { numRuns: 100 },
    );
  });
});

/** Answers every question with fixed probabilities. */
class ConstantGateway implements JevGateway {
  async ask(request: Jev_Request, _options?: AskOptions): Promise<Jev_Response> {
    const answers: Jev_Response['answers'] = {};
    for (const [name, built] of Object.entries(request.questions)) {
      answers[name] =
        built.type === 'noul'
          ? ({ type: 'noul', noul: 0.65 } as never)
          : ({
              type: 'choice',
              probabilities: Object.fromEntries(SURFACE_LABELS.map((l, i) => [l, i === 0 ? 0.5 : 0.1])),
              choice: SURFACE_LABELS[0],
              confidence: 1,
            } as never);
    }
    return { model: 'typesafe/jev-1.14-20260101', answers, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

const context: ChangeContext = {
  change: { title: 'Adds a dashboard heading', files: [], commits: [], claims: [], provenance: [] },
  candidates: [],
  checks: [],
  truncated: [],
  providers: [],
  redactions: [],
};

describe('settings fallback in assess and resolveAssessmentSettings', () => {
  it('assess with config {} equals assess with the values filled from ConfigDefaults', async () => {
    const empty = await assess(context, { version: 0 } as EffectiveConfig, new ConstantGateway());
    const filled = await assess(context, ConfigDefaults, new ConstantGateway());
    expect(empty).toEqual(filled);
  });

  it('assess with a partial assessment key equals the result with the rest filled from ConfigDefaults', async () => {
    const partial: EffectiveConfig = { version: 0, assessment: { thresholds: { claim: 0.3 } } };
    const filled: EffectiveConfig = {
      version: 0,
      assessment: { ...D, thresholds: { ...D.thresholds, claim: 0.3 } },
    };
    const a = await assess(context, partial, new ConstantGateway());
    const b = await assess(context, filled, new ConstantGateway());
    expect(a).toEqual(b);
  });

  it('raises StageError("assessment", cause) when defaults and config both miss a value', async () => {
    const incomplete: EffectiveConfig = { version: 0, assessment: { thresholds: { claim: 0.6 } } };
    expect(() => resolveAssessmentSettings({ version: 0 }, incomplete)).toThrow(StageError);
    try {
      resolveAssessmentSettings({ version: 0 }, incomplete);
      expect.unreachable();
    } catch (e) {
      expect((e as StageError).stage).toBe('assessment');
      expect((e as StageError).cause).toBeInstanceOf(Error);
    }
    await expect(
      assess(context, { version: 0 }, new ConstantGateway(), { defaults: incomplete }),
    ).rejects.toMatchObject({ name: 'StageError', stage: 'assessment' });
  });

  it('does not mutate ConfigDefaults', () => {
    const before = structuredClone(ConfigDefaults);
    resolveAssessmentSettings({ version: 0 });
    resolveAssessmentSettings({ version: 0, assessment: { thresholds: { claim: 0.1 } } });
    expect(ConfigDefaults).toEqual(before);
  });
});
