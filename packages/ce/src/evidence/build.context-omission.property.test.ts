import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ChangeContext } from '../context/types.js';
import { buildRunRecord } from './build.js';
import { buildRunRecordInputArb, changeContextArb } from './arbitraries.js';

/** Gives every file a non-empty, unique patch and every commit a unique message. */
function withMarkers(c: ChangeContext): { ctx: ChangeContext; markers: string[] } {
  const markers: string[] = [];
  const files = c.change.files.map((f, i) => {
    const patch = `@@PATCH-MARKER-${i}-${f.path.length}@@`;
    markers.push(patch);
    return { ...f, patch };
  });
  const commits = c.change.commits.map((x, i) => {
    const message = `@@MESSAGE-MARKER-${i}-${x.sha.length}@@`;
    markers.push(message);
    return { ...x, message };
  });
  return { ctx: { ...c, change: { ...c.change, files, commits } }, markers };
}

/** What Requirement 2.17 says the record must hold: everything except patch and commit messages. */
function expectedContext(c: ChangeContext): unknown {
  const { files, commits, ...rest } = c.change;
  return {
    ...c,
    change: {
      ...rest,
      files: files.map(({ patch: _patch, ...f }) => f),
      commits: commits.length,
    },
  };
}

const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe('buildRunRecord context omission', () => {
  // Feature: evidence-bundle, Property 14: Context record omits patch text and commit messages but keeps every other member
  // **Validates: Requirements 2.5, 2.17**
  it('Feature: evidence-bundle, Property 14: Context record omits patch text and commit messages but keeps every other member', () => {
    fc.assert(
      fc.property(buildRunRecordInputArb, changeContextArb, (base, rawCtx) => {
        const { ctx, markers } = withMarkers(rawCtx);
        const record = buildRunRecord({ ...base, context: ctx });

        expect(record.context).not.toBeNull();
        const serialized = JSON.stringify(record.context);
        for (const m of markers) expect(serialized).not.toContain(m);

        const built = json(record.context) as ChangeContext & Record<string, unknown>;
        for (const f of (built.change as unknown as { files: Record<string, unknown>[] }).files) {
          expect(f).not.toHaveProperty('patch');
        }
        expect(typeof (built.change as unknown as { commits: unknown }).commits).toBe('number');

        expect(built).toEqual(json(expectedContext(ctx)));
      }),
      { numRuns: 200 },
    );
  });
});
