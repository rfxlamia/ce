import { Ajv } from 'ajv';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateJsonSchema } from '../json-schema.js';
import { ConfigSchema } from '../schema.js';

// Feature: ce-config-loader, Property 3: JSON Schema and Config_Schema agree, within the two documented exceptions

// `format: "uri"` is not checked (the URL scheme exception covers it) and
// `strict: false` tolerates annotation keywords the converter may emit.
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
const validateJson = ajv.compile(generateJsonSchema() as object);

const word = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
const probability = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });
const posInt = fc.integer({ min: 1, max: 100000 });
const duration = fc
  .tuple(fc.integer({ min: 1, max: 100000 }), fc.constantFrom('ms', 's', 'm'))
  .map(([n, u]) => `${n}${u}`);
const httpUrl = fc
  .tuple(fc.constantFrom('http', 'https'), word, fc.integer({ min: 1, max: 65535 }))
  .map(([s, h, p]) => `${s}://${h}.example:${p}/`);
// Only compilable redact items: plain sources and /pattern/flags.
const redactItem = fc.constantFrom('abc', '[a-z]+', 'sk-[0-9]+', '/token=\\w+/i', '/^x$/', 'a|b');
const strList = fc.array(word, { maxLength: 3 });

/** Builds an object where each optional key is present or absent. */
function sparse<T extends Record<string, fc.Arbitrary<unknown>>>(shape: T): fc.Arbitrary<Record<string, unknown>> {
  return fc.record(shape as Record<string, fc.Arbitrary<unknown>>, { requiredKeys: [] }) as fc.Arbitrary<
    Record<string, unknown>
  >;
}

const validConfig = sparse({
  version: fc.constant(0),
  target: sparse({
    url: httpUrl,
    start: word,
    ready: sparse({ path: word, timeout: duration }),
    routes: strList,
  }),
  context: sparse({
    base: word,
    include: strList,
    exclude: strList,
    redact: fc.array(redactItem, { maxLength: 3 }),
    checks: word,
  }),
  assessment: sparse({
    thresholds: sparse({ claim: probability, observable: probability, adequate: probability }),
    'uncertainty-band': probability,
    'on-uncertain': fc.constantFrom('evidence', 'skip'),
  }),
  runtime: sparse({
    'max-steps': posInt,
    timeout: duration,
    viewport: sparse({ width: posInt, height: posInt }),
    fixtures: fc.dictionary(word, word, { maxKeys: 3 }),
  }),
  jev: sparse({ provider: fc.constantFrom('openrouter', 'typesafe'), model: word }),
  output: sparse({
    dir: word,
    'fail-on': fc.array(fc.constantFrom('error', 'unsupported', 'evidenced-not-reached'), { maxLength: 3 }),
  }),
});

// Level paths of closed objects, for unknown-key injection.
const LEVELS: string[][] = [
  [],
  ['target'],
  ['target', 'ready'],
  ['context'],
  ['assessment'],
  ['assessment', 'thresholds'],
  ['runtime'],
  ['runtime', 'viewport'],
  ['jev'],
  ['output'],
];

const unknownName = fc.oneof(
  word.map((w) => `x-${w}`),
  fc.constantFrom('api-key', 'apikey', 'secret', 'token', 'password', 'OPENROUTER_API_KEY'),
);

// Wrong values per leaf path. Each is invalid for both validators.
const BAD_LEAVES: { path: string[]; bad: fc.Arbitrary<unknown> }[] = [
  { path: ['version'], bad: fc.oneof(fc.constant(1), fc.constant('0'), fc.integer({ min: 2, max: 9 })) },
  { path: ['target', 'url'], bad: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)) },
  { path: ['target', 'start'], bad: fc.oneof(fc.integer(), fc.boolean()) },
  { path: ['target', 'ready', 'timeout'], bad: fc.constantFrom('0s', '10', '1h', '-5s', '1.5s', '', 's', '01s', ' 5s', 5) },
  { path: ['target', 'routes'], bad: fc.oneof(word, fc.constant([1]), fc.constant([null])) },
  { path: ['context', 'redact'], bad: fc.oneof(word, fc.constant([1]), fc.constant({})) },
  { path: ['assessment', 'thresholds', 'claim'], bad: fc.oneof(fc.double({ min: 1.001, max: 100, noNaN: true }), fc.double({ min: -100, max: -0.001, noNaN: true }), word) },
  { path: ['assessment', 'uncertainty-band'], bad: fc.oneof(fc.constant(2), fc.constant(-1), fc.constant('0.1')) },
  { path: ['assessment', 'on-uncertain'], bad: fc.oneof(word.map((w) => `z${w}`), fc.constant(true), fc.constant(1)) },
  { path: ['runtime', 'max-steps'], bad: fc.oneof(fc.constant(0), fc.integer({ min: -100, max: -1 }), fc.constant(1.5), fc.constant('3')) },
  { path: ['runtime', 'timeout'], bad: fc.constantFrom('0ms', '90', '2h', 'ms', '1.5m', 90) },
  { path: ['runtime', 'viewport', 'width'], bad: fc.oneof(fc.constant(0), fc.constant(-3), fc.constant(2.5), fc.constant('800')) },
  { path: ['runtime', 'viewport', 'height'], bad: fc.oneof(fc.constant(0), fc.constant(0.5), fc.constant(null)) },
  { path: ['runtime', 'fixtures'], bad: fc.oneof(word, fc.constant({ a: 1 }), fc.constant([])) },
  { path: ['jev', 'provider'], bad: fc.oneof(word.map((w) => `z${w}`), fc.constant('OpenRouter'), fc.constant(3)) },
  { path: ['jev', 'model'], bad: fc.oneof(fc.integer(), fc.constant(null)) },
  { path: ['output', 'dir'], bad: fc.oneof(fc.integer(), fc.constant([])) },
  { path: ['output', 'fail-on'], bad: fc.oneof(fc.constant(['bogus']), fc.constant('error'), fc.constant([1])) },
  { path: ['target'], bad: fc.oneof(fc.constant('x'), fc.constant([]), fc.constant(5)) },
  { path: ['runtime', 'viewport'], bad: fc.oneof(fc.constant('x'), fc.constant([])) },
];

function setAt(root: Record<string, any>, path: string[], value: unknown): void {
  let node = root;
  for (const key of path.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null || Array.isArray(node[key])) node[key] = {};
    node = node[key];
  }
  node[path[path.length - 1]!] = value;
}

const mutated = fc
  .tuple(
    validConfig,
    fc.oneof(
      fc.tuple(fc.constantFrom(...LEVELS), unknownName).map(([level, name]) => ({ kind: 'unknown' as const, level, name })),
      fc.constantFrom(...BAD_LEAVES).chain((l) => l.bad.map((value) => ({ kind: 'bad' as const, path: l.path, value }))),
    ),
  )
  .map(([base, m]) => {
    const copy = structuredClone(base) as Record<string, any>;
    if (m.kind === 'unknown') setAt(copy, [...m.level, m.name], 'v');
    else setAt(copy, m.path, m.value);
    return copy;
  });

const anyConfig = fc.oneof(validConfig, mutated, fc.constantFrom<unknown>(null, [], 'x', 5, {}));

describe('Property 3: JSON Schema and Config_Schema agree', () => {
  it('ajv(JSON Schema) and ConfigSchema.safeParse accept and reject the same configs', () => {
    fc.assert(
      fc.property(anyConfig, (config) => {
        const jsonOk = validateJson(config) as boolean;
        const zodOk = ConfigSchema.safeParse(config).success;
        expect(jsonOk, JSON.stringify({ config, ajvErrors: validateJson.errors })).toBe(zodOk);
      }),
      { numRuns: 300 },
    );
  });

  it('generator reaches both outcomes', () => {
    const outcomes = new Set<boolean>();
    fc.assert(
      fc.property(anyConfig, (config) => {
        outcomes.add(ConfigSchema.safeParse(config).success);
      }),
      { numRuns: 100 },
    );
    expect(outcomes).toEqual(new Set([true, false]));
  });
});
