import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeRunSchema } from '../evidence/json-schema.js';

/** Repository root, resolved from this file: packages/ce/src/scripts -> root. */
export function runSchemaOutputPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../schemas/run.schema.json');
}

export function main(): void {
  const out = runSchemaOutputPath();
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, serializeRunSchema(), 'utf8');
  console.log(`wrote ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
