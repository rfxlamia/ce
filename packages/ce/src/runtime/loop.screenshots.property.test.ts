// Feature: observe-decide-execute-loop, Property 16: Every Observation after the first carries a non-empty screenshot
// **Validates: Requirements 8.2, 8.3, 8.4**

import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { JevGateway, Jev_Response } from '../jev/gateway.js';
import { GatewayTestSupport } from './gateway.testsupport.js';
import { runLoop } from './loop.js';
import type { PlaywrightLocator, PlaywrightPage } from './playwright-types.js';

const SCREENSHOTS_ORIGIN = 'http://127.0.0.1:4321';
const SCREENSHOTS_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A page with one enabled button. Clicking it changes the DOM (the button name) only when the
 * plan for that click says so; every other read of the page is stable.
 */
function screenshotsFakePage(plan: readonly boolean[]): { page: PlaywrightPage; clicks: () => number } {
  let version = 0;
  let clicks = 0;
  let closed = false;
  const locator: PlaywrightLocator = {
    count: async () => 1,
    click: async () => {
      if (plan[clicks] === true) version += 1;
      clicks += 1;
    },
    fill: async () => undefined,
    isVisible: async () => true,
    isEnabled: async () => true,
    first: () => locator,
    locator: () => locator,
  };
  const page: PlaywrightPage = {
    url: () => `${SCREENSHOTS_ORIGIN}/`,
    title: async () => 'Fake',
    locator: () => locator,
    goto: async () => undefined,
    evaluate: (async () => [
      {
        tag: 'button',
        role: 'button',
        name: `Toggle ${version}`,
        visible: true,
        enabled: true,
        cssPath: 'body > button',
      },
    ]) as unknown as PlaywrightPage['evaluate'],
    screenshot: async (options) => {
      if (options?.path !== undefined) await writeFile(options.path, SCREENSHOTS_PNG);
      return SCREENSHOTS_PNG;
    },
    route: async () => undefined,
    unroute: async () => undefined,
    on: (() => undefined) as PlaywrightPage['on'],
    off: () => undefined,
    close: async () => {
      closed = true;
    },
    isClosed: () => closed,
  };
  return { page, clicks: () => clicks };
}

/** Always picks the first Option; the reached-check stays low so only `max-steps` stops the loop. */
function screenshotsScriptedGateway(): JevGateway {
  return {
    async ask(request): Promise<Jev_Response> {
      const names = Object.keys(request.questions);
      const answers: Jev_Response['answers'] = {};
      for (const name of names) {
        if (name === 'next_action') {
          answers[name] = {
            type: 'choice',
            probabilities: { first: 0.9, done: 0.05, give_up: 0.05 },
          } as unknown as Jev_Response['answers'][string];
        } else if (name === 'state_reached_dom') {
          answers[name] = { type: 'noul', noul: 0.1 };
        }
      }
      return { model: 'typesafe/jev-test', answers, usage: { input_tokens: 0, output_tokens: 0 } };
    },
  };
}

describe('Property 16: every Observation carries a non-empty screenshot', () => {
  it('reuses the previous screenshot when the page did not change, captures a new one when it did', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), async (plan) => {
        const runDir = await mkdtemp(path.join(os.tmpdir(), 'ce-loop-shots-'));
        try {
          const { page, clicks } = screenshotsFakePage(plan);
          let now = 0;
          const result = await runLoop({
            page,
            gateway: new GatewayTestSupport({ inner: screenshotsScriptedGateway() }),
            claim: 'the toggle works',
            changeTerms: new Set(),
            targetOrigin: SCREENSHOTS_ORIGIN,
            routes: [],
            fixtures: {},
            maxSteps: plan.length,
            timeBudgetMs: 10_000_000,
            runDir,
            clock: {
              now: () => now,
              sleep: async (ms) => {
                now += ms;
              },
            },
          });

          expect(result.stopReason).toBe('max-steps');
          expect(clicks()).toBe(plan.length);
          expect(result.observations).toHaveLength(plan.length + 1);

          for (const observation of result.observations) {
            expect(observation.screenshot).not.toBe('');
            expect(existsSync(path.join(runDir, observation.screenshot))).toBe(true);
          }
          for (let i = 1; i < result.observations.length; i += 1) {
            const previous = result.observations[i - 1]!;
            const current = result.observations[i]!;
            if (plan[i - 1] === true) {
              expect(current.domDigest).not.toBe(previous.domDigest);
              expect(current.screenshot).not.toBe(previous.screenshot);
            } else {
              expect(current.domDigest).toBe(previous.domDigest);
              expect(current.screenshot).toBe(previous.screenshot);
            }
          }
        } finally {
          await rm(runDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
