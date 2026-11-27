import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serializeRunSchema } from './json-schema.js';

/** packages/ce/src/evidence -> repository root. */
const committedPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../schemas/run.schema.json',
);

describe('committed schemas/run.schema.json', () => {
  it('is up to date with the generator (Requirement 3.5)', () => {
    const committed = readFileSync(committedPath, 'utf8');
    if (committed !== serializeRunSchema()) {
      throw new Error(
        'schemas/run.schema.json is stale — run the run-schema generator (src/scripts/generate-run-schema.ts) and commit the result',
      );
    }
    expect(committed).toBe(serializeRunSchema());
  });
});
