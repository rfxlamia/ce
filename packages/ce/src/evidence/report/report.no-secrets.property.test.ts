// Feature: report-html-evidence-page, secrets never reach report.html
// **Validates: Requirements 15.4, 16.3**
// Approach of evidence/redact.no-secrets.property.test.ts: build -> redactRunRecord -> render.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RedactedConfig } from '../../config/redact.js';
import type { ChangeContext } from '../../context/types.js';
import { StageError } from '../../errors.js';
import { OUTCOMES } from '../../outcome/types.js';
import { buildRunRecordInputArb, changeContextArb } from '../arbitraries.js';
import { buildRunRecord } from '../build.js';
import type { BuildRunRecordInput } from '../build.js';
import { redactRunRecord } from '../redact.js';
import { render } from './render.js';

const EVIDENCED_OUTCOME = OUTCOMES[1];

const hex = fc.stringMatching(/^[0-9a-f]{12}$/);
const secretsArb = fc
  .uniqueArray(hex, { minLength: 1, maxLength: 4 })
  .map((ids) => ids.map((id) => `SECRETVALUE${id}`));
const fixtureValueArb = hex.map((id) => `FIXTUREVALUE${id}`);

const withSecret = (secrets: readonly string[], i: number, pre: string, post: string): string =>
  `${pre}${secrets[i % secrets.length]}${post}`;

function injectConfig(
  config: RedactedConfig | null,
  secrets: readonly string[],
  fixtureValue: string,
  pre: string,
): RedactedConfig {
  const base =
    config ??
    ({
      config: { version: 0 },
      meta: { fileRead: null, fileIgnored: null, ignoredEnvNames: [], sources: {} },
      credentials: { provider: 'openrouter', envVar: 'OPENROUTER_API_KEY' },
    } as unknown as RedactedConfig);
  return {
    ...base,
    config: {
      ...base.config,
      target: { ...base.config.target, start: withSecret(secrets, 0, pre, '') },
      runtime: { ...base.config.runtime, fixtures: { password: fixtureValue } },
    },
  };
}

function injectContext(context: ChangeContext, secrets: readonly string[], pre: string): ChangeContext {
  return {
    ...context,
    change: {
      ...context.change,
      title: withSecret(secrets, 1, pre, ' title'),
      description: withSecret(secrets, 2, 'desc ', pre),
    },
  };
}

describe('report.html never contains a secret value', () => {
  it('EVIDENCED run with secrets planted in config, context, steps and events', () => {
    fc.assert(
      fc.property(
        buildRunRecordInputArb.filter((i) => i.runtime !== null),
        changeContextArb,
        secretsArb,
        fixtureValueArb,
        fc.stringMatching(/^[a-z ]{0,6}$/),
        (base, context, secrets, fixtureValue, pre) => {
          const runtime = base.runtime!;
          const trace = runtime.trace ?? {
            steps: [],
            eventLog: [],
            stopReason: 'done' as const,
            modelIds: [],
          };
          const step = {
            step: 0,
            url: 'http://localhost/',
            title: withSecret(secrets, 3, pre, ''),
            screenshot: 'step-0.png',
            action: { kind: 'click', description: withSecret(secrets, 4, pre, ' button') },
            executed: true,
            probabilities: {},
            alternatives: [],
          };
          const input: BuildRunRecordInput = {
            ...base,
            resolution: { outcome: EVIDENCED_OUTCOME, reason: 'evidence-collected', finalState: 'reached' },
            config: injectConfig(base.config, secrets, fixtureValue, pre),
            context: injectContext(context, secrets, pre),
            runtime: {
              ...runtime,
              trace: {
                ...trace,
                steps: [step, ...trace.steps],
                eventLog: [
                  { step: 0, kind: 'dialog', detail: withSecret(secrets, 5, pre, ' dialog') },
                  ...trace.eventLog,
                ],
              },
            },
            error: new StageError('runtime', new Error('x')),
          };
          const redacted = redactRunRecord(buildRunRecord(input), secrets);
          const html = render(redacted);
          for (const s of secrets) expect(html).not.toContain(s);
          expect(html).not.toContain(fixtureValue);
        },
      ),
      { numRuns: 100 },
    );
  });
});
