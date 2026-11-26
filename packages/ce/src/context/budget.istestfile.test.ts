import { describe, expect, it } from 'vitest';
import { budget, isTestFile } from './budget.js';
import type { ChangedFile, RawChangeContext } from './types.js';

const prov = { provider: 'git' } as const;

function file(path: string): ChangedFile {
  return { path, status: 'modified', patch: '', provenance: prov };
}

// rankOf is private. Its test rank is observed through the order budget()
// returns: user-facing (0) < test (1) < other (2). The sentinels bracket rank 1:
// 'z.css' is user-facing and sorts last by path, '!.txt' is "other" and sorts
// first by path. A path lands between them only when its rank is the test rank.
const USER_FACING_SENTINEL = 'z.css';
const OTHER_SENTINEL = '!.txt';

function hasTestRank(path: string): boolean {
  const input: RawChangeContext = {
    change: {
      files: [file(OTHER_SENTINEL), file(path), file(USER_FACING_SENTINEL)],
      commits: [],
      claims: [],
      provenance: [],
    },
    checks: [],
    truncated: [],
    providers: [],
    redactions: [],
  };
  const order = budget(input).context.change.files.map((f) => f.path);
  expect(order).toHaveLength(3);
  const i = order.indexOf(path);
  return i > order.indexOf(USER_FACING_SENTINEL) && i < order.indexOf(OTHER_SENTINEL);
}

describe('isTestFile agrees with rankOf', () => {
  const cases: Array<[string, boolean]> = [
    ['tests/a.ts', true],
    ['src/__tests__/b.ts', true],
    ['e2e/c.ts', true],
    ['x.test.ts', true],
    ['x.spec.ts', true],
    ['src/app.ts', false],
  ];

  it.each(cases)('%s: isTestFile is %s', (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });

  it.each(cases)('%s: test rank exactly when isTestFile', (path) => {
    expect(hasTestRank(path)).toBe(isTestFile(path));
  });
});
