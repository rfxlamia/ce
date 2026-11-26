// Docs-only gate on the Change_Subject path (claims-assessment-eval, Requirement 3
// criterion 7; issue #30). When no Claim is identified and every changed file is a
// Documentation_File, the Assessor asks no assessment question and `required` is false.

import { describe, expect, it } from 'vitest';
import { ConfigDefaults } from '../config/defaults.js';
import type { EffectiveConfig } from '../config/schema.js';
import { isDocumentationFile } from '../context/budget.js';
import type { ChangeContext, ChangedFile, TruncationReason } from '../context/types.js';
import { StageError } from '../errors.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import { assess } from './assess.js';

const config = ConfigDefaults as EffectiveConfig;
const TITLE = 'Document that login redirects to the dashboard';

function file(path: string, extra: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    status: 'modified',
    patch: '@@ -1,1 +1,2 @@\n Users sign in with email.\n+After sign in the user lands on the dashboard.',
    provenance: { provider: 'git', location: path },
    ...extra,
  };
}

function makeContext(
  files: ChangedFile[],
  options: {
    title?: string;
    truncated?: { file: string; reason: TruncationReason }[];
    commitMessage?: string;
  } = {},
): ChangeContext {
  const title = 'title' in options ? options.title : TITLE;
  const commitMessage = 'commitMessage' in options ? options.commitMessage : TITLE;
  const change: ChangeContext['change'] = {
    files,
    commits:
      commitMessage === undefined
        ? []
        : [{ sha: 'a1b2c3d', message: commitMessage, provenance: { provider: 'git', ref: 'a1b2c3d' } }],
    claims: [],
    provenance: [],
  };
  if (title !== undefined) change.title = title;
  const candidates: ChangeContext['candidates'] =
    title === undefined ? [] : [{ id: 'k1', text: title, provenance: { provider: 'github', location: 'title' } }];
  return {
    change,
    candidates,
    checks: [
      { name: 'build', status: 'passed', provenance: { provider: 'github' } },
      { name: 'lint', status: 'passed', provenance: { provider: 'github' } },
    ],
    truncated: options.truncated ?? [],
    providers: [],
    redactions: [],
  };
}

/** Rejects every candidate (is_behavior 0.1) and answers the assessment questions as in run 2. */
function recordingGateway(): { gateway: JevGateway; requests: Jev_Request[] } {
  const requests: Jev_Request[] = [];
  const gateway: JevGateway = {
    async ask(request: Jev_Request): Promise<Jev_Response> {
      requests.push(request);
      const answers: Jev_Response['answers'] = {};
      for (const name of Object.keys(request.questions)) {
        if (name === 'surface') {
          answers[name] = {
            type: 'choice',
            probabilities: Object.fromEntries(SURFACE_LABELS.map((l) => [l, l === 'browser_ui' ? 0.9 : 0.02])),
          } as never;
        } else if (name === 'is_behavior') {
          answers[name] = { type: 'noul', noul: 0.1 } as never;
        } else if (name === 'runtime_observable') {
          answers[name] = { type: 'noul', noul: 0.79 } as never;
        } else {
          answers[name] = { type: 'noul', noul: 0.05 } as never;
        }
      }
      return { model: 'typesafe/jev-test', answers, usage: { input_tokens: null, output_tokens: null } };
    },
  };
  return { gateway, requests };
}

const assessmentRequests = (requests: Jev_Request[]): Jev_Request[] =>
  requests.filter((r) => 'runtime_observable' in r.questions);

describe('isDocumentationFile', () => {
  it.each([
    'docs/auth.md',
    'README.md',
    'README.MD',
    'guide/intro.mdx',
    'CHANGES.markdown',
    'docs/index.rst',
    'manual/setup.adoc',
  ])('treats %s as documentation', (path) => {
    expect(isDocumentationFile(path)).toBe(true);
  });

  it.each([
    'src/x.ts',
    'requirements.txt',
    'CMakeLists.txt',
    'README',
    'LICENSE',
    '.github/workflows/ci.yml',
    'foo.md/bar.ts',
    'docs/site/page.tsx',
  ])('does not treat %s as documentation', (path) => {
    expect(isDocumentationFile(path)).toBe(false);
  });
});

describe('assess() docs-only gate (issue #30)', () => {
  it('asks no assessment question for the docs-near-miss-login shape', async () => {
    const { gateway, requests } = recordingGateway();
    const { claims, assessment } = await assess(makeContext([file('docs/auth.md')]), config, gateway);

    expect(claims).toEqual([]);
    expect(requests).toHaveLength(1); // the classification of the title candidate only
    expect(assessmentRequests(requests)).toHaveLength(0);
    expect(assessment.claimStatus).toBe('not_identified');
    expect(assessment.subjects).toEqual([]);
    expect(assessment.perClaim).toEqual([]);
    expect(assessment.required).toBe(false);
    expect(assessment.decidedBy).toBe('classifier');
    expect(assessment.surface).toBe('non_runtime');
    expect(assessment.record.subjectSkipped).toBe('docs-only');
    expect(assessment.record.questions.every((q) => q.idVersion.startsWith('claim.is_behavior'))).toBe(true);
  });

  it.each([
    ['a deleted markdown file', [file('docs/old.md', { status: 'deleted', patch: '' })]],
    ['an upper-case extension', [file('README.MD')]],
    ['several documentation formats', [file('docs/a.md'), file('docs/b.rst'), file('guide/c.mdx')]],
  ])('applies to %s', async (_name, files) => {
    const { gateway, requests } = recordingGateway();
    const { assessment } = await assess(makeContext(files), config, gateway);
    expect(assessmentRequests(requests)).toHaveLength(0);
    expect(assessment.required).toBe(false);
    expect(assessment.record.subjectSkipped).toBe('docs-only');
  });

  it('ignores pseudo-path and non-file truncation records', async () => {
    const { gateway, requests } = recordingGateway();
    const context = makeContext([file('docs/auth.md')], {
      truncated: [
        { file: '<candidates>', reason: 'candidate-cap' },
        { file: 'commit:a1b2c3d', reason: 'dropped' },
        { file: '<description>', reason: 'truncated' },
        { file: '<title>', reason: 'truncated' },
        { file: 'claim:1', reason: 'dropped' },
        { file: 'check:3', reason: 'check-cap' },
      ],
    });
    const { assessment } = await assess(context, config, gateway);
    expect(assessmentRequests(requests)).toHaveLength(0);
    expect(assessment.record.subjectSkipped).toBe('docs-only');
  });

  it.each([
    ['documentation plus source', makeContext([file('docs/auth.md'), file('src/x.ts')])],
    ['no changed files', makeContext([])],
    [
      'a non-documentation file dropped by the budgeter',
      makeContext([file('docs/auth.md')], { truncated: [{ file: 'src/x.ts', reason: 'dropped' }] }),
    ],
    ['a rename from source into docs', makeContext([file('docs/a.md', { status: 'renamed', oldPath: 'src/a.ts' })])],
    ['a rename from docs into source', makeContext([file('src/a.ts', { status: 'renamed', oldPath: 'docs/a.md' })])],
    ['a .txt file', makeContext([file('requirements.txt')])],
    ['a file inside a directory named like a markdown file', makeContext([file('foo.md/bar.ts')])],
  ])('keeps the Change_Subject fallback for %s', async (_name, context) => {
    const { gateway, requests } = recordingGateway();
    const { assessment } = await assess(context, config, gateway);
    expect(assessmentRequests(requests)).toHaveLength(1);
    expect(assessment.claimStatus).toBe('not_identified');
    expect(assessment.subjects).toHaveLength(1);
    expect(assessment.subjects[0]).toMatchObject({ id: 'change', kind: 'change' });
    expect(assessment.required).toBe(true);
    expect('subjectSkipped' in assessment.record).toBe(false);
  });

  it('still raises StageError (Decision D8) for a docs-only change with no text', async () => {
    const { gateway, requests } = recordingGateway();
    const context = makeContext([file('docs/auth.md')], { title: undefined, commitMessage: undefined });
    const error = await assess(context, config, gateway).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).stage).toBe('assessment');
    expect(requests).toHaveLength(0);
  });
});
