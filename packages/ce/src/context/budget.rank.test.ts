import { describe, expect, it } from 'vitest';
import { budget, CONTEXT_BUDGET_TOKENS, estimateTokens } from './budget.js';
import type { ChangedFile, RawChangeContext } from './types.js';

const prov = { provider: 'git' } as const;

function file(path: string, patch = '', status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { path, status, patch, provenance: prov };
}

function ctx(files: ChangedFile[]): RawChangeContext {
  return {
    change: { files, commits: [], claims: [], provenance: [] },
    checks: [],
    truncated: [],
    providers: [],
    redactions: [],
  };
}

const bigPatch = (lines: number): string =>
  Array.from({ length: lines }, (_, i) => `+line ${i} of the patch`).join('\n') + '\n';

describe('budget ranking and phases', () => {
  it('keeps later paths in change.files when an earlier patch uses the whole budget (7.6, 11.16)', () => {
    const huge = bigPatch(20_000);
    expect(estimateTokens(huge)).toBeGreaterThan(CONTEXT_BUDGET_TOKENS);
    const input = ctx([file('src/a.ts', huge), file('src/b.ts', 'x\n'), file('src/c.ts', 'y\n')]);
    const { context, truncated } = budget(input);

    expect(context.change.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(context.change.files[0]!.patch.length).toBeGreaterThan(0);
    expect(context.change.files[0]!.patch.length).toBeLessThan(huge.length);
    expect(context.change.files[1]!.patch).toBe('');
    expect(context.change.files[2]!.patch).toBe('');
    expect(truncated).toEqual([
      { file: 'src/a.ts', reason: 'truncated' },
      { file: 'src/b.ts', reason: 'dropped' },
      { file: 'src/c.ts', reason: 'dropped' },
    ]);
  });

  it('ranks a deleted file after a modified one (7.2)', () => {
    const { context } = budget(
      ctx([file('a/gone.ts', '', 'deleted'), file('z/kept.ts', '', 'modified')]),
    );
    expect(context.change.files.map((f) => f.path)).toEqual(['z/kept.ts', 'a/gone.ts']);
  });

  it('ranks README.md with other files and CHANGELOG.md as Low_Priority (7.2, 7.7)', () => {
    const { context } = budget(
      ctx([file('CHANGELOG.md'), file('README.md'), file('docs/guide.md'), file('src/index.ts')]),
    );
    // README.md is "other": ordered by path byte order among the others.
    expect(context.change.files.map((f) => f.path)).toEqual([
      'README.md',
      'docs/guide.md',
      'src/index.ts',
      'CHANGELOG.md',
    ]);
  });

  it('ranks a user-facing file before a test file before other files (7.2, 7.12)', () => {
    const { context } = budget(
      ctx([file('lib/a.ts'), file('tests/a.ts'), file('components/a.tsx')]),
    );
    expect(context.change.files.map((f) => f.path)).toEqual([
      'components/a.tsx',
      'tests/a.ts',
      'lib/a.ts',
    ]);
  });

  it('produces no truncation records when everything fits (7.12)', () => {
    const input = ctx([file('src/a.ts', '+a\n'), file('src/b.ts', '+b\n')]);
    const { context, truncated } = budget(input);
    expect(truncated).toEqual([]);
    expect(context.change.files.map((f) => f.patch)).toEqual(['+a\n', '+b\n']);
  });
});
