import { EventEmitter } from 'node:events';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyStatus, openTarget, TargetConfigError } from './target.js';
import type { TargetOptions } from './target.js';

// ---------------------------------------------------------------------------
// Reusable fake-child helpers (Start_Mode tests)
// ---------------------------------------------------------------------------

type FakeSpawn = NonNullable<TargetOptions['spawn']>;

/** EventEmitter-based stand-in for a ChildProcess with stdout/stderr emitters and a controllable exit. */
class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly pid: number;

  constructor(pid = 5151) {
    super();
    this.pid = pid;
  }

  /** Emits `exit` and ends both output streams. */
  exit(code: number | null = 1, signal: string | null = null): void {
    this.stdout.emit('end');
    this.stderr.emit('end');
    this.emit('exit', code, signal);
  }
}

/**
 * Fake `spawn` that records calls and returns a FakeChildProcess. The child exits on its own
 * right after the caller had the chance to attach listeners (`exitImmediately`), so that
 * `openTarget` settles with a TargetStartError.
 */
function makeFakeChildSpawn(exitImmediately = true): {
  spawn: FakeSpawn;
  calls: unknown[][];
  children: FakeChildProcess[];
} {
  const calls: unknown[][] = [];
  const children: FakeChildProcess[] = [];
  const spawn = ((...args: unknown[]) => {
    calls.push(args);
    const child = new FakeChildProcess();
    children.push(child);
    if (exitImmediately) setImmediate(() => child.exit(1, null));
    return child;
  }) as unknown as FakeSpawn;
  return { spawn, calls, children };
}

type PreProbeOutcome =
  | { kind: 'response'; status: number }
  | { kind: 'failure'; code: 'ECONNREFUSED' | 'ENOTFOUND' | 'OTHER' | 'ABORT' };

/** Fake `fetch`: first call returns `pre`; every later call answers 503 (never ready). */
function makeFakeFetch(pre: PreProbeOutcome): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fakeFetch = (async (input: unknown) => {
    calls.push(String(input));
    if (calls.length > 1) return { status: 503, body: null } as unknown as Response;
    if (pre.kind === 'response') return { status: pre.status, body: null } as unknown as Response;
    if (pre.code === 'ABORT') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (pre.code === 'OTHER') throw new Error('socket hang up');
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: pre.code } });
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, calls };
}

/** Fake clock: `sleep(ms)` advances `now()` and resolves immediately. */
function makeFakeClock(startMs = 1_000_000): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let current = startMs;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

/** Fake `process` that accepts listeners and records `kill` calls. */
function makeFakeProcess(): { process: NodeJS.Process; kills: unknown[][] } {
  const kills: unknown[][] = [];
  const emitter = new EventEmitter();
  const fake = Object.assign(emitter, {
    pid: 4242,
    kill: (...args: unknown[]) => {
      kills.push(args);
      return true;
    },
  });
  return { process: fake as unknown as NodeJS.Process, kills };
}

// ---------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------

const preProbeOutcomeArb: fc.Arbitrary<PreProbeOutcome> = fc.oneof(
  fc.integer({ min: 100, max: 599 }).map((status): PreProbeOutcome => ({ kind: 'response', status })),
  fc
    .constantFrom<'ECONNREFUSED' | 'ENOTFOUND' | 'OTHER' | 'ABORT'>('ECONNREFUSED', 'ENOTFOUND', 'OTHER', 'ABORT')
    .map((code): PreProbeOutcome => ({ kind: 'failure', code })),
);

describe('Start_Mode Pre_Start_Probe', () => {
  // Feature: runtime-target, Property 8: The Pre_Start_Probe decides spawn-or-reject from its outcome alone
  // **Validates: Requirements 2.11**
  it('rejects without spawning iff the Pre_Start_Probe classifies ready; otherwise spawns exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(preProbeOutcomeArb, async (pre) => {
        const { spawn, calls: spawnCalls } = makeFakeChildSpawn(true);
        const { fetch, calls: fetchCalls } = makeFakeFetch(pre);
        const clock = makeFakeClock();
        const { process: fakeProcess } = makeFakeProcess();

        const run = openTarget({
          url: 'http://127.0.0.1:4173',
          start: 'npm run dev',
          ready: { timeout: '1s' },
          cwd: '/tmp',
          env: {},
          fetch,
          spawn,
          now: clock.now,
          sleep: clock.sleep,
          process: fakeProcess,
        });

        const expectReady = pre.kind === 'response' && classifyStatus(pre.status) === 'ready';
        let thrown: unknown;
        try {
          await run;
        } catch (error) {
          thrown = error;
        }

        expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
        if (expectReady) {
          expect(thrown).toBeInstanceOf(TargetConfigError);
          expect((thrown as Error).message).toContain('target.url is already served before start');
          expect(spawnCalls).toHaveLength(0);
        } else {
          expect(spawnCalls).toHaveLength(1);
          // The child exits immediately, so openTarget settles with a start error (never a config error).
          expect(thrown).toBeDefined();
          expect(thrown).not.toBeInstanceOf(TargetConfigError);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

type ReadinessStep =
  | { kind: 'response'; status: number }
  | { kind: 'failure'; code: 'ECONNREFUSED' | 'ENOTFOUND' | 'OTHER' };

const notReadyStepArb: fc.Arbitrary<ReadinessStep> = fc.oneof(
  fc
    .oneof(fc.integer({ min: 100, max: 199 }), fc.integer({ min: 400, max: 599 }))
    .map((status): ReadinessStep => ({ kind: 'response', status })),
  fc
    .constantFrom<'ECONNREFUSED' | 'ENOTFOUND' | 'OTHER'>('ECONNREFUSED', 'ENOTFOUND', 'OTHER')
    .map((code): ReadinessStep => ({ kind: 'failure', code })),
);

describe('Start_Mode spawn ordering', () => {
  // Feature: runtime-target, Property 9: Spawn happens before the first Readiness_Probe in Start_Mode
  // **Validates: Requirements 2.2**
  it('records spawn after fetch call #1 (Pre_Start_Probe) and before every later fetch call', async () => {
    await fc.assert(
      fc.asyncProperty(
        notReadyStepArb, // Pre_Start_Probe outcome (never ready, so spawn happens)
        fc.array(notReadyStepArb, { minLength: 0, maxLength: 8 }), // scripted not-ready probes
        fc.boolean(), // whether the process ever becomes ready
        fc.integer({ min: 200, max: 399 }), // status once ready
        async (pre, notReady, becomesReady, readyStatus) => {
          const events: string[] = [];
          const clock = makeFakeClock();
          const { process: fakeProcess } = makeFakeProcess();

          const child = new FakeChildProcess();
          const spawn = ((..._args: unknown[]) => {
            events.push('spawn');
            return child;
          }) as unknown as FakeSpawn;

          const script: ReadinessStep[] = [
            ...notReady,
            ...(becomesReady ? [{ kind: 'response', status: readyStatus } as ReadinessStep] : []),
          ];
          let fetchCount = 0;
          const fakeFetch = (async () => {
            fetchCount += 1;
            events.push('fetch');
            const step = fetchCount === 1 ? pre : (script[fetchCount - 2] ?? { kind: 'response', status: 503 });
            if (step.kind === 'response') return { status: step.status, body: null } as unknown as Response;
            if (step.code === 'OTHER') throw new Error('socket hang up');
            throw Object.assign(new TypeError('fetch failed'), { cause: { code: step.code } });
          }) as unknown as typeof fetch;

          let handle: Awaited<ReturnType<typeof openTarget>> | undefined;
          try {
            handle = await openTarget({
              url: 'http://127.0.0.1:4173',
              start: 'npm run dev',
              ready: { timeout: '2s' },
              cwd: '/tmp',
              env: {},
              fetch: fakeFetch,
              spawn,
              now: clock.now,
              sleep: clock.sleep,
              process: fakeProcess,
            });
          } catch {
            // Timeout without readiness is an expected outcome of this property.
          } finally {
            await handle?.stop();
          }

          // Pre_Start_Probe first, then spawn exactly once, then only readiness probes.
          expect(events[0]).toBe('fetch');
          expect(events.filter((e) => e === 'spawn')).toHaveLength(1);
          expect(events[1]).toBe('spawn');
          expect(events.slice(2).every((e) => e === 'fetch')).toBe(true);
          expect(events.indexOf('spawn')).toBeLessThan(events.lastIndexOf('fetch'));
        },
      ),
      { numRuns: 100 },
    );
  });
});
