import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { budget, CONTEXT_BUDGET_TOKENS, estimateTokens } from './budget.js';
import type { ChangedFile, RawChangeContext } from './types.js';

const prov = { provider: 'git' as const };

function rawCtx(
  change: Partial<RawChangeContext['change']> = {},
  truncated: RawChangeContext['truncated'] = [],
): RawChangeContext {
  return {
    change: { files: [], commits: [], claims: [], provenance: [], ...change },
    checks: [],
    truncated,
    providers: [],
    redactions: [],
  };
}

/** Token_Estimate of the Budgeted_Text: sum of per-field estimates (D2, Req 7.1). */
function budgetedTokens(c: RawChangeContext): number {
  const ch = c.change;
  let sum = estimateTokens(ch.title ?? '') + estimateTokens(ch.description ?? '');
  for (const m of ch.commits) sum += estimateTokens(m.message);
  for (const k of ch.claims) sum += estimateTokens(k.text);
  for (const f of ch.files) {
    sum += estimateTokens(f.path) + estimateTokens(f.oldPath ?? '') + estimateTokens(f.patch);
  }
  return sum;
}

function fixedTokens(c: RawChangeContext): number {
  const ch = c.change;
  let sum = estimateTokens(ch.title ?? '') + estimateTokens(ch.description ?? '');
  for (const m of ch.commits) sum += estimateTokens(m.message);
  for (const k of ch.claims) sum += estimateTokens(k.text);
  return sum;
}

// --- generators (sizes kept small except for deliberate oversized texts) ---

const smallText = fc.string({ maxLength: 40 });
// Oversized text: a unit repeated, so a few hundred thousand chars cost little to generate.
const bigText = fc
  .tuple(fc.constantFrom('ab\n', 'word ', 'x', 'line of text\n'), fc.integer({ min: 6_000, max: 40_000 }))
  .map(([unit, n]) => unit.repeat(n));
const anyText = fc.oneof({ weight: 4, arbitrary: smallText }, { weight: 1, arbitrary: bigText });
const longLine = fc.integer({ min: 1, max: 250_000 }).map((n) => 'y'.repeat(n));

const dirs = ['src', 'test', 'dist', 'pages', 'app', 'api', 'docs', 'a'];
const names = ['x.ts', 'y.css', 'package-lock.json', 'z.test.ts', 'CHANGELOG.md', 'm.min.js', 'r.md'];
const pathArb = fc
  .tuple(fc.array(fc.constantFrom(...dirs), { maxLength: 3 }), fc.constantFrom(...names))
  .map(([d, n]) => [...d, n].join('/'));

const fileArb = (patch: fc.Arbitrary<string>): fc.Arbitrary<ChangedFile> =>
  fc
    .record({
      path: pathArb,
      oldPath: fc.option(pathArb, { nil: undefined }),
      status: fc.constantFrom('added', 'modified', 'deleted', 'renamed' as const),
      patch,
    })
    .map(({ oldPath, ...rest }) => ({
      ...rest,
      ...(oldPath === undefined ? {} : { oldPath }),
      provenance: prov,
    }));

const filesArb = (patch: fc.Arbitrary<string>, maxLength = 6): fc.Arbitrary<ChangedFile[]> =>
  fc.uniqueArray(fileArb(patch), {
    maxLength,
    selector: (f) => `${f.path}\u0000${f.oldPath ?? ''}`,
  });

const contextArb = (patch: fc.Arbitrary<string>): fc.Arbitrary<RawChangeContext> =>
  fc
    .record({
      title: fc.option(anyText, { nil: undefined }),
      description: fc.option(anyText, { nil: undefined }),
      commits: fc.array(anyText, { maxLength: 4 }),
      claims: fc.array(anyText, { maxLength: 4 }),
      files: filesArb(patch),
    })
    .map(({ title, description, commits, claims, files }) =>
      rawCtx({
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        commits: commits.map((message, i) => ({ sha: `sha${i}`, message, provenance: prov })),
        claims: claims.map((text) => ({ text, provenance: { provider: 'cli' as const } })),
        files,
      }),
    );

const runs = { numRuns: 100 };

describe('Feature: ce-context-resolver, Property 7: Budgeted text never exceeds the Context_Budget, and budgeting is deterministic', () => {
  // Validates: Requirements 7.1, 7.4, 7.5, 7.11, 11.4
  it('stays within the budget for generated contexts with oversized fields and patches', () => {
    fc.assert(
      fc.property(contextArb(anyText), (c) => {
        const out = budget(c).context;
        expect(budgetedTokens(out)).toBeLessThanOrEqual(CONTEXT_BUDGET_TOKENS);
      }),
      runs,
    );
  });

  it('stays within the budget with a single very long line in a patch', () => {
    fc.assert(
      fc.property(contextArb(longLine), (c) => {
        const out = budget(c).context;
        expect(budgetedTokens(out)).toBeLessThanOrEqual(CONTEXT_BUDGET_TOKENS);
      }),
      runs,
    );
  });

  it('is deterministic, also when the files are supplied in another order', () => {
    fc.assert(
      fc.property(
        contextArb(anyText),
        fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
        (c, keys) => {
          const first = budget(c);
          expect(budget(c)).toEqual(first);
          const shuffled = c.change.files
            .map((f, i) => ({ f, k: keys[i] ?? 0, i }))
            .sort((a, b) => a.k - b.k || a.i - b.i)
            .map((x) => x.f);
          const second = budget({ ...c, change: { ...c.change, files: shuffled } });
          expect(second).toEqual(first);
        },
      ),
      runs,
    );
  });

  it('fits when the title alone exceeds the budget', () => {
    const title = 'T'.repeat(CONTEXT_BUDGET_TOKENS * 3 * 2);
    const c = rawCtx({
      title,
      claims: [{ text: 'c'.repeat(100_000), provenance: prov }],
      files: [{ path: 'src/x.ts', status: 'modified', patch: '+a\n', provenance: prov }],
    });
    const out = budget(c).context;
    expect(budgetedTokens(out)).toBeLessThanOrEqual(CONTEXT_BUDGET_TOKENS);
    expect(out.change.title).toBeDefined();
    expect(estimateTokens(out.change.title ?? '')).toBeLessThanOrEqual(CONTEXT_BUDGET_TOKENS);
  });

  it('fits when one patch is a single line far over the budget', () => {
    const c = rawCtx({
      files: [{ path: 'src/x.ts', status: 'modified', patch: 'z'.repeat(500_000), provenance: prov }],
    });
    const out = budget(c);
    expect(budgetedTokens(out.context)).toBeLessThanOrEqual(CONTEXT_BUDGET_TOKENS);
    expect(out.context.change.files.map((f) => f.path)).toEqual(['src/x.ts']);
  });
});

describe('Feature: ce-context-resolver, Property 8: A file that fits phase 1 stays in change.files', () => {
  // Validates: Requirements 7.6, 7.9, 11.4, 11.16
  it('keeps every file whose path and oldPath fit, whether or not its patch fits', () => {
    fc.assert(
      fc.property(contextArb(anyText), (c) => {
        const out = budget(c).context;
        const remaining = CONTEXT_BUDGET_TOKENS - fixedTokens(out);
        const pathCost = (f: ChangedFile): number =>
          estimateTokens(f.path) + estimateTokens(f.oldPath ?? '');
        const total = c.change.files.reduce((s, f) => s + pathCost(f), 0);
        // All paths fit together in phase 1, so none may be dropped.
        if (total <= remaining) {
          const kept = new Set(out.change.files.map((f) => `${f.path}\u0000${f.oldPath ?? ''}`));
          for (const f of c.change.files) {
            expect(kept.has(`${f.path}\u0000${f.oldPath ?? ''}`)).toBe(true);
          }
        }
        // Every input file is either kept or recorded as dropped.
        const dropped = budget(c).truncated.filter((t) => t.reason === 'dropped' && !t.file.includes(':') && !t.file.startsWith('<'));
        expect(out.change.files.length + dropped.filter((d) => c.change.files.some((f) => f.path === d.file)).length)
          .toBeGreaterThanOrEqual(c.change.files.length);
      }),
      runs,
    );
  });

  it('keeps a file with a path-only fit even when its patch is dropped', () => {
    fc.assert(
      fc.property(filesArb(longLine, 5), (files) => {
        // A fixed field consumes nearly all of the budget, leaving room for paths only.
        const pathsTotal = files.reduce(
          (s, f) => s + estimateTokens(f.path) + estimateTokens(f.oldPath ?? ''),
          0,
        );
        const description = 'd'.repeat((CONTEXT_BUDGET_TOKENS - pathsTotal) * 3);
        const c = rawCtx({ description, files });
        const out = budget(c).context;
        expect(budgetedTokens(out)).toBeLessThanOrEqual(CONTEXT_BUDGET_TOKENS);
        expect(out.change.files.map((f) => f.path).sort()).toEqual(files.map((f) => f.path).sort());
      }),
      runs,
    );
  });
});
