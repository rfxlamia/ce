import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { selectBaseRef, selectHeadRef } from './resolve.js';

const ZERO = '0'.repeat(40);
const sha = fc.stringMatching(/^[0-9a-f]{40}$/).filter((s) => s !== ZERO);
const refName = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
const opt = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });

describe('Feature: ce-context-resolver, Property 3', () => {
  it('Base_Ref selection follows priority order', () => {
    fc.assert(
      fc.property(
        opt(refName),
        opt(fc.record({ sha: opt(sha), ref: opt(refName) })),
        opt(fc.oneof(sha, fc.constant(ZERO))),
        fc.boolean(),
        opt(refName),
        (cli, pr, before, beforeExists, cfg) => {
          const r = selectBaseRef({
            cliBase: cli ? { ref: cli, provenance: { provider: 'cli', location: '--base' } } : undefined,
            githubPrBase: pr,
            githubPushBefore: before,
            configBase: cfg,
            commitExists: () => beforeExists,
          });
          if (cli) {
            expect(r.ref).toBe(cli);
            expect(r.provenance).toEqual({ provider: 'cli', location: '--base' });
          } else if (pr?.sha) {
            expect(r.ref).toBe(pr.sha);
            expect(r.provenance.location).toBe('pull_request.base.sha');
          } else if (pr?.ref) {
            expect(r.ref).toBe(`origin/${pr.ref}`);
            expect(r.provenance.location).toBe('pull_request.base.ref');
          } else if (before && before !== ZERO && beforeExists) {
            expect(r.ref).toBe(before);
            expect(r.provenance).toEqual({ provider: 'github', location: 'push.before' });
          } else if (cfg) {
            expect(r.ref).toBe(cfg);
            expect(r.provenance).toEqual({ provider: 'config', location: 'context.base' });
          } else {
            expect(r.ref).toBe('origin/main');
            expect(r.provenance.location).toBe('default:origin/main');
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Head_Commit uses pull_request.head.sha only when it exists, else HEAD', () => {
    fc.assert(
      fc.property(opt(sha), fc.boolean(), (head, exists) => {
        const r = selectHeadRef({ githubHeadSha: head, commitExists: () => exists });
        if (head && exists) {
          expect(r).toEqual({
            ref: head,
            provenance: { provider: 'github', location: 'pull_request.head.sha' },
            headMissing: false,
          });
        } else {
          expect(r.ref).toBe('HEAD');
          expect(r.provenance).toEqual({ provider: 'git', location: 'HEAD' });
          expect(r.headMissing).toBe(Boolean(head));
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('ref selection examples', () => {
  const yes = () => true;
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  it('--base wins over everything', () => {
    const r = selectBaseRef({
      cliBase: { ref: 'dev', provenance: { provider: 'cli', location: '--base' } },
      githubPrBase: { sha: A },
      configBase: 'x',
      commitExists: yes,
    });
    expect(r).toEqual({ ref: 'dev', provenance: { provider: 'cli', location: '--base' } });
  });

  it('GitHub PR base sha beats ref, then ref maps to origin/<ref>', () => {
    expect(selectBaseRef({ githubPrBase: { sha: A, ref: 'main' }, commitExists: yes }).ref).toBe(A);
    const r = selectBaseRef({ githubPrBase: { ref: 'main' }, commitExists: yes });
    expect(r).toEqual({
      ref: 'origin/main',
      provenance: { provider: 'github', location: 'pull_request.base.ref' },
    });
  });

  it('push before is used when it exists', () => {
    const r = selectBaseRef({ githubPushBefore: A, configBase: 'x', commitExists: yes });
    expect(r).toEqual({ ref: A, provenance: { provider: 'github', location: 'push.before' } });
  });

  it('all-zeros or unresolvable push before falls through to config', () => {
    for (const [before, exists] of [[ZERO, true], [B, false]] as const) {
      const r = selectBaseRef({ githubPushBefore: before, configBase: 'rel', commitExists: () => exists });
      expect(r).toEqual({ ref: 'rel', provenance: { provider: 'config', location: 'context.base' } });
    }
  });

  it('falls back to origin/main by default', () => {
    expect(selectBaseRef({ commitExists: yes })).toEqual({
      ref: 'origin/main',
      provenance: { provider: 'config', location: 'default:origin/main' },
    });
  });

  it('head: existing sha, missing sha, and absent', () => {
    expect(selectHeadRef({ githubHeadSha: A, commitExists: yes }).ref).toBe(A);
    expect(selectHeadRef({ githubHeadSha: A, commitExists: () => false })).toEqual({
      ref: 'HEAD',
      provenance: { provider: 'git', location: 'HEAD' },
      headMissing: true,
    });
    expect(selectHeadRef({ commitExists: yes }).headMissing).toBe(false);
  });
});
