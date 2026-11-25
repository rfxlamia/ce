import { z } from 'zod';
import { DURATION_PATTERN } from './duration.js';
import {
  compileRedactPattern,
  InlineFlagError,
  RegexCompileError,
} from './redact-pattern.js';

/**
 * Matches key names that name a credential (Requirement 1.13).
 * Applied to unrecognized keys only; `context.redact` items and
 * `runtime.fixtures` keys are never unrecognized keys.
 */
export const CREDENTIAL_KEY_NAME_PATTERN = /api-?key|secret|token|password/i;

export const SECRETS_IN_ENV_MESSAGE =
  'secrets belong in environment variables, not in ce.yml';

/** Error map shared by every strictObject: classifies unrecognized keys. */
function unknownKeyError(issue: { code?: string; keys?: readonly string[] }): string | undefined {
  if (issue.code !== 'unrecognized_keys') return undefined;
  const keys = issue.keys ?? [];
  const credentialKeys = keys.filter((key) => CREDENTIAL_KEY_NAME_PATTERN.test(key));
  if (credentialKeys.length > 0) {
    return `${SECRETS_IN_ENV_MESSAGE} (key: ${credentialKeys.join(', ')})`;
  }
  return `unknown key: ${keys.join(', ')}`;
}

function strict<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, { error: unknownKeyError });
}

const DurationString = z
  .string()
  .regex(DURATION_PATTERN, 'duration string like "90s" (positive integer and unit ms, s or m)');

const Probability = z.number().min(0).max(1);
const PositiveInt = z.number().int().positive();

/** Absolute http or https URL (Requirement 1.10). */
const HttpUrl = z.url({ protocol: /^https?$/ });

/**
 * One `context.redact` item (Requirements 1.11, 1.16, 1.17).
 * Compile failures become issues at `context.redact.<index>` whose message
 * is the matching `expected` text.
 */
const RedactPattern = z.string().superRefine((item, ctx) => {
  try {
    compileRedactPattern(item);
  } catch (error) {
    if (error instanceof InlineFlagError || error instanceof RegexCompileError) {
      ctx.addIssue({
        code: 'custom',
        message: error.expected,
        params: { expected: error.expected, kind: error.name },
      });
      return;
    }
    throw error;
  }
});

export const ConfigSchema = strict({
  version: z.literal(0).optional(),
  target: strict({
    url: HttpUrl.optional(),
    start: z.string().optional(),
    ready: strict({
      path: z.string().optional(),
      timeout: DurationString.optional(),
    }).optional(),
    routes: z.array(z.string()).optional(),
  }).optional(),
  context: strict({
    base: z.string().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    redact: z.array(RedactPattern).optional(),
    checks: z.string().optional(),
  }).optional(),
  assessment: strict({
    thresholds: strict({
      claim: Probability.optional(),
      observable: Probability.optional(),
      adequate: Probability.optional(),
    }).optional(),
    'uncertainty-band': Probability.optional(),
    'on-uncertain': z.enum(['evidence', 'skip']).optional(),
  }).optional(),
  runtime: strict({
    'max-steps': PositiveInt.optional(),
    timeout: DurationString.optional(),
    viewport: strict({
      width: PositiveInt.optional(),
      height: PositiveInt.optional(),
    }).optional(),
    fixtures: z.record(z.string(), z.string()).optional(),
  }).optional(),
  jev: strict({
    provider: z.enum(['openrouter', 'typesafe']).optional(),
    model: z.string().optional(),
  }).optional(),
  output: strict({
    dir: z.string().optional(),
    'fail-on': z.array(z.enum(['error', 'unsupported', 'evidenced-not-reached'])).optional(),
  }).optional(),
});

export type EffectiveConfig = z.infer<typeof ConfigSchema>;
