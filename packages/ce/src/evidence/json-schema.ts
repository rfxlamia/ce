import { z } from 'zod';
import { RunRecordSchema } from './schema.js';

/** Run_Schema -> JSON Schema (draft-7). */
export function generateRunJsonSchema(): object {
  return z.toJSONSchema(RunRecordSchema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  }) as object;
}

/** Canonical on-disk form of the generated schema (used by the generator and the staleness test). */
export function serializeRunSchema(): string {
  return JSON.stringify(generateRunJsonSchema(), null, 2) + '\n';
}
