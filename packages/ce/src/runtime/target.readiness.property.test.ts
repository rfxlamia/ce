import { EventEmitter } from 'node:events';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openTarget, TargetUnreachableError } from './target.js';
import type { TargetOptions } from './target.js';

// ---------------------------------------------------------------------------
// Reusable helpers (not exported; later tasks append their properties to this file)
// ---------------------------------------------------------------------------

type ScriptedFetchOutcome =
  | { kind: 'response'; status: number }
  | { kind: 'failure'; code: 'ECONNREFUSED' | 'ENOTFOUND' | 'EAI_AGAIN' | 'OTHER' | 'ABORT' };

/**
 * Fake `fetch` that consumes `outcomes` call by call. After the script is exhausted every
 * further call fails with ECONNREFUSED. `calls` records the requested URLs.
 */
function makeScriptedFetch(outcomes: readonly ScriptedFetchOutcome[]): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  let index = 0;
  const fakeFetch = (async (input: unknown) => {
    calls.push(String(input));
    const outcome: ScriptedFetchOutcome = outcomes[index] ?? { kind: 'failure', code: 'ECONNREFUSED' };
    index += 1;
    if (outcome.kind === 'response') {
      return { status: outcome.status, body: null } as unknown as Response;
    }
    switch (outcome.code) {
      case 'ABORT':
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      case 'OTHER':
        throw new Error('socket hang up');
      default:
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: outcome.code } });
    }
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, calls };
}

/** Fake clock: `sleep(ms)` advances `now()` by `ms` and resolves immediately. */
function makeFakeClock(startMs = 1_000_000): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  let current = startMs;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
}

/** Fake `spawn` that records every call and never produces a process. */
function makeRecordingSpawn(): { spawn: NonNullable<TargetOptions['spawn']>; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const spawn = ((...args: unknown[]) => {
    calls.push(args);
    throw new Error('spawn must not be called');
  }) as unknown as NonNullable<TargetOptions['spawn']>;
  return { spawn, calls };
}

/** Fake `process` that records `kill` and `emit` (signal-sending) calls and accepts listeners. */
function makeRecordingProcess(): { process: NodeJS.Process; signalCalls: unknown[][] } {
  const signalCalls: unknown[][] = [];
  const noop = (): unknown => fakeProcess;
  const fakeProcess = {
    pid: 4242,
    kill: (...args: unknown[]) => {
      if (args[1] === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      signalCalls.push(['kill', ...args]);
      return true;
    },
    emit: (...args: unknown[]) => {
      signalCalls.push(['emit', ...args]);
      return true;
    },
    on: noop,
    once: noop,
    off: noop,
    addListener: noop,
    removeListener: noop,
  };
  return { process: fakeProcess as unknown as NodeJS.Process, signalCalls };
}

const probeOutcomeArb: fc.Arbitrary<ScriptedFetchOutcome> = fc.oneof(
  fc.integer({ min: 100, max: 599 }).map((status): ScriptedFetchOutcome => ({ kind: 'response', status })),
  fc
    .constantFrom('ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'OTHER', 'ABORT' as const)
    .map((code): ScriptedFetchOutcome => ({ kind: 'failure', code })),
);

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Attach_Mode never spawns or signals (Property 1)', () => {
  // Feature: runtime-target, Property 1: Attach_Mode never spawns or signals a process
  // **Validates: Requirements 1.1, 1.4, 1.5**
  it('Property 1: openTarget with url and no start never calls spawn, and stop() never calls spawn or signals the process', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('http://localhost:3000', 'http://127.0.0.1:8080/app', 'https://example.test/base/'),
        fc.constantFrom('/', '/health', 'ready'),
        fc.constantFrom('1s', '2s', '30s'),
        fc.array(probeOutcomeArb, { maxLength: 12 }),
        fc.boolean(),
        fc.boolean(),
        async (url, path, timeout, script, endWithReady, stopOnSignals) => {
          const outcomes: ScriptedFetchOutcome[] = endWithReady
            ? [...script, { kind: 'response', status: 200 }]
            : script;
          const { fetch: fakeFetch } = makeScriptedFetch(outcomes);
          const clock = makeFakeClock();
          const spawnFake = makeRecordingSpawn();
          const procFake = makeRecordingProcess();

          let handle;
          try {
            handle = await openTarget({
              url,
              ready: { path, timeout },
              cwd: '/tmp',
              env: {},
              stopOnSignals,
              fetch: fakeFetch,
              now: clock.now,
              sleep: clock.sleep,
              spawn: spawnFake.spawn,
              process: procFake.process,
            });
          } catch (error) {
            // Timing out is a legitimate result for an arbitrary script.
            expect(error).toBeInstanceOf(TargetUnreachableError);
          }

          expect(spawnFake.calls).toHaveLength(0);
          if (handle !== undefined) {
            expect(handle.mode).toBe('attached');
            await handle.stop();
            await handle.stop();
          }
          expect(spawnFake.calls).toHaveLength(0);
          expect(procFake.signalCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 (Attach_Mode half; the Start_Mode half is added by task 5.2.5)
// ---------------------------------------------------------------------------

describe('Readiness resolution matches the first Ready_Status (Property 2, Attach_Mode)', () => {
  // Feature: runtime-target, Property 2: Readiness resolution matches the first Ready_Status, in both modes
  // **Validates: Requirements 1.2, 1.3, 2.2, 3.3, 3.4**
  const notReadyArb: fc.Arbitrary<ScriptedFetchOutcome> = fc.oneof(
    fc
      .oneof(fc.integer({ min: 100, max: 199 }), fc.integer({ min: 400, max: 599 }))
      .map((status): ScriptedFetchOutcome => ({ kind: 'response', status })),
    fc
      .constantFrom('ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'OTHER', 'ABORT' as const)
      .map((code): ScriptedFetchOutcome => ({ kind: 'failure', code })),
  );
  const readyArb: fc.Arbitrary<ScriptedFetchOutcome> = fc
    .integer({ min: 200, max: 399 })
    .map((status): ScriptedFetchOutcome => ({ kind: 'response', status }));

  it('Property 2: openTarget resolves with the first 200-399 status after exactly index+1 probes, sleeping only 250ms between probes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('http://localhost:3000', 'http://127.0.0.1:8080/app'),
        fc.constantFrom('/', '/health'),
        fc.array(notReadyArb, { maxLength: 15 }),
        readyArb,
        fc.array(probeOutcomeArb, { maxLength: 5 }),
        async (url, path, prefix, ready, suffix) => {
          const script = [...prefix, ready, ...suffix];
          const { fetch: fakeFetch, calls } = makeScriptedFetch(script);
          const clock = makeFakeClock();

          const handle = await openTarget({
            url,
            ready: { path, timeout: '60s' },
            cwd: '/tmp',
            env: {},
            fetch: fakeFetch,
            now: clock.now,
            sleep: clock.sleep,
          });

          expect(handle.mode).toBe('attached');
          expect(handle.lastStatus).toBe((ready as { status: number }).status);
          expect(calls).toHaveLength(prefix.length + 1);
          expect(clock.sleeps).toEqual(Array.from({ length: prefix.length }, () => 250));
          await handle.stop();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 (Attach_Mode half; the Start_Mode half is added by task 5.2.5)
// ---------------------------------------------------------------------------

describe('Exhausting the Ready_Timeout yields Target_Unreachable_Error (Property 3, Attach_Mode)', () => {
  // Feature: runtime-target, Property 3: Exhausting the Ready_Timeout resolves to Target_Unreachable_Error with the exact last outcome
  // **Validates: Requirements 3.4, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5**
  const neverReadyArb: fc.Arbitrary<ScriptedFetchOutcome> = fc.oneof(
    fc
      .oneof(fc.integer({ min: 100, max: 199 }), fc.integer({ min: 400, max: 599 }))
      .map((status): ScriptedFetchOutcome => ({ kind: 'response', status })),
    fc
      .constantFrom('ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'OTHER', 'ABORT' as const)
      .map((code): ScriptedFetchOutcome => ({ kind: 'failure', code })),
  );

  /** Table-derived lastStatus (design: Data Models) for one scripted outcome. */
  function expectedLastStatus(outcome: ScriptedFetchOutcome): number | string {
    if (outcome.kind === 'response') return outcome.status;
    switch (outcome.code) {
      case 'ECONNREFUSED':
        return 'connection-refused';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'dns';
      case 'ABORT':
        return 'timeout';
      default:
        return 'network';
    }
  }

  it('Property 3: throws TargetUnreachableError with the last probed outcome, the configured timeout and mode attached', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('http://localhost:3000', 'http://127.0.0.1:8080/app'),
        fc.constantFrom('/', '/health'),
        fc.constantFrom(
          { text: '1s', ms: 1000 },
          { text: '2s', ms: 2000 },
          { text: '5s', ms: 5000 },
        ),
        fc.array(neverReadyArb, { maxLength: 30 }),
        async (url, path, timeout, script) => {
          const { fetch: fakeFetch, calls } = makeScriptedFetch(script);
          const clock = makeFakeClock();

          let caught: unknown;
          try {
            await openTarget({
              url,
              ready: { path, timeout: timeout.text },
              cwd: '/tmp',
              env: {},
              fetch: fakeFetch,
              now: clock.now,
              sleep: clock.sleep,
            });
          } catch (error) {
            caught = error;
          }

          expect(caught).toBeInstanceOf(TargetUnreachableError);
          const err = caught as TargetUnreachableError;
          // The script is exhausted by ECONNREFUSED; derive from what was actually probed.
          const expected =
            calls.length === 0
              ? 'none'
              : expectedLastStatus(
                  script[calls.length - 1] ?? { kind: 'failure', code: 'ECONNREFUSED' },
                );
          expect(err.lastStatus).toBe(expected);
          expect(err.timeoutMs).toBe(timeout.ms);
          expect(err.mode).toBe('attached');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Start_Mode helpers (Properties 2 and 3, task 5.2.5)
// ---------------------------------------------------------------------------

/**
 * Fake started process: a child with pid, stdout/stderr emitters, and an injected `process`
 * whose `kill(-pid, sig)` makes the child exit (emitting 'exit' with the signal).
 */
function makeStartedFakes(childPid = 5151): {
  spawn: NonNullable<TargetOptions['spawn']>;
  process: NodeJS.Process;
  spawnCalls: unknown[][];
  killCalls: Array<[number, string | number | undefined]>;
  exits: Array<{ code: number | null; signal: string | null }>;
} {
  const spawnCalls: unknown[][] = [];
  const killCalls: Array<[number, string | number | undefined]> = [];
  const exits: Array<{ code: number | null; signal: string | null }> = [];
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.pid = childPid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const spawn = ((...args: unknown[]) => {
    spawnCalls.push(args);
    return child;
  }) as unknown as NonNullable<TargetOptions['spawn']>;

  const noop = (): unknown => fakeProcess;
  const fakeProcess = {
    pid: 4242,
    kill: (pid: number, sig?: string | number) => {
      if (sig === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      killCalls.push([pid, sig]);
      if (pid === -childPid && exits.length === 0) {
        exits.push({ code: null, signal: String(sig) });
        child.emit('exit', null, String(sig));
      }
      return true;
    },
    emit: () => true,
    on: noop,
    once: noop,
    off: noop,
    addListener: noop,
    removeListener: noop,
  };
  return { spawn, process: fakeProcess as unknown as NodeJS.Process, spawnCalls, killCalls, exits };
}

/** The pre-start probe consumes the first fetch call; it must be non-ready. */
const PRE_PROBE: ScriptedFetchOutcome = { kind: 'failure', code: 'ECONNREFUSED' };

// ---------------------------------------------------------------------------
// Property 2 (Start_Mode half)
// ---------------------------------------------------------------------------

describe('Readiness resolution matches the first Ready_Status (Property 2, Start_Mode)', () => {
  // Feature: runtime-target, Property 2 (Start_Mode): Readiness resolution matches the first Ready_Status, in both modes
  // **Validates: Requirements 2.2, 4.5**
  const notReadyArb: fc.Arbitrary<ScriptedFetchOutcome> = fc.oneof(
    fc
      .oneof(fc.integer({ min: 100, max: 199 }), fc.integer({ min: 400, max: 599 }))
      .map((status): ScriptedFetchOutcome => ({ kind: 'response', status })),
    fc
      .constantFrom('ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'OTHER', 'ABORT' as const)
      .map((code): ScriptedFetchOutcome => ({ kind: 'failure', code })),
  );
  const readyArb: fc.Arbitrary<ScriptedFetchOutcome> = fc
    .integer({ min: 200, max: 399 })
    .map((status): ScriptedFetchOutcome => ({ kind: 'response', status }));

  it('Property 2 (Start_Mode): resolves with the first 200-399 status after the spawn, mode started', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('http://localhost:3000', 'http://127.0.0.1:8080/app'),
        fc.constantFrom('/', '/health'),
        fc.array(notReadyArb, { maxLength: 15 }),
        readyArb,
        fc.array(probeOutcomeArb, { maxLength: 5 }),
        async (url, path, prefix, ready, suffix) => {
          const script = [PRE_PROBE, ...prefix, ready, ...suffix];
          const { fetch: fakeFetch, calls } = makeScriptedFetch(script);
          const clock = makeFakeClock();
          const fakes = makeStartedFakes();

          const handle = await openTarget({
            url,
            start: 'npm start',
            ready: { path, timeout: '60s' },
            cwd: '/tmp',
            env: {},
            fetch: fakeFetch,
            now: clock.now,
            sleep: clock.sleep,
            spawn: fakes.spawn,
            process: fakes.process,
          });

          expect(handle.mode).toBe('started');
          expect(handle.lastStatus).toBe((ready as { status: number }).status);
          expect(fakes.spawnCalls).toHaveLength(1);
          // One pre-start probe plus prefix.length + 1 readiness probes.
          expect(calls).toHaveLength(1 + prefix.length + 1);
          expect(clock.sleeps).toEqual(Array.from({ length: prefix.length }, () => 250));

          await handle.stop();
          expect(fakes.killCalls[0]).toEqual([-5151, 'SIGTERM']);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 (Start_Mode half)
// ---------------------------------------------------------------------------

describe('Exhausting the Ready_Timeout yields Target_Unreachable_Error (Property 3, Start_Mode)', () => {
  // Feature: runtime-target, Property 3 (Start_Mode): Exhausting the Ready_Timeout resolves to Target_Unreachable_Error with the exact last outcome
  // **Validates: Requirements 2.2, 4.5**
  const neverReadyArb: fc.Arbitrary<ScriptedFetchOutcome> = fc.oneof(
    fc
      .oneof(fc.integer({ min: 100, max: 199 }), fc.integer({ min: 400, max: 599 }))
      .map((status): ScriptedFetchOutcome => ({ kind: 'response', status })),
    fc
      .constantFrom('ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'OTHER', 'ABORT' as const)
      .map((code): ScriptedFetchOutcome => ({ kind: 'failure', code })),
  );

  function expectedLastStatus(outcome: ScriptedFetchOutcome): number | string {
    if (outcome.kind === 'response') return outcome.status;
    switch (outcome.code) {
      case 'ECONNREFUSED':
        return 'connection-refused';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'dns';
      case 'ABORT':
        return 'timeout';
      default:
        return 'network';
    }
  }

  it('Property 3 (Start_Mode): the started process is stopped before TargetUnreachableError (mode started) is thrown', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('http://localhost:3000', 'http://127.0.0.1:8080/app'),
        fc.constantFrom('/', '/health'),
        fc.constantFrom(
          { text: '1s', ms: 1000 },
          { text: '2s', ms: 2000 },
          { text: '5s', ms: 5000 },
        ),
        fc.array(neverReadyArb, { maxLength: 30 }),
        async (url, path, timeout, script) => {
          const fullScript = [PRE_PROBE, ...script];
          const { fetch: fakeFetch, calls } = makeScriptedFetch(fullScript);
          const clock = makeFakeClock();
          const fakes = makeStartedFakes();

          let caught: unknown;
          try {
            await openTarget({
              url,
              start: 'npm start',
              ready: { path, timeout: timeout.text },
              cwd: '/tmp',
              env: {},
              fetch: fakeFetch,
              now: clock.now,
              sleep: clock.sleep,
              spawn: fakes.spawn,
              process: fakes.process,
            });
          } catch (error) {
            caught = error;
          }

          expect(caught).toBeInstanceOf(TargetUnreachableError);
          const err = caught as TargetUnreachableError;
          // Observed once the error has propagated: the process was already signalled and has exited.
          expect(fakes.killCalls.length).toBeGreaterThanOrEqual(1);
          expect(fakes.killCalls[0]).toEqual([-5151, 'SIGTERM']);
          expect(fakes.exits).toHaveLength(1);

          const expected = expectedLastStatus(
            fullScript[calls.length - 1] ?? { kind: 'failure', code: 'ECONNREFUSED' },
          );
          expect(err.lastStatus).toBe(expected);
          expect(err.timeoutMs).toBe(timeout.ms);
          expect(err.mode).toBe('started');
        },
      ),
      { numRuns: 100 },
    );
  });
});
