import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { execute, isSameOrigin } from './execute.js';
import type { Observation } from './observe.js';
import type {
  PlaywrightLocator,
  PlaywrightPage,
  PlaywrightRequestLike,
  PlaywrightRouteLike,
} from './playwright-types.js';

const TARGET = 'http://127.0.0.1:4173';

const hostArb = fc.constantFrom('example.com', 'evil.test', 'localhost', '127.0.0.1', 'app.internal');
const schemeArb = fc.constantFrom('http', 'https');
const portArb = fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined });
const pathArb = fc.constantFrom('/', '/a', '/settings?x=1', '/deep/path#frag');

/** An absolute URL whose origin differs from TARGET (scheme, host or port). */
const foreignUrlArb = fc
  .tuple(schemeArb, hostArb, portArb, pathArb)
  .filter(([s, h, p, path]) => !isSameOrigin(`${s}://${h}${p === undefined ? '' : `:${p}`}${path}`, TARGET))
  .map(([s, h, p, path]) => `${s}://${h}${p === undefined ? '' : `:${p}`}${path}`);

function observation(navigation: string[]): Observation {
  return {
    step: 3,
    url: '/',
    title: 'Home',
    domDigest: 'd',
    navigation,
    screenshot: 'step-3.png',
    elements: [
      {
        ref: 'e1',
        role: 'button',
        name: 'Go',
        locator: '[data-testid="go"]',
        visible: true,
        enabled: true,
        fixtureKeys: [],
      },
    ],
  };
}

interface FakeRequest extends PlaywrightRequestLike {
  url(): string;
}

function request(url: string, navigation: boolean): FakeRequest {
  return {
    url: () => url,
    isNavigationRequest: () => navigation,
    resourceType: () => (navigation ? 'document' : 'fetch'),
  };
}

interface Fake {
  page: PlaywrightPage;
  gotos: string[];
  completed: string[];
  aborted: string[];
  handlers: Array<(route: PlaywrightRouteLike) => void | Promise<void>>;
}

/**
 * Fake page. `clickRequests` are the requests the browser would issue on click, in order
 * (initial navigation, then redirect hops, form submissions, sub-resources). Each goes
 * through the registered route handler; a hop that is aborted stops the chain.
 */
function fakePage(clickRequests: FakeRequest[]): Fake {
  const fake: Fake = {
    gotos: [],
    completed: [],
    aborted: [],
    handlers: [],
    page: undefined as unknown as PlaywrightPage,
  };
  const locator: PlaywrightLocator = {
    count: async () => 1,
    click: async () => {
      for (const req of clickRequests) {
        let abortedHere = false;
        const route: PlaywrightRouteLike = {
          request: () => req,
          abort: async () => {
            abortedHere = true;
            fake.aborted.push(req.url());
          },
          continue: async () => {
            fake.completed.push(req.url());
          },
        };
        for (const handler of fake.handlers) await handler(route);
        if (abortedHere) throw new Error('net::ERR_BLOCKED_BY_CLIENT');
      }
    },
    fill: async () => undefined,
    isVisible: async () => true,
    isEnabled: async () => true,
    first: () => locator,
    locator: () => locator,
  };
  fake.page = {
    url: () => TARGET + '/',
    title: async () => 'Home',
    locator: () => locator,
    goto: async (url: string) => {
      fake.gotos.push(url);
    },
    evaluate: (async () => undefined) as PlaywrightPage['evaluate'],
    screenshot: async () => new Uint8Array(),
    route: async (_url, handler) => {
      fake.handlers.push(handler);
    },
    unroute: async (_url, handler) => {
      const i = fake.handlers.indexOf(handler as never);
      if (i >= 0) fake.handlers.splice(i, 1);
    },
    on: () => undefined,
    off: () => undefined,
    close: async () => undefined,
    isClosed: () => false,
  } as PlaywrightPage;
  return fake;
}

describe('execute: cross-origin refusal', () => {
  // Feature: observe-decide-execute-loop, Property 11: Cross-origin navigation is always refused, never completed
  it('refuses any goto to a foreign origin without calling page.goto', async () => {
    await fc.assert(
      fc.asyncProperty(foreignUrlArb, fc.boolean(), async (url, listed) => {
        const fake = fakePage([]);
        const result = await execute({
          action: { kind: 'goto', url },
          observation: observation(listed ? [url] : []),
          page: fake.page,
          targetOrigin: TARGET,
          fixtures: {},
          callTimeoutMs: 1000,
        });
        expect(fake.gotos).toEqual([]);
        expect(result.status).toBe('give_up');
        if (result.status === 'give_up') {
          expect(result.reason).toBe('cross-origin');
          expect(result.refusal.kind).toBe('refusal');
          expect(result.refusal.detail).toContain(new URL(url).origin);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: observe-decide-execute-loop, Property 11: Cross-origin navigation is always refused, never completed
  it('aborts a foreign navigation or redirect hop triggered by a click and never completes it', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(pathArb, { maxLength: 3 }),
        foreignUrlArb,
        fc.boolean(),
        fc.array(pathArb, { maxLength: 2 }),
        async (sameHops, foreign, foreignIsFirst, subresources) => {
          const chain: FakeRequest[] = [
            ...subresources.map((p) => request(`https://cdn.example.net${p}`, false)),
            ...(foreignIsFirst ? [request(foreign, true)] : []),
            ...sameHops.map((p) => request(TARGET + p, true)),
            ...(foreignIsFirst ? [] : [request(foreign, true)]),
          ];
          const fake = fakePage(chain);
          const result = await execute({
            action: { kind: 'click', ref: 'e1' },
            observation: observation([]),
            page: fake.page,
            targetOrigin: TARGET,
            fixtures: {},
            callTimeoutMs: 1000,
          });
          expect(fake.completed).not.toContain(foreign);
          expect(fake.aborted).toContain(foreign);
          // Only sub-resources and same-origin navigations may have completed.
          for (const url of fake.completed) {
            const req = chain.find((r) => r.url() === url)!;
            expect(!req.isNavigationRequest() || isSameOrigin(url, TARGET)).toBe(true);
          }
          expect(result.status).toBe('give_up');
          if (result.status === 'give_up') {
            expect(result.reason).toBe('cross-origin');
            expect(result.refusal.kind).toBe('refusal');
          }
          // The interceptor is removed after the action.
          expect(fake.handlers).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: observe-decide-execute-loop, Property 11: Cross-origin navigation is always refused, never completed
  it('compares scheme, host and port after normalizing the default port', () => {
    fc.assert(
      fc.property(schemeArb, hostArb, (scheme, host) => {
        const defaultPort = scheme === 'http' ? 80 : 443;
        expect(isSameOrigin(`${scheme}://${host}/a`, `${scheme}://${host}:${defaultPort}/b`)).toBe(true);
        const other = scheme === 'http' ? 'https' : 'http';
        expect(isSameOrigin(`${scheme}://${host}/`, `${other}://${host}/`)).toBe(false);
        expect(isSameOrigin(`${scheme}://${host}:1234/`, `${scheme}://${host}:1235/`)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
