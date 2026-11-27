import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Call log of the Jev gateway (`jev-calls.jsonl`).
 *
 * The schema is closed on purpose. It has no field for state text, image
 * bytes, question instructions, option descriptions, an API key or an
 * Authorization header, and `strictObject` rejects any extra key, so none of
 * them can be written (Requirement 12 criteria 4 and 6).
 */

const Stage = z.enum(['config', 'context', 'assessment', 'runtime', 'evidence']);

const Probability = z.number().min(0).max(1);
const TokenCount = z.number().int().nonnegative().nullable();

/**
 * Probabilities keyed by label or score. For `runtime.next_action` the keys
 * are zero-based option indexes plus `done` and `give_up`, never label text
 * (Requirement 12 criterion 5). The gateway chooses the keys; the schema only
 * fixes the value type.
 */
const ProbabilityMap = z.record(z.string(), Probability);

const NoulAnswerLog = z.strictObject({
  type: z.literal('noul'),
  probability: Probability,
});

const ChoiceAnswerLog = z.strictObject({
  type: z.literal('choice'),
  probabilities: ProbabilityMap,
});

const ScoreAnswerLog = z.strictObject({
  type: z.literal('score'),
  probabilities: ProbabilityMap,
});

const BoxAnswerLog = z.strictObject({
  type: z.literal('box'),
  box: z.strictObject({
    top: Probability,
    bottom: Probability,
    left: Probability,
    right: Probability,
  }),
  confidence: Probability.nullable(),
});

const AnswerLog = z.discriminatedUnion('type', [
  NoulAnswerLog,
  ChoiceAnswerLog,
  ScoreAnswerLog,
  BoxAnswerLog,
]);

const QuestionLog = z.strictObject({
  id: z.string().min(1),
  version: z.number().int().positive(),
  type: z.enum(['noul', 'choice', 'score', 'box']),
});

export const CallLogEntrySchema = z.strictObject({
  /** ISO 8601 UTC, the time the first attempt was sent. */
  timestamp: z.iso.datetime(),
  stage: Stage,
  transport: z.enum(['sdk', 'json', 'fake']),
  provider: z.enum(['openrouter', 'typesafe']),
  requestedModel: z.string(),
  /** Returned_Model_Id, or null on failure. */
  model: z.string().nullable(),
  questions: z.array(QuestionLog),
  /** Answers keyed by question name. Empty on failure. */
  answers: z.record(z.string(), AnswerLog),
  latencyMs: z.number().nonnegative(),
  usage: z.strictObject({
    input_tokens: TokenCount,
    output_tokens: TokenCount,
  }),
  /** Lowercase hexadecimal SHA-256 of the state. */
  stateHash: z.string().regex(/^[0-9a-f]{64}$/, '64 lowercase hexadecimal digits'),
  status: z.enum(['ok', 'error']),
  /** Number of HTTP requests sent for the call. */
  attempts: z.number().int().nonnegative(),
  errorKind: z
    .enum([
      'bad_request',
      'rate_limited',
      'timeout',
      'connection',
      'server',
      'invalid_image',
      'invalid_response',
      'client',
      'rate_limit',
      'auth',
      'abort',
      'other',
    ])
    .optional(),
  httpStatus: z.number().int().optional(),
});

export type CallLogEntry = z.infer<typeof CallLogEntrySchema>;

export interface CallLog {
  /** Validates `entry` against CallLogEntrySchema, then writes one line. */
  append(entry: CallLogEntry): Promise<void>;
}

/**
 * Appends one JSON object per line to `path`. Creates the parent directory.
 * Appends run through a promise queue, so lines never interleave and keep the
 * order of `append` calls (Requirement 12 criteria 9 and 12).
 */
export function createJsonlCallLog(path: string): CallLog {
  let queue: Promise<void> = Promise.resolve();
  let directoryReady: Promise<void> | undefined;

  const ensureDirectory = (): Promise<void> => {
    directoryReady ??= mkdir(dirname(path), { recursive: true }).then(() => undefined);
    // A failed mkdir must not be cached, or every later append would fail.
    directoryReady.catch(() => {
      directoryReady = undefined;
    });
    return directoryReady;
  };

  return {
    append(entry: CallLogEntry): Promise<void> {
      // Reject before anything is queued or written.
      const parsed = CallLogEntrySchema.safeParse(entry);
      if (!parsed.success) {
        return Promise.reject(
          new Error(
            `invalid call log entry: ${parsed.error.issues
              .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
              .join('; ')}`,
          ),
        );
      }
      const line = `${JSON.stringify(parsed.data)}\n`;
      const write = queue.then(async () => {
        await ensureDirectory();
        await appendFile(path, line, 'utf8');
      });
      // A failed write must not block later appends.
      queue = write.catch(() => undefined);
      return write;
    },
  };
}
