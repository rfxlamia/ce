import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';
import type { ActionableElementSnapshot } from './observe.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import { runLoop } from './loop.js';
import type { PlaywrightPage } from './playwright-types.js';

const FIXTURE_ORIGIN = 'http://localhost:4100';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Scripted text gateway: fill (option 1), click (option 2), then done. Records each request. */
class FixtureScriptGateway implements JevGateway {
  readonly requests: Jev_Request[] = [];

  async ask(request: Jev_Request, _options: AskOptions = {}): Promise<Jev_Response> {
    this.requests.push(request);
    const call = this.requests.length;
    const probabilities: Record<string, number> =
      call === 1
        ? { '0': 0.05, '1': 0.8, '2': 0.1, done: 0.025, give_up: 0.025 }
        : call === 2
          ? { '0': 0.05, '1': 0.1, '2': 0.8, done: 0.025, give_up: 0.025 }
          : { '0': 0.05, '1': 0.05, '2': 0.05, done: 0.8, give_up: 0.05 };
    return {
      model: 'typesafe/jev-1.14-test',
      answers: {
        next_action: { type: 'choice', probabilities },
        state_reached_dom: { type: 'noul', noul: 0.1 },
      },
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Jev_Response;
  }
}

interface FakeLocator {
  selector: string;
  count(): Promise<number>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
}

/** Page whose URL, title and a button name reflect fixture values; click raises a dialog and a download. */
function makeFixturePage(secrets: { email: string; password: string }) {
  const filled: string[] = [];
  const screenshotMasks: string[][] = [];
  const listeners = new Map<string, Array<(arg: unknown) => void>>();
  let state = 0;

  const snapshots = (): ActionableElementSnapshot[] => [
    {
      tag: 'input',
      role: 'textbox',
      name: 'Email',
      nameAttr: 'email',
      type: 'text',
      visible: true,
      enabled: true,
      cssPath: 'html > body > input:nth-of-type(1)',
    },
    {
      tag: 'button',
      role: 'button',
      name: `Account ${secrets.email}`,
      visible: true,
      enabled: true,
      cssPath: 'html > body > button:nth-of-type(1)',
    },
  ];
  const emit = (event: string, arg: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(arg);
  };
  const makeLocator = (selector: string): FakeLocator => ({
    selector,
    count: async () => 1,
    click: async () => {
      if (selector.startsWith('role=button')) {
        state = 1;
        emit('dialog', { type: () => 'alert', message: () => `Welcome ${secrets.email}`, dismiss: async () => undefined });
        emit('download', { suggestedFilename: () => `${secrets.password}.csv`, cancel: async () => undefined });
      }
    },
    fill: async (value: string) => {
      filled.push(value);
    },
  });

  const page = {
    url: () => (state === 0 ? `${FIXTURE_ORIGIN}/acct/${secrets.email}` : `${FIXTURE_ORIGIN}/acct/${secrets.email}/done`),
    title: async () => `Hello ${secrets.password}`,
    evaluate: async (script: unknown) =>
      typeof script === 'string' && script.includes('ROLES') ? snapshots() : [],
    locator: (selector: string) => makeLocator(selector),
    goto: async () => undefined,
    route: async () => undefined,
    unroute: async () => undefined,
    screenshot: async (options: { path?: string; mask?: readonly FakeLocator[] }) => {
      screenshotMasks.push((options.mask ?? []).map((m) => m.selector));
      if (options.path !== undefined) await writeFile(options.path, PNG);
      return PNG;
    },
    on: (event: string, listener: (arg: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    off: (event: string, listener: (arg: unknown) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((l) => l !== listener),
      );
    },
    close: async () => undefined,
    isClosed: () => false,
  };
  return { page: page as unknown as PlaywrightPage, filled, screenshotMasks };
}

const valueArb = fc.stringMatching(/^FXV[A-Z0-9]{4,12}$/);

describe('runLoop fixture-value containment', () => {
  // Feature: observe-decide-execute-loop, Property 13: No fixture value ever appears outside the Executor and the Capture mask step
  /** **Validates: Requirements 6.4, 6.6, 6.7, 6.9, 12.14** */
  it('Property 13: no fixture value reaches a request, Observation, Event_Log entry or LoopResult field', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(valueArb, valueArb).filter(([a, b]) => !a.includes(b) && !b.includes(a)),
        async ([email, password]) => {
          const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-fixture-'));
          try {
            const fake = makeFixturePage({ email, password });
            const inner = new FixtureScriptGateway();
            const gateway = new GatewayTestSupport({ inner });
            let t = 0;
            const result = await runLoop({
              page: fake.page,
              gateway,
              claim: 'the account page shows the signed-in state',
              changeTerms: new Set<string>(),
              targetOrigin: FIXTURE_ORIGIN,
              routes: [],
              fixtures: { email, password },
              maxSteps: 5,
              timeBudgetMs: 60_000,
              runDir,
              clock: {
                now: () => t,
                sleep: async (ms) => {
                  t += ms;
                },
              },
            });

            // The run exercised the Executor (fill), the dialog/download handlers and the final request.
            expect(fake.filled).toEqual([email]);
            expect(result.steps.map((s) => s.action.kind)).toEqual(['fill', 'click', 'done']);
            expect(result.eventLog.map((e) => e.kind)).toEqual(expect.arrayContaining(['dialog', 'download']));
            expect(gateway.finalImageRequests).toHaveLength(1);

            // The Executor saw the value; no other output carries it.
            const outputs = [JSON.stringify(result), JSON.stringify(inner.requests)];
            for (const out of outputs) {
              expect(out).not.toContain(email);
              expect(out).not.toContain(password);
            }
            // The page text was reflected, so redaction (not absence) is what kept it out.
            expect(JSON.stringify(result)).toContain('[redacted]');

            // Capture masks the Filled_Field in every screenshot taken after the fill.
            const afterFill = fake.screenshotMasks.slice(1);
            expect(afterFill.length).toBeGreaterThan(0);
            for (const masks of afterFill) expect(masks).toContain('role=textbox[name="Email"s]');
          } finally {
            await rm(runDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
