import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import type { ChangeContext, Provenance } from '../context/types.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { assess, selectChangeSubject } from './assess.js';

// Feature: claims-assessment-eval, Property 6: Change_Subject selection priority
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

const config = ConfigDefaults as EffectiveConfig;

/** A text source: absent, or text built from lines that may be blank or padded. */
const lineArb = fc.oneof(
  fc.constant(''),
  fc.constantFrom(' ', '\t', '  \t '),
  fc
    .tuple(fc.constantFrom('', ' ', '\t'), fc.stringMatching(/^[a-z0-9]{1,12}$/), fc.constantFrom('', ' ', '\t'))
    .map(([a, b, c]) => `${a}${b}${c}`),
);
const textArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc
    .tuple(fc.array(lineArb, { maxLength: 4 }), fc.constantFrom('\n', '\r\n', '\r'))
    .map(([lines, sep]) => lines.join(sep)),
);

const githubProvenanceArb: fc.Arbitrary<Provenance[]> = fc.oneof(
  fc.constant<Provenance[]>([]),
  fc.constant<Provenance[]>([{ provider: 'github', ref: 'pr/1' }]),
);

function firstNonBlank(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .find((l) => l !== '');
}

function makeContext(
  title: string | undefined,
  description: string | undefined,
  messages: string[],
  provenance: Provenance[],
  candidates: ChangeContext['candidates'] = [],
): ChangeContext {
  const change: ChangeContext['change'] = {
    files: [],
    commits: messages.map((message, i) => ({
      sha: `sha${i}`,
      message,
      provenance: { provider: 'git', ref: `sha${i}` },
    })),
    claims: [],
    provenance,
  };
  if (title !== undefined) change.title = title;
  if (description !== undefined) change.description = description;
  return { change, candidates, checks: [], truncated: [], providers: [], redactions: [] };
}

/** Gateway that answers every question with a fixed valid answer. */
class StubGateway implements JevGateway {
  calls = 0;
  async ask(request: Jev_Request): Promise<Jev_Response> {
    this.calls += 1;
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
    return { model: 'typesafe/jev-test', answers, usage: { input_tokens: null, output_tokens: null } };
  }
}

describe('Feature: claims-assessment-eval, Property 6: Change_Subject selection priority', () => {
  it('selects the first non-blank trimmed line of title, description, then first commit message', () => {
    fc.assert(
      fc.property(
        textArb,
        textArb,
        fc.array(fc.string({ maxLength: 30 }).chain((s) => textArb.map((t) => t ?? s)), { maxLength: 4 }),
        githubProvenanceArb,
        (title, description, messages, provenance) => {
          const context = makeContext(title, description, messages, provenance);
          const fromTitle = firstNonBlank(title);
          const fromDescription = firstNonBlank(description);
          const commitIndex = messages.findIndex((m) => firstNonBlank(m) !== undefined);
          const github = (location: string): Provenance =>
            provenance.find((p) => p.provider === 'github') ?? { provider: 'github', location };

          if (fromTitle === undefined && fromDescription === undefined && commitIndex === -1) {
            expect(() => selectChangeSubject(context)).toThrow(StageError);
            return;
          }

          const subject = selectChangeSubject(context);
          expect(subject.id).toBe('change');
          expect(subject.kind).toBe('change');
          if (fromTitle !== undefined) {
            expect(subject.text).toBe(fromTitle);
            expect(subject.provenance).toEqual(github('title'));
          } else if (fromDescription !== undefined) {
            expect(subject.text).toBe(fromDescription);
            expect(subject.provenance).toEqual(github('description'));
          } else {
            expect(subject.text).toBe(firstNonBlank(messages[commitIndex]));
            expect(subject.provenance).toEqual(context.change.commits[commitIndex]!.provenance);
          }
          expect(subject.text).toBe(subject.text.trim());
          expect(subject.text).not.toContain('\n');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('skips a description whose first line is blank and uses its first non-blank line', () => {
    const context = makeContext(undefined, '\n  \n  Add login form  \nsecond', ['commit msg'], []);
    const subject = selectChangeSubject(context);
    expect(subject.text).toBe('Add login form');
    expect(subject.provenance).toEqual({ provider: 'github', location: 'description' });
  });

  it('prefers a non-blank title over description and commits', () => {
    const context = makeContext('  Title  \nmore', 'Desc', ['msg'], []);
    expect(selectChangeSubject(context).text).toBe('Title');
  });

  it('falls back to the first commit message with a non-blank line', () => {
    const context = makeContext('  ', '\n\n', ['', '  \n x  ', 'later'], []);
    const subject = selectChangeSubject(context);
    expect(subject.text).toBe('x');
    expect(subject.provenance).toEqual({ provider: 'git', ref: 'sha1' });
  });

  it('assess() throws StageError(assessment) when no title, description or commit has text, without selecting text', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('', ' ', '\t', '\n', ' \r\n '), { maxLength: 3 }).map((a) => a.join('')),
        fc.oneof(fc.constant(undefined), fc.constantFrom('', ' ', '\n\n')),
        fc.array(fc.constantFrom('', ' ', '\n'), { maxLength: 3 }),
        async (title, description, messages) => {
          const gateway = new StubGateway();
          const context = makeContext(title, description, messages, []);
          const error = await assess(context, config, gateway).then(
            () => undefined,
            (e: unknown) => e,
          );
          expect(error).toBeInstanceOf(StageError);
          expect((error as StageError).stage).toBe('assessment');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('assess() on a context with no title, description or commits throws StageError', async () => {
    const gateway = new StubGateway();
    await expect(assess(makeContext(undefined, undefined, [], []), config, gateway)).rejects.toBeInstanceOf(
      StageError,
    );
  });

  it('assess() with not_identified uses the selected Change_Subject; with identified creates none', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z]{1,12}$/),
        fc.stringMatching(/^[a-z]{1,12}$/),
        async (title, claimText) => {
          const notIdentified = await assess(
            makeContext(`  ${title}  `, 'desc', ['msg'], []),
            config,
            new StubGateway(),
          );
          expect(notIdentified.assessment.claimStatus).toBe('not_identified');
          expect(notIdentified.assessment.subjects).toHaveLength(1);
          expect(notIdentified.assessment.subjects[0]).toMatchObject({
            id: 'change',
            kind: 'change',
            text: title,
          });

          const identified = await assess(
            makeContext(title, undefined, [], [], [
              { id: 'c0', text: claimText, provenance: { provider: 'cli' } },
            ]),
            config,
            new StubGateway(),
          );
          expect(identified.assessment.claimStatus).toBe('identified');
          expect(identified.assessment.subjects.every((s) => s.kind === 'claim')).toBe(true);
          expect(identified.assessment.subjects.some((s) => s.id === 'change')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
