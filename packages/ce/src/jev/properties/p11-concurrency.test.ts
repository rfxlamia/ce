import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog.js';
import { HybridJevGateway } from '../gateway.js';
import type { CallLog } from '../log.js';
import type { SdkTransport } from '../transport-sdk.js';
import { JsonTransportError } from '../transport-json.js';
import type { JsonTransport } from '../transport-json.js';
import type { Jev_Request, RawSystemOneResult } from '../types.js';

const noopLog: CallLog = { append: () => Promise.resolve() };
const noSleep = (): Promise<void> => Promise.resolve();
const unusedJson: JsonTransport = {
  send: () => Promise.reject(new Error('json transport must not be used')),
};

/** Lets every pending promise continuation run. Microtasks only, no timers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

interface Pending {
  index: number;
  resolve: () => void;
  reject: () => void;
}

function requestFor(index: number): Jev_Request {
  return {
    stage: 'runtime',
    state: `request ${String(index)}`,
    questions: { q: CATALOG.assessRuntimeObservable.built() },
  };
}

function okResult(): RawSystemOneResult {
  return {
    model: 'typesafe/jev-1.14-test',
    answers: { q: { type: 'noul', noul: 0.5 } },
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe('jev-gateway properties', () => {
  // Feature: jev-gateway, Property 11: Bounded concurrency admits all requests without exceeding the limit
  // **Validates: Requirements 7.2, 7.4, 7.14**
  it('Property 11: in-flight requests never exceed maxConcurrent, all complete, and start in FIFO order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.nat({ max: 1000 }), { minLength: 20, maxLength: 20 }),
        fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
        async (n, limit, picks, failures) => {
          let inFlight = 0;
          let maxInFlight = 0;
          const startOrder: number[] = [];
          const active: Pending[] = [];

          const sdk: SdkTransport = {
            send(req) {
              const index = Number(/request (\d+)/.exec(String(req.state))?.[1]);
              inFlight += 1;
              maxInFlight = Math.max(maxInFlight, inFlight);
              startOrder.push(index);
              return new Promise<RawSystemOneResult>((resolve, reject) => {
                active.push({
                  index,
                  resolve: () => {
                    inFlight -= 1;
                    resolve(okResult());
                  },
                  reject: () => {
                    inFlight -= 1;
                    // A 400 is not retried, so each request makes exactly one attempt.
                    reject(new JsonTransportError('http', 'HTTP 400', { status: 400 }));
                  },
                });
              });
            },
          };

          const gateway = new HybridJevGateway({
            sdkTransport: sdk,
            jsonTransport: unusedJson,
            callLog: noopLog,
            provider: 'openrouter',
            requestedModel: 'typesafe/jev-1.14',
            maxConcurrent: limit,
            sleep: noSleep,
          });

          // Submit all N concurrently, in index order.
          const settled: boolean[] = new Array<boolean>(n).fill(false);
          const promises = Array.from({ length: n }, (_, i) =>
            gateway.ask(requestFor(i)).then(
              () => {
                settled[i] = true;
              },
              () => {
                settled[i] = true;
              },
            ),
          );

          await flush();
          let completed = 0;
          for (;;) {
            // Exactly min(N, completed + L) requests have started: the limit is reached but not passed.
            expect(inFlight).toBeLessThanOrEqual(limit);
            expect(startOrder.length).toBe(Math.min(n, completed + limit));
            if (active.length === 0) break;
            const at = (picks[completed] ?? 0) % active.length;
            const [chosen] = active.splice(at, 1);
            if (chosen === undefined) break;
            if (failures[chosen.index] === true) chosen.reject();
            else chosen.resolve();
            completed += 1;
            await flush();
          }

          await Promise.all(promises);
          expect(maxInFlight).toBeLessThanOrEqual(limit);
          expect(completed).toBe(n);
          expect(settled.every(Boolean)).toBe(true);
          expect(inFlight).toBe(0);
          // FIFO: transports start in submission order.
          expect(startOrder).toEqual(Array.from({ length: n }, (_, i) => i));
        },
      ),
      { numRuns: 100 },
    );
  });
});
