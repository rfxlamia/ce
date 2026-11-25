import { z } from 'zod';
import { ConfigSchema } from './schema.js';

const REDACT_DESCRIPTION =
  'This generated schema does not check that each item compiles as a RegExp and is looser than ConfigSchema on this rule. ConfigSchema in config/schema.ts is authoritative.';
const URL_DESCRIPTION =
  'This generated schema does not restrict the URL scheme to http or https and is looser than ConfigSchema on this rule. ConfigSchema in config/schema.ts is authoritative.';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`generated JSON Schema has no object at ${path}`);
  }
  return value as JsonObject;
}

function appendDescription(node: JsonObject, text: string): void {
  node.description = typeof node.description === 'string' ? `${node.description} ${text}` : text;
}

/** Config_Schema -> JSON Schema (draft-7), with the two documented looseness notes. */
export function generateJsonSchema(): object {
  const schema = z.toJSONSchema(ConfigSchema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  }) as JsonObject;

  const properties = asObject(schema.properties, 'properties');
  const target = asObject(properties.target, 'target');
  const url = asObject(asObject(target.properties, 'target.properties').url, 'target.url');
  appendDescription(url, URL_DESCRIPTION);

  const context = asObject(properties.context, 'context');
  const redact = asObject(asObject(context.properties, 'context.properties').redact, 'context.redact');
  const items = asObject(redact.items, 'context.redact.items');
  appendDescription(items, REDACT_DESCRIPTION);

  return schema;
}

/** Canonical on-disk form of the generated schema (used by the generator and the staleness test). */
export function serializeSchema(): string {
  return JSON.stringify(generateJsonSchema(), null, 2) + '\n';
}
