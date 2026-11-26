// Feature: ce-context-resolver, Property 4: Provider status reason is always
// a fixed code, never raw text.
// **Validates: Requirements 3.11, 11.6**

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ReasonCode } from '../types.js';
import { resolveGit, type GitExecResult } from './git.js';
import { resolveGithubEvent } from './github-event.js';
import { resolveJunit } from './junit.js';

const REASON_CODES: readonly ReasonCode[] = [
  'not-a-repository',
  'base-unresolved',
  'merge-base-missing',
  'git-failed',
  'head-missing',
  'source-absent',
  'source-unreadable',
  'source-malformed',
  'no-input',
  'not-configured',
];

const MARKER = 'ZQ\u0001';
const generated = fc.string({ minLength: 0, maxLength: 80 }).map((s) => MARKER + s);

function checkStatus(status: { reason?: ReasonCode }, text: string): void {
  if (status.reason === undefined) return;
  expect(REASON_CODES).toContain(status.reason);
  expect(status.reason).not.toContain(MARKER);
  if (text.length > MARKER.length) expect(status.reason).not.toContain(text);
  expect(JSON.stringify(status)).not.toContain(MARKER);
}

const SHA = 'a'.repeat(40);
const FAIL_STAGES = [
  'inside',
  'base',
  'head',
  'merge-base',
  'stage1',
  'stage1-garbage',
  'stage2',
  'log',
] as const;
type FailStage = (typeof FAIL_STAGES)[number];

function makeExec(stage: FailStage, text: string, asError: boolean) {
  // Non-error failures: empty stdout with generated stderr. Only the
  // rev-parse/merge-base stages treat empty stdout as a failure.
  const emptyStdoutFails = ['inside', 'base', 'head', 'merge-base'].includes(stage);
  const fail = (): GitExecResult =>
    asError || !emptyStdoutFails
      ? { error: Object.assign(new Error(text), { code: text }) as NodeJS.ErrnoException }
      : { stdout: '', stderr: text };
  return (args: string[]): GitExecResult => {
    const has = (w: string): boolean => args.includes(w);
    if (has('--is-inside-work-tree')) return stage === 'inside' ? fail() : { stdout: 'true\n', stderr: '' };
    if (has('--verify')) {
      const isBase = args.some((a) => a.startsWith('origin/main'));
      if (stage === 'base' && isBase) return fail();
      if (stage === 'head' && !isBase) return fail();
      return { stdout: `${SHA}\n`, stderr: '' };
    }
    if (has('merge-base')) return stage === 'merge-base' ? fail() : { stdout: `${SHA}\n`, stderr: '' };
    if (has('--name-status')) {
      if (stage === 'stage1') return fail();
      if (stage === 'stage1-garbage') return { stdout: `\0${text}`, stderr: text };
      return { stdout: 'M\0src/a.ts\0', stderr: '' };
    }
    if (has('-p')) return stage === 'stage2' ? fail() : { stdout: '', stderr: '' };
    if (has('log')) return stage === 'log' ? fail() : { stdout: '', stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

describe('Feature: ce-context-resolver, Property 4', () => {
  it('git: reason is a fixed code on every failure path', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FAIL_STAGES),
        generated,
        fc.boolean(),
        (stage, text, asError) => {
          const result = resolveGit({
            cwd: '/repo',
            baseRef: { ref: 'origin/main', provenance: { provider: 'git' } },
            exec: makeExec(stage, text, asError),
          });
          expect(result.status.status).toBe('unavailable');
          expect(result.status.reason).toBeDefined();
          checkStatus(result.status, text);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('git: missing base ref and thrown-free garbage keep fixed codes', () => {
    fc.assert(
      fc.property(generated, (text) => {
        const noBase = resolveGit({
          cwd: '/repo',
          exec: () => ({ stdout: 'true\n', stderr: text }),
        });
        expect(noBase.status.reason).toBe('base-unresolved');
        const notRepo = resolveGit({
          cwd: '/repo',
          exec: () => ({ stdout: text, stderr: text }),
        });
        expect(notRepo.status.reason).toBe('not-a-repository');
        checkStatus(noBase.status, text);
        checkStatus(notRepo.status, text);
      }),
      { numRuns: 100 },
    );
  });

  it('github-event: reason is a fixed code for any payload, path or read error', () => {
    fc.assert(
      fc.property(
        generated,
        fc.constantFrom('content', 'throw', 'undefined', 'json-scalar', 'json-wrong-shape', 'no-path'),
        (text, mode) => {
          const eventPath = mode === 'no-path' ? undefined : `/ev/${text}.json`;
          const readFile = (): string | undefined => {
            switch (mode) {
              case 'throw':
                throw new Error(text);
              case 'undefined':
                return undefined;
              case 'json-scalar':
                return JSON.stringify(text);
              case 'json-wrong-shape':
                return JSON.stringify({ [text]: text, pull_request: text });
              default:
                return text;
            }
          };
          const result = resolveGithubEvent({ eventPath, readFile });
          if (result.status.status === 'unavailable') {
            expect(result.status.reason).toBeDefined();
            checkStatus(result.status, text);
          } else {
            expect(result.status.reason).toBeUndefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('junit: reason is a fixed code for any pattern, file content or IO error', () => {
    fc.assert(
      fc.property(
        generated,
        fc.constantFrom('content', 'read-throw', 'text-throw', 'missing', 'symlink', 'oversize', 'glob'),
        (text, mode) => {
          const pattern = mode === 'glob' ? 'reports/*.xml' : 'reports/r.xml';
          const rel = 'reports/r.xml';
          const result = resolveJunit({
            cwd: '/proj',
            checksPattern: pattern,
            listFiles: () => ['/proj/' + rel],
            lstat: () => ({ isSymbolicLink: () => mode === 'symlink' }),
            readFile: () => {
              if (mode === 'missing') return undefined;
              if (mode === 'read-throw') throw new Error(text);
              return {
                size: mode === 'oversize' ? 20_000_000 : text.length,
                text: () => {
                  if (mode === 'text-throw') throw new Error(text);
                  return text;
                },
              };
            },
          });
          if (result.status.status === 'unavailable') {
            expect(result.status.reason).toBeDefined();
            checkStatus(result.status, text);
          }
          expect(JSON.stringify(result.status)).not.toContain(MARKER);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('junit: generated pattern text never reaches reason', () => {
    fc.assert(
      fc.property(generated, (text) => {
        const result = resolveJunit({
          cwd: '/proj',
          checksPattern: text,
          listFiles: () => [],
          lstat: () => undefined,
          readFile: () => undefined,
        });
        expect(result.status.status).toBe('unavailable');
        checkStatus(result.status, text);
      }),
      { numRuns: 100 },
    );
  });
});
