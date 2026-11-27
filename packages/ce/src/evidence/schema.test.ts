// Static facts about the Run_Schema (Requirements 2.9, 3.11, 3.12, 7.7).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigSchema } from '../config/schema.js';
import { RunRecordSchema } from './schema.js';

const variants = RunRecordSchema.options;

type Shape = Record<string, z.ZodType>;

/** Collect every property name in the generated JSON Schema, skipping the nested `config` subtree. */
function collectKeys(node: unknown, keys: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, keys);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value !== null && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) {
        keys.add(name);
        if (name !== 'config') collectKeys(child, keys);
      }
    } else {
      collectKeys(value, keys);
    }
  }
}

function allKeys(): Set<string> {
  const json = z.toJSONSchema(RunRecordSchema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  });
  const keys = new Set<string>();
  collectKeys(json, keys);
  return keys;
}

function enumValues(schema: z.ZodType): string[] {
  return [...(schema as unknown as z.ZodEnum).options].map(String).sort();
}

describe('Run_Schema static facts', () => {
  it('has exactly four variants, one per Outcome', () => {
    const outcomes = variants
      .map((v) => (v.shape as Shape).outcome as unknown as z.ZodLiteral<string>)
      .map((o) => [...o.values][0])
      .sort();
    expect(outcomes).toEqual(['ERROR', 'EVIDENCED', 'SKIPPED', 'UNSUPPORTED']);
  });

  it('contains no verdict field on the correctness of the software (2.9)', () => {
    const forbidden = [
      'verdict',
      'correct',
      'correctness',
      'passed',
      'pass',
      'verified',
      'valid',
      'success',
      'ok',
    ];
    const keys = allKeys();
    for (const name of forbidden) expect(keys.has(name), name).toBe(false);
  });

  it('contains no per-call Jev field (7.7)', () => {
    const forbidden = [
      'calls',
      'stateHash',
      'latency',
      'latencyMs',
      'tokens',
      'usage',
      'tokenUsage',
      'questionId',
      'questionVersion',
    ];
    const keys = allKeys();
    for (const name of forbidden) expect(keys.has(name), name).toBe(false);
  });

  it('nests ConfigSchema for config in every variant (3.11)', () => {
    for (const variant of variants) {
      const config = (variant.shape as Shape).config;
      const inner = config instanceof z.ZodNullable ? config.unwrap() : config;
      expect(inner).toBe(ConfigSchema);
    }
    const byOutcome = (name: string) =>
      variants.find(
        (v) => [...((v.shape as Shape).outcome as unknown as z.ZodLiteral<string>).values][0] === name,
      )!;
    expect((byOutcome('ERROR').shape as Shape).config).toBeInstanceOf(z.ZodNullable);
    expect((byOutcome('EVIDENCED').shape as Shape).config).not.toBeInstanceOf(z.ZodNullable);
  });

  it('defines error.stage as the five Stage values (3.11)', () => {
    const errorVariant = variants.find(
      (v) => [...((v.shape as Shape).outcome as unknown as z.ZodLiteral<string>).values][0] === 'ERROR',
    )!;
    const error = (errorVariant.shape as Shape).error as unknown as z.ZodObject<Shape>;
    expect(enumValues(error.shape.stage!)).toEqual(
      ['assessment', 'config', 'context', 'evidence', 'runtime'],
    );
    expect(error.shape.fields).toBeInstanceOf(z.ZodArray);
  });

  it('defines runtime.stopReason as the six stop reasons (3.12)', () => {
    const errorVariant = variants.find(
      (v) => [...((v.shape as Shape).outcome as unknown as z.ZodLiteral<string>).values][0] === 'ERROR',
    )!;
    const runtime = (errorVariant.shape as Shape).runtime as unknown as z.ZodNullable<
      z.ZodObject<Shape>
    >;
    expect(enumValues(runtime.unwrap().shape.stopReason!)).toEqual(
      ['aborted', 'done', 'give_up', 'max-steps', 'reached', 'time-budget'],
    );
  });
});
