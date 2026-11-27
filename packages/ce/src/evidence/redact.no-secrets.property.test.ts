// Feature: evidence-bundle, Property 11: No secret value and no raw Jev payload ever reaches an output file or the terminal
// **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.9, 8.16, 10.3**
// Covers the built and redacted record (build -> redactRunRecord -> serialized).
// The Terminal_Summary part of this property is checked in task 4.8.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StageError } from '../errors.js';
import { OUTCOMES } from '../outcome/types.js';
import type { RedactedConfig } from '../config/redact.js';
import type { ChangeContext } from '../context/types.js';
import { buildMinimalRunRecord, buildRunRecord } from './build.js';
import type { BuildRunRecordInput, PartialTrace } from './build.js';
import { buildRunRecordInputArb, changeContextArb } from './arbitraries.js';
import { redactRunRecord } from './redact.js';

const EVIDENCED_OUTCOME = OUTCOMES[1];
const ERROR_OUTCOME = OUTCOMES[3];

const hex = fc.stringMatching(/^[0-9a-f]{12}$/);
/** 1-4 distinct secret-like strings. */
const secretsArb = fc
  .uniqueArray(hex, { minLength: 1, maxLength: 4 })
  .map((ids) => ids.map((id) => `SECRETVALUE${id}`));
const fixtureValueArb = hex.map((id) => `FIXTUREVALUE${id}`);
const payloadArb = hex.map((id) => `JEVPAYLOAD${id}`);
const causeArb = fc.constantFrom<unknown>(new Error('x'), new TypeError('x'));

/** Wrap `secrets[i % n]` in free text, so each field holds one secret. */
const withSecret = (secrets: readonly string[], i: number, pre: string, post: string): string =>
  `${pre}${secrets[i % secrets.length]}${post}`;

const FORBIDDEN_KEYS = [
  'elements',
  'domDigest',
  'navigation',
  'calls',
  'stateHash',
  'latency',
  'tokens',
  'apiKey',
  'authorization',
];

function collectKeys(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
}

function injectConfig(
  config: RedactedConfig | null,
  secrets: readonly string[],
  fixtureKey: string,
  fixtureValue: string,
  pre: string,
): RedactedConfig {
  const base = config ?? ({
    config: { version: 0 },
    meta: { fileRead: null, fileIgnored: null, ignoredEnvNames: [], sources: {} },
    credentials: { provider: 'openrouter', envVar: 'OPENROUTER_API_KEY' },
  } as unknown as RedactedConfig);
  return {
    ...base,
    config: {
      ...base.config,
      target: { ...base.config.target, start: withSecret(secrets, 0, pre, '') },
      runtime: {
        ...base.config.runtime,
        fixtures: { [fixtureKey]: fixtureValue },
      },
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

function assertClean(
  record: ReturnType<typeof buildRunRecord>,
  secrets: readonly string[],
  forbiddenValues: readonly string[],
): void {
  const redacted = redactRunRecord(record, secrets);
  const text = JSON.stringify(redacted, null, 2) + '\n';
  for (const s of secrets) expect(text).not.toContain(s);
  for (const v of forbiddenValues) expect(text).not.toContain(v);
  const keys = new Set<string>();
  collectKeys(redacted, keys);
  for (const k of FORBIDDEN_KEYS) expect(keys.has(k)).toBe(false);
}

describe('Property 11: no secret value and no raw Jev payload reaches the serialized record', () => {
  it('EVIDENCED run with a trace', () => {
    fc.assert(
      fc.property(
        buildRunRecordInputArb.filter((i) => i.runtime !== null),
        changeContextArb,
        secretsArb,
        fixtureValueArb,
        fc.stringMatching(/^[a-z ]{0,6}$/),
        causeArb,
        (base, context, secrets, fixtureValue, pre, cause) => {
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
          };
          const input: BuildRunRecordInput = {
            ...base,
            resolution: { outcome: EVIDENCED_OUTCOME, reason: 'evidence-collected', finalState: 'reached' },
            config: injectConfig(base.config, secrets, 'password', fixtureValue, pre),
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
                ...(trace.finalImageError === undefined
                  ? {}
                  : { finalImageError: withSecret(secrets, 6, pre, '') }),
              },
            },
            error: new StageError('runtime', cause),
          };
          assertClean(buildRunRecord(input), secrets, [fixtureValue]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ERROR run with a partial trace carrying observation-layer data', () => {
    fc.assert(
      fc.property(
        buildRunRecordInputArb.filter((i) => i.partialTrace !== undefined),
        changeContextArb,
        secretsArb,
        fixtureValueArb,
        payloadArb,
        fc.stringMatching(/^[a-z ]{0,6}$/),
        fc.constantFrom('stage-error', 'no-observation', 'evidence-incomplete'),
        (base, context, secrets, fixtureValue, payload, pre, reason) => {
          const partial: PartialTrace = {
            observations: base.partialTrace!.observations.map((o) => ({
              ...o,
              domDigest: `${payload}-dom`,
              navigation: [`${payload}-nav`],
              elements: o.elements.map((e) => ({
                ...e,
                name: withSecret(secrets, 7, pre, ''),
              })),
            })),
            steps: base.partialTrace!.steps.map((s) => ({
              ...s,
              observation: {
                ...s.observation,
                domDigest: `${payload}-dom`,
                navigation: [`${payload}-nav`],
                elements: s.observation.elements.map((e) => ({
                  ...e,
                  name: withSecret(secrets, 8, pre, ''),
                })),
              },
            })),
            eventLog: [
              { step: 0, kind: 'dialog', detail: withSecret(secrets, 9, pre, ' popup') },
              ...base.partialTrace!.eventLog,
            ],
          };
          const input: BuildRunRecordInput = {
            ...base,
            resolution:
              reason === 'stage-error'
                ? { outcome: ERROR_OUTCOME, reason: 'stage-error', errorStage: 'runtime' }
                : { outcome: ERROR_OUTCOME, reason: reason as 'no-observation' },
            config: injectConfig(base.config, secrets, 'token', fixtureValue, pre),
            context: injectContext(context, secrets, pre),
            runtime: null,
            partialTrace: partial,
            error: new StageError('runtime', new Error(secrets[0])),
          };
          assertClean(buildMinimalRunRecord(input), secrets, [fixtureValue, payload]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
