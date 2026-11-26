import { describe, expect, it } from 'vitest';
import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { ChangeContext } from '../context/types.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { RateLimitError } from '../jev/errors.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { assess } from './assess.js';

const config = ConfigDefaults as EffectiveConfig;

function makeContext(title: string | undefined): ChangeContext {
  const change: ChangeContext['change'] = { files: [], commits: [], claims: [], provenance: [] };
  if (title !== undefined) change.title = title;
  return { change, candidates: [], checks: [], truncated: [], providers: [], redactions: [] };
}

function validAnswers(request: Jev_Request): Jev_Response['answers'] {
  const answers: Jev_Response['answers'] = {};
  for (const name of Object.keys(request.questions)) {
    answers[name] =
      name === 'surface'
        ? ({
            type: 'choice',
            probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, 1 / SURFACE_LABELS.length])),
          } as never)
        : ({ type: 'noul', noul: 0.5 } as never);
  }
  return answers;
}

function gatewayWith(answer: (request: Jev_Request) => Jev_Response['answers']): JevGateway {
  return {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      return {
        model: 'typesafe/jev-test',
        answers: answer(request),
        usage: { input_tokens: null, output_tokens: null },
      };
    },
  };
}

function throwingGateway(error: unknown): JevGateway {
  return {
    async ask(): Promise<Jev_Response> {
      throw error;
    },
  };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
}

describe('assess() errors and edge cases', () => {
  it('gives not_identified with one Change_Subject when no Claim is accepted', async () => {
    const result = await assess(makeContext('Add login form'), config, gatewayWith(validAnswers));
    expect(result.claims).toEqual([]);
    expect(result.assessment.claimStatus).toBe('not_identified');
    expect(result.assessment.subjects).toHaveLength(1);
    expect(result.assessment.subjects[0]).toMatchObject({
      id: 'change',
      kind: 'change',
      text: 'Add login form',
    });
  });

  it('raises StageError(assessment) for an empty context', async () => {
    const error = await failureOf(assess(makeContext(undefined), config, gatewayWith(validAnswers)));
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('assessment');
  });

  it('raises StageError(assessment) for a malformed answer', async () => {
    const gateway = gatewayWith((request) => {
      const answers = validAnswers(request);
      answers['runtime_observable'] = { type: 'noul', noul: 1.5 } as never;
      return answers;
    });
    const error = await failureOf(assess(makeContext('Add login form'), config, gateway));
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('assessment');
    expect((error as StageError).cause).toBeInstanceOf(RangeError);
  });

  it('wraps RateLimitError as StageError(assessment) and keeps the cause', async () => {
    const cause = new RateLimitError(1000);
    const error = await failureOf(assess(makeContext('Add login form'), config, throwingGateway(cause)));
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('assessment');
    expect((error as StageError).cause).toBe(cause);
  });

  it('passes a foreign StageError(context) through unchanged', async () => {
    const foreign = new StageError('context', new Error('boom'));
    const error = await failureOf(assess(makeContext('Add login form'), config, throwingGateway(foreign)));
    expect(error).toBe(foreign);
    expect((error as StageError).stage).toBe('context');
  });
});
