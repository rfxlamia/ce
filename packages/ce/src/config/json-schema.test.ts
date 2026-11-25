import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateJsonSchema, serializeSchema } from './json-schema.js';

type Node = Record<string, unknown>;

/** Every key of Requirement 1 criterion 1. */
const REQUIRED_KEYS = [
  'version',
  'target.url',
  'target.start',
  'target.ready.path',
  'target.ready.timeout',
  'target.routes',
  'context.base',
  'context.include',
  'context.exclude',
  'context.redact',
  'context.checks',
  'assessment.thresholds.claim',
  'assessment.thresholds.observable',
  'assessment.thresholds.adequate',
  'assessment.uncertainty-band',
  'assessment.on-uncertain',
  'runtime.max-steps',
  'runtime.timeout',
  'runtime.viewport.width',
  'runtime.viewport.height',
  'runtime.fixtures',
  'jev.provider',
  'jev.model',
  'output.dir',
  'output.fail-on',
];

function lookup(schema: Node, dotted: string): Node | undefined {
  let node: Node | undefined = schema;
  for (const part of dotted.split('.')) {
    const props = node?.properties as Record<string, Node> | undefined;
    node = props?.[part];
    if (node === undefined) return undefined;
  }
  return node;
}

/** Collect every object node that declares `properties` (a closed object in ConfigSchema). */
function closedObjects(node: Node, at = '(root)', out: Array<[string, Node]> = []): Array<[string, Node]> {
  const props = node.properties as Record<string, Node> | undefined;
  if (props) {
    out.push([at, node]);
    for (const [key, child] of Object.entries(props)) {
      closedObjects(child, at === '(root)' ? key : `${at}.${key}`, out);
    }
  }
  return out;
}

const committedPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../schemas/ce.schema.json',
);

describe('generated JSON Schema', () => {
  const schema = generateJsonSchema() as Node;

  it.each(REQUIRED_KEYS)('declares %s (Requirement 3.2)', (key) => {
    expect(lookup(schema, key), key).toBeDefined();
  });

  it('sets additionalProperties to false on every closed object (Requirement 3.3)', () => {
    const objects = closedObjects(schema);
    expect(objects.map(([at]) => at)).toEqual(
      expect.arrayContaining([
        '(root)',
        'target',
        'target.ready',
        'context',
        'assessment',
        'assessment.thresholds',
        'runtime',
        'runtime.viewport',
        'jev',
        'output',
      ]),
    );
    for (const [at, node] of objects) {
      expect(node.additionalProperties, at).toBe(false);
    }
  });

  it('produces byte-identical output on two runs (Requirement 3.4)', () => {
    expect(serializeSchema()).toBe(serializeSchema());
  });

  it('documents the looseness on context.redact items and target.url (Requirements 3.7, 3.8)', () => {
    const redact = lookup(schema, 'context.redact') as Node;
    const items = redact.items as Node;
    expect(typeof items.description).toBe('string');
    expect(items.description).toMatch(/looser than ConfigSchema/);
    const url = lookup(schema, 'target.url') as Node;
    expect(typeof url.description).toBe('string');
    expect(url.description).toMatch(/looser than ConfigSchema/);
  });
});

describe('committed schemas/ce.schema.json', () => {
  it('is up to date with the generator (Requirement 3.5)', () => {
    const committed = readFileSync(committedPath, 'utf8');
    if (committed !== serializeSchema()) {
      throw new Error(
        'schemas/ce.schema.json is stale — run "npm run generate:config-schema" and commit the result',
      );
    }
  });
});
