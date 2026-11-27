// Surface suppression on the assessment record (claims-assessment-eval, issue #31).
// The Combiner sets needed to false for backend_internal and non_runtime and lists
// those subjects on surfaceSuppressed. assess() copies the list onto the record
// only when it is present.

import { describe, expect, it } from 'vitest';
import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { ChangeContext } from '../context/types.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { assess } from './assess.js';
import type { Surface } from './types.js';

const config = ConfigDefaults as EffectiveConfig;

function makeContext(title: string): ChangeContext {
  return {
    change: { title, files: [], commits: [], claims: [], provenance: [] },
    candidates: [],
    checks: [],
    truncated: [],
    providers: [],
    redactions: [],
  };
}

function gateway(surface: Surface, observable: number, adequate: number): JevGateway {
  return {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      const answers: Jev_Response['answers'] = {};
      for (const name of Object.keys(request.questions)) {
        answers[name] =
          name === 'surface'
            ? ({
                type: 'choice',
                probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, l === surface ? 1 : 0])),
              } as never)
            : ({
                type: 'noul',
                noul: name === 'runtime_observable' ? observable : name === 'checks_adequate' ? adequate : 0.1,
              } as never);
      }
      return { model: 'typesafe/jev-test', answers, usage: { input_tokens: null, output_tokens: null } };
    },
  };
}

describe('assess() surfaceSuppressed (issue #31)', () => {
  it('copies surfaceSuppressed onto the record when needed was suppressed', async () => {
    const { assessment } = await assess(
      makeContext('Memoize the parsed configuration'),
      config,
      gateway('backend_internal', 0.73, 0.3),
    );
    expect(assessment.perClaim[0]).toMatchObject({
      claimId: 'change',
      needed: false,
      uncertain: false,
      surface: 'backend_internal',
    });
    expect(assessment.required).toBe(false);
    expect(assessment.decidedBy).toBe('classifier');
    expect(assessment.record.surfaceSuppressed).toEqual([
      { subjectId: 'change', surface: 'backend_internal' },
    ]);
    expect(assessment.record.policyDecision).toBeUndefined();
  });

  it('omits surfaceSuppressed when the surface is observable', async () => {
    const { assessment } = await assess(
      makeContext('The page shows a banner'),
      config,
      gateway('browser_ui', 0.9, 0.1),
    );
    expect(assessment.perClaim[0]).toMatchObject({ needed: true, surface: 'browser_ui' });
    expect(assessment.required).toBe(true);
    expect(assessment.record).not.toHaveProperty('surfaceSuppressed');
  });

  it('omits surfaceSuppressed when the probability test does not hold', async () => {
    const { assessment } = await assess(
      makeContext('Memoize the parsed configuration'),
      config,
      gateway('non_runtime', 0.2, 0.9),
    );
    expect(assessment.perClaim[0]).toMatchObject({ needed: false, surface: 'non_runtime' });
    expect(assessment.record).not.toHaveProperty('surfaceSuppressed');
  });
});
