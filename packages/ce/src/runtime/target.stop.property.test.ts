import { EventEmitter } from 'node:events';
import type { spawn as nodeSpawn } from 'node:child_process';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { openTarget } from './target.js';

// Feature: runtime-target, Property 14: stop() is idempotent under any sequence of calls, including a natural exit
// **Validates: Requirements 2.5, 2.6, 6.6, 6.7**

const CHILD_PID = 4242;

type Op = 'stop' | 'stopAwait' | 'exit' | 'tick';
type Reaction = 'on-term' | 'on-kill' | 'never';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Property 14: stop() idempotence', () => {
  it('kill/cleanup runs at most once, every stop() resolves, exit state is consistent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'attach' | 'start'>('attach', 'start'),
        fc.constantFrom<Reaction>('on-term', 'on-kill', 'never'),
        fc.boolean(), // natural exit before any stop() call
        fc.array(fc.constantFrom<Op>('stop', 'stopAwait', 'exit', 'tick'), { maxLength: 8 }),
        fc.integer({ min: 0, max: 7 }),
        async (mode, reaction, exitFirst, ops, stopIndex) => {
          const groupSignals: string[] = [];
          const sleeps: number[] = [];
          let exitEmitted = false;
          let naturalExit = false;
          let exitedBeforeFirstStop = false;
          let stopCalled = false;
          let spawnCalls = 0;

          const child = new EventEmitter() as EventEmitter & {
            pid: number;
            stdout: EventEmitter;
            stderr: EventEmitter;
          };
          child.pid = CHILD_PID;
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          const emitExit = (code: number | null, sig: string | null): void => {
            if (exitEmitted) return;
            exitEmitted = true;
            child.emit('exit', code, sig);
          };

          const proc = new EventEmitter() as EventEmitter & { pid: number; kill: (pid: number, sig: string) => boolean };
          proc.pid = 1000;
          proc.kill = (pid, sig) => {
            if (sig === (0 as unknown)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
            if (pid === -CHILD_PID) {
              groupSignals.push(sig);
              if (
                (sig === 'SIGTERM' && reaction === 'on-term') ||
                (sig === 'SIGKILL' && reaction !== 'never')
              ) {
                emitExit(null, sig);
              }
            }
            return true;
          };

          let fetchCalls = 0;
          const fetchFn = (async () => {
            fetchCalls += 1;
            return new Response(null, { status: fetchCalls === 1 && mode === 'start' ? 503 : 200 });
          }) as unknown as typeof fetch;

          const handle = await openTarget({
            url: 'http://127.0.0.1:39999',
            ...(mode === 'start' ? { start: 'serve' } : {}),
            cwd: '/tmp',
            env: {},
            fetch: fetchFn,
            spawn: (() => {
              spawnCalls += 1;
              return child;
            }) as unknown as typeof nodeSpawn,
            sleep: async (ms) => {
              sleeps.push(ms); // fake clock: grace periods elapse instantly
            },
            now: () => 0,
            process: proc as unknown as NodeJS.Process,
          });

          expect(spawnCalls).toBe(mode === 'start' ? 1 : 0);
          const canExit = mode === 'start';

          if (canExit && exitFirst) {
            naturalExit = true;
            exitedBeforeFirstStop = true;
            emitExit(0, null);
          }

          // Build the full sequence: at least one stop(), interleaved with ops.
          const sequence: Op[] = [...ops];
          sequence.splice(Math.min(stopIndex, sequence.length), 0, 'stop');

          const promises: Array<Promise<unknown>> = [];
          const settled: Array<'resolved' | 'rejected'> = [];
          const callStop = (): Promise<void> => {
            if (!stopCalled) {
              stopCalled = true;
              if (exitEmitted) exitedBeforeFirstStop = true;
            }
            const p = handle.stop();
            promises.push(
              p.then(
                () => void settled.push('resolved'),
                () => void settled.push('rejected'),
              ),
            );
            return p;
          };

          for (const op of sequence) {
            if (op === 'stop') void callStop();
            else if (op === 'stopAwait') await callStop().catch(() => {});
            else if (op === 'tick') await tick();
            else if (canExit && !exitEmitted) {
              naturalExit = true;
              emitExit(0, null);
            }
          }
          await Promise.all(promises);

          // Every stop() resolved.
          expect(settled.length).toBe(promises.length);
          expect(settled.every((s) => s === 'resolved')).toBe(true);

          // Kill logic ran at most once.
          expect(groupSignals.filter((s) => s === 'SIGTERM').length).toBeLessThanOrEqual(1);
          expect(groupSignals.filter((s) => s === 'SIGKILL').length).toBeLessThanOrEqual(1);
          expect(groupSignals.filter((s) => s !== 'SIGTERM' && s !== 'SIGKILL')).toEqual([]);
          if (groupSignals.includes('SIGKILL')) expect(groupSignals[0]).toBe('SIGTERM');
          expect(handle.warnings.length).toBeLessThanOrEqual(1);
          // Grace and kill deadline are polled in 50 ms steps: at most (5000 + 5000) / 50 sleeps.
          expect(sleeps.length).toBeLessThanOrEqual(200);
          expect(sleeps.every((ms) => ms <= 5000)).toBe(true);

          if (mode === 'attach') {
            expect(groupSignals).toEqual([]);
            expect(handle.exited).toBeUndefined();
            return;
          }

          // Already exited before the first stop(): no signal at all.
          if (exitedBeforeFirstStop) {
            expect(groupSignals).toEqual([]);
            expect(handle.exited).toEqual({ exitCode: 0, signal: null });
            return;
          }

          // Recorded exit state matches exactly one exit sequence.
          if (handle.exited === undefined) {
            expect(exitEmitted).toBe(false);
            expect(reaction).toBe('never');
            expect(groupSignals).toEqual(['SIGTERM', 'SIGKILL']);
            expect(handle.warnings.length).toBe(1);
          } else {
            expect(exitEmitted).toBe(true);
            const killedBy = groupSignals.find((s) => handle.exited?.signal === s);
            if (killedBy !== undefined) {
              expect(handle.exited).toEqual({ exitCode: null, signal: killedBy });
            } else {
              expect(naturalExit).toBe(true);
              expect(handle.exited).toEqual({ exitCode: 0, signal: null });
            }
            // A warning is legitimate only if stop() gave up (SIGKILL sent) before a late natural exit.
            if (!groupSignals.includes('SIGKILL')) expect(handle.warnings).toEqual([]);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
