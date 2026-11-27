import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildRedactedConfig, REDACTED } from '../config/redact.js';
import type { EffectiveConfig } from '../config/schema.js';
import { buildRunRecordInputArb } from './arbitraries.js';
import { buildMinimalRunRecord, buildRunRecord } from './build.js';

const secretArb = fc.stringMatching(/^[A-Za-z0-9]{12,24}$/);

function maskFixtures(c: EffectiveConfig): EffectiveConfig {
  const f = c.runtime?.fixtures;
  if (f === undefined || c.runtime === undefined) return c;
  return {
    ...c,
    runtime: { ...c.runtime, fixtures: Object.fromEntries(Object.keys(f).map((k) => [k, REDACTED])) },
  };
}
describe('Run_Record config', () => {
  // **Validates: Requirements 7.1**
  it('Feature: evidence-bundle, Property 12: Config in the record is always the redacted view', () => {
    fc.assert(
      fc.property(
        buildRunRecordInputArb,
        secretArb,
        fc.constantFrom('OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'),
        (base, secret, envName) => {
          fc.pre(base.config !== null);
          const source = base.config as NonNullable<typeof base.config>;
          // A raw config that differs from its redacted view in at least one field.
          const raw = {
            ...source.config,
            target: { ...source.config.target, start: `run --token ${secret}` },
          } as EffectiveConfig;
          const redacted = buildRedactedConfig(raw, source.meta, { [envName]: secret });
          expect(redacted.config).not.toEqual(raw);

          const input = { ...base, config: redacted };
          for (const record of [buildRunRecord(input), buildMinimalRunRecord(input)]) {
            expect(record.config).toEqual(maskFixtures(redacted.config));
            expect(record.config).not.toEqual(raw);
            expect(record.config?.target?.start).toBe(`run --token ${REDACTED}`);
            expect(JSON.stringify(record.config)).not.toContain(secret);
            expect(record.config).not.toHaveProperty('meta');
            expect(record.config).not.toHaveProperty('credentials');
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Feature: evidence-bundle, Property 12: a null config stays null', () => {
    fc.assert(
      fc.property(buildRunRecordInputArb, (base) => {
        const input = { ...base, config: null };
        expect(buildRunRecord(input).config).toBeNull();
        expect(buildMinimalRunRecord(input).config).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
