import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATE_BUDGET_TOKENS, estimateTokens } from '../context/budget.js';
import type { ChangeContext } from '../context/types.js';
import { buildAssessmentRequest } from './catalog.js';

// Feature: claims-assessment-eval, Property 7: Assessment_Request state composition (no-new-text)
// **Validates: Requirements 4.1, 4.2, 4.3, 4.11, 4.12**

const PROV = { provider: 'git' as const };
const STATUSES = ['added', 'modified', 'deleted', 'renamed'] as const;
const CHECK_STATUSES = ['passed', 'failed', 'skipped'] as const;

// Patch text has no digits, '/' or ':', so paths and labels cannot occur inside it.
const chunk = fc.string({ unit: fc.constantFrom('a', 'b', ' ', '+', '-', '@', '\n'), maxLength: 60 });
const patchArb = fc.oneof(
  { weight: 4, arbitrary: chunk },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.string({ unit: fc.constantFrom('a', 'b', ' ', '+', '\n'), minLength: 1, maxLength: 40 }), fc.integer({ min: 100, max: 4000 }))
      .map(([c, n]) => c.repeat(n)),
  },
);

const fileArb = (i: number) =>
  fc.record({
    isTest: fc.boolean(),
    status: fc.constantFrom(...STATUSES),
    patch: patchArb,
  }).map((f) => ({
    path: f.isTest ? `test/${i}.test.ts` : `src/${i}.ts`,
    status: f.status,
    patch: f.patch,
    provenance: PROV,
  }));

const filesArb = fc.integer({ min: 0, max: 5 }).chain((n) =>
  fc.tuple(...Array.from({ length: n }, (_, i) => fileArb(i))),
);

const checksArb = fc.array(
  fc.record({
    name: fc
      .tuple(fc.string({ unit: fc.constantFrom('a', 'b', 'c', ' ', '-'), maxLength: 20 }), fc.integer({ min: 1, max: 3000 }))
      .map(([s, n]) => `k${s}${'x'.repeat(fc.sample(fc.constant(n), 1)[0]! % 2 === 0 ? n : 1)}`),
    status: fc.constantFrom(...CHECK_STATUSES),
    provenance: fc.constant(PROV),
  }),
  { maxLength: 8 },
);

const contextArb: fc.Arbitrary<ChangeContext> = fc
  .record({ files: filesArb, checks: checksArb })
  .map(({ files, checks }) => ({
    change: { files, commits: [], claims: [], provenance: [] },
    candidates: [],
    checks,
    truncated: [],
    providers: [],
    redactions: [],
  }));

const subjectArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }),
  text: fc.string({ maxLength: 200 }),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Property 7: Assessment_Request state composition (no-new-text)', () => {
  it('holds exactly three questions and a state made of labels plus context/subject text', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access is forbidden');
    });
    vi.stubGlobal('fetch', fetchSpy);

    fc.assert(
      fc.property(contextArb, subjectArb, (context, subject) => {
        let built: ReturnType<typeof buildAssessmentRequest>;
        try {
          built = buildAssessmentRequest(context, subject);
        } catch (error) {
          // Over budget with every patch empty is a documented failure (4.9).
          expect((error as Error).message).toContain('exceeds the state budget');
          return;
        }
        const { request } = built;

        // 4.1, 4.2: stage and exactly three questions.
        expect(request.stage).toBe('assessment');
        expect(Object.keys(request.questions).sort()).toEqual(['checks_adequate', 'runtime_observable', 'surface']);

        const state = request.state as string;
        expect(typeof state).toBe('string');

        // 4.5: budget respected.
        expect(estimateTokens(state)).toBeLessThanOrEqual(STATE_BUDGET_TOKENS);

        // 4.3, 4.12: labels, then verbatim subject, file list, patch prefixes, check lines.
        const filesText = context.change.files.map((f) => `${f.path} ${f.status}`).join('\n');
        const head = `claim: ${subject.text}\nfiles: ${filesText}\npatches:\n`;
        expect(state.startsWith(head)).toBe(true);

        const rest = state.slice(head.length);
        const checksAt = rest.lastIndexOf('\nchecks: ');
        expect(checksAt).toBeGreaterThanOrEqual(0);
        const body = rest.slice(0, checksAt);
        const checksText = rest.slice(checksAt + '\nchecks: '.length);

        const files = context.change.files;
        let cursor = 0;
        files.forEach((file, i) => {
          const start = `${file.path}\n`;
          expect(body.startsWith(start, cursor)).toBe(true);
          cursor += start.length;
          let end = body.length;
          if (i + 1 < files.length) {
            end = body.indexOf(`\n${files[i + 1]!.path}\n`, cursor);
            expect(end).toBeGreaterThanOrEqual(cursor);
          }
          const patch = body.slice(cursor, end);
          expect(file.patch.startsWith(patch)).toBe(true);
          cursor = end + (i + 1 < files.length ? 1 : 0);
        });
        if (files.length === 0) expect(body).toBe('');

        const allowed = context.checks.map((c) => `${c.name} ${c.status}`);
        const lines = checksText === '' ? [] : checksText.split('\n');
        let from = 0;
        for (const line of lines) {
          const at = allowed.indexOf(line, from);
          expect(at).toBeGreaterThanOrEqual(0);
          from = at + 1;
        }
      }),
      { numRuns: 200 },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(contextArb, subjectArb, (context, subject) => {
        const run = () => {
          try {
            return buildAssessmentRequest(context, subject);
          } catch (error) {
            return (error as Error).message;
          }
        };
        expect(run()).toEqual(run());
      }),
      { numRuns: 100 },
    );
  });

  it('catalog.ts reads no environment, file system or network', () => {
    const source = readFileSync(new URL('./catalog.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/process\.env|node:fs|node:http|fetch\(/);
  });
});
