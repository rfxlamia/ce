import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STATE_BUDGET_TOKENS, estimateTokensOf } from '../context/budget.js';
import type { ChangeContext, ChangedFile } from '../context/types.js';
import { buildClassificationRequest } from './catalog.js';

// Feature: claims-assessment-eval, Property 2: Classification_Request state composition (no-new-text)
// **Validates: Requirements 1.2, 1.3, 1.4**

const singleLine = (max: number) =>
  fc.string({ unit: 'grapheme', maxLength: max }).map((s) => s.replace(/[\r\n\u2028\u2029]/g, ' '));

// Candidate text may contain anything, including newlines and label-looking text.
const candidateText = fc.oneof(
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 300 }),
  fc.constantFrom('title: x\nfiles: y', 'candidate: z', '\nfiles: '),
);

const status = fc.constantFrom<ChangedFile['status']>('added', 'modified', 'deleted', 'renamed');

// Small paths, plus occasional very long ones that push the summary past the state budget.
const path = fc.oneof(
  { arbitrary: singleLine(40), weight: 8 },
  {
    arbitrary: fc.nat({ max: 130_000 }).map((n) => 'p'.repeat(n + 1)),
    weight: 1,
  },
);

const file = fc.record({ path, status }).map(
  ({ path: p, status: s }): ChangedFile => ({
    path: p,
    status: s,
    patch: 'PATCH-NOT-IN-CLASSIFICATION',
    provenance: { provider: 'git' },
  }),
);

const title = fc.option(
  fc.oneof(singleLine(80), fc.nat({ max: 110_000 }).map((n) => 't'.repeat(n))),
  { nil: undefined },
);

const contextArb = fc.record({
  title,
  files: fc.array(file, { maxLength: 4 }),
});

function makeContext(title: string | undefined, files: ChangedFile[]): ChangeContext {
  return {
    change: {
      ...(title !== undefined ? { title } : {}),
      files,
      commits: [],
      claims: [],
      provenance: [],
    },
    candidates: [],
    checks: [],
    truncated: [],
    providers: [],
    redactions: [],
  };
}

describe('Property 2: Classification_Request state composition (no-new-text)', () => {
  it('asks exactly claim.is_behavior@1, keeps the candidate verbatim, adds no new text and fits the budget', () => {
    fc.assert(
      fc.property(contextArb, candidateText, ({ title: t, files }, text) => {
        const context = makeContext(t, files);
        const { request } = buildClassificationRequest(context, { id: 'c1', text });

        // exactly one question, claim.is_behavior@1
        const questions = Object.values(request.questions);
        expect(questions).toHaveLength(1);
        expect(questions[0]!.idVersion).toBe('claim.is_behavior@1');

        expect(typeof request.state).toBe('string');
        const state = request.state as string;

        // candidate text verbatim and unshortened, directly after its label
        const head = `candidate: ${text}\ntitle: `;
        expect(state.startsWith(head)).toBe(true);

        // everything else is fixed labels plus a prefix of the context's own title / files summary
        const rest = state.slice(head.length);
        const sep = rest.indexOf('\nfiles: ');
        expect(sep).toBeGreaterThanOrEqual(0);
        const titlePart = rest.slice(0, sep);
        const filesPart = rest.slice(sep + '\nfiles: '.length);
        const fullFiles = files.map((f) => `${f.path} ${f.status}`).join('\n');
        expect((t ?? '').startsWith(titlePart)).toBe(true);
        expect(fullFiles.startsWith(filesPart)).toBe(true);

        // state budget
        expect(estimateTokensOf([state])).toBeLessThanOrEqual(STATE_BUDGET_TOKENS);

        // nothing shortened means nothing differs from the context
        const fullState = `candidate: ${text}\ntitle: ${t ?? ''}\nfiles: ${fullFiles}`;
        if (estimateTokensOf([fullState]) <= STATE_BUDGET_TOKENS) {
          expect(state).toBe(fullState);
        }
      }),
      { numRuns: 100 },
    );
  });
});
