import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ConfigSchema, CREDENTIAL_KEY_NAME_PATTERN, SECRETS_IN_ENV_MESSAGE } from '../schema.js';

// A valid configuration with every strict object level present.
function validConfig(): Record<string, any> {
  return {
    version: 0,
    target: { url: 'http://localhost:3000', start: 'npm start', ready: { path: '/', timeout: '30s' }, routes: ['/'] },
    context: { base: 'main', include: ['src/**'], exclude: ['dist/**'], redact: ['abc'], checks: 'junit.xml' },
    assessment: {
      thresholds: { claim: 0.6, observable: 0.6, adequate: 0.7 },
      'uncertainty-band': 0.1,
      'on-uncertain': 'evidence',
    },
    runtime: { 'max-steps': 12, timeout: '90s', viewport: { width: 1280, height: 800 }, fixtures: { a: 'b' } },
    jev: { provider: 'openrouter', model: 'typesafe/jev-1.14' },
    output: { dir: '.ce/runs', 'fail-on': ['error'] },
  };
}

// Every strict object level, with the keys the schema defines there.
const LEVELS: { path: string[]; known: string[] }[] = [
  { path: [], known: ['version', 'target', 'context', 'assessment', 'runtime', 'jev', 'output'] },
  { path: ['target'], known: ['url', 'start', 'ready', 'routes'] },
  { path: ['target', 'ready'], known: ['path', 'timeout'] },
  { path: ['context'], known: ['base', 'include', 'exclude', 'redact', 'checks'] },
  { path: ['assessment'], known: ['thresholds', 'uncertainty-band', 'on-uncertain'] },
  { path: ['assessment', 'thresholds'], known: ['claim', 'observable', 'adequate'] },
  { path: ['runtime'], known: ['max-steps', 'timeout', 'viewport', 'fixtures'] },
  { path: ['runtime', 'viewport'], known: ['width', 'height'] },
  { path: ['jev'], known: ['provider', 'model'] },
  { path: ['output'], known: ['dir', 'fail-on'] },
];

const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('');
const plainName = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.array(fc.constantFrom(...NAME_CHARS), { maxLength: 10 }),
  )
  .map(([head, tail]) => head + tail.join(''))
  .filter((name) => !CREDENTIAL_KEY_NAME_PATTERN.test(name));

const credentialName = fc
  .tuple(
    fc.array(fc.constantFrom(...NAME_CHARS), { maxLength: 5 }),
    fc.constantFrom('api-key', 'apikey', 'secret', 'token', 'password'),
    fc.array(fc.constantFrom(...NAME_CHARS), { maxLength: 5 }),
    fc.boolean(),
  )
  .map(([pre, core, post, upper]) => `x${pre.join('')}${upper ? core.toUpperCase() : core}${post.join('')}`);

function inject(level: (typeof LEVELS)[number], key: string) {
  const config = validConfig();
  let node = config;
  for (const segment of level.path) node = node[segment];
  node[key] = 'value';
  return config;
}

function issuesFor(config: unknown) {
  const result = ConfigSchema.safeParse(config);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues;
}

describe('Property 1: Unknown and credential-named keys are always rejected', () => {
  it('base config is valid', () => {
    expect(ConfigSchema.safeParse(validConfig()).success).toBe(true);
  });

  // Feature: ce-config-loader, Property 1: Unknown and credential-named keys are always rejected
  // **Validates: Requirements 1.12, 1.13**
  it('rejects an unknown key injected at any object level, naming the key and its path', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LEVELS), plainName, (level, key) => {
        fc.pre(!level.known.includes(key));
        const issues = issuesFor(inject(level, key));
        const hit = issues.find(
          (issue) =>
            issue.code === 'unrecognized_keys' &&
            issue.path.join('.') === level.path.join('.') &&
            issue.message.includes(key),
        );
        expect(hit).toBeDefined();
        expect(hit!.message).not.toContain(SECRETS_IN_ENV_MESSAGE);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: ce-config-loader, Property 1: Unknown and credential-named keys are always rejected
  // **Validates: Requirements 1.12, 1.13**
  it('rejects a credential-named key at any object level with the secrets-in-environment message', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LEVELS), credentialName, (level, key) => {
        const issues = issuesFor(inject(level, key));
        const hit = issues.find(
          (issue) =>
            issue.code === 'unrecognized_keys' &&
            issue.path.join('.') === level.path.join('.') &&
            issue.message.includes(key),
        );
        expect(hit).toBeDefined();
        expect(hit!.message).toContain(SECRETS_IN_ENV_MESSAGE);
      }),
      { numRuns: 200 },
    );
  });
});
