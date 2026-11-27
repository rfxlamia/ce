// Integration test of the Executor's in-flight origin interception (task 5.5).
// Two real loopback servers: A (the Target_Origin) redirects to B. Real Chromium.
// Confirms that Playwright re-invokes the route handler for every redirect hop.
// No Jev call, no API key.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChromiumForTest, type TestBrowser } from './chromium.testsupport.js';
import { execute } from './execute.js';
import type { Observation } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

const TIMEOUT = 60000;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

describe('execute: redirect hops to another origin (integration)', () => {
  let serverA: Server;
  let serverB: Server;
  let originA = '';
  let originB = '';
  let browser: TestBrowser;
  let bHits = 0;

  beforeAll(async () => {
    serverB = createServer((_req, res) => {
      bHits += 1;
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>B</title><p>other origin</p>');
    });
    const portB = await listen(serverB);
    originB = `http://127.0.0.1:${portB}`;

    serverA = createServer((req, res) => {
      if (req.url === '/hop') {
        res.statusCode = 302;
        res.setHeader('location', '/final');
        res.end();
        return;
      }
      if (req.url === '/redirect') {
        res.statusCode = 302;
        res.setHeader('location', `${originB}/landing`);
        res.end();
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>A</title><a id="out" href="/redirect">Go</a>');
    });
    const portA = await listen(serverA);
    originA = `http://127.0.0.1:${portA}`;

    browser = await launchChromiumForTest();
  }, TIMEOUT);

  afterAll(async () => {
    await browser?.close();
    await Promise.all([serverA && close(serverA), serverB && close(serverB)]);
  });

  function observationFor(): Observation {
    return {
      step: 3,
      url: '/',
      title: 'A',
      domDigest: 'digest',
      elements: [
        {
          ref: 'e1',
          role: 'link',
          name: 'Go',
          locator: '#out',
          visible: true,
          enabled: true,
          href: `${originA}/redirect`,
          fixtureKeys: [],
        },
      ],
      navigation: [`${originA}/redirect`],
      screenshot: 'step-0.png',
    };
  }

  async function newPage(): Promise<PlaywrightPage> {
    return (await browser.newPage()) as PlaywrightPage;
  }

  it(
    'aborts a goto whose same-origin URL redirects to the second server',
    async () => {
      const page = await newPage();
      try {
        await page.goto(`${originA}/`);
        const hitsBefore = bHits;
        const result = await execute({
          action: { kind: 'goto', url: `${originA}/redirect` },
          observation: observationFor(),
          page,
          targetOrigin: originA,
          fixtures: {},
          callTimeoutMs: 10000,
        });

        expect(result.status).toBe('give_up');
        if (result.status !== 'give_up') return;
        expect(result.reason).toBe('cross-origin');
        expect(result.refusal.kind).toBe('refusal');
        expect(result.refusal.step).toBe(3);
        expect(result.refusal.detail).toContain(originB);
        // The redirect hop was aborted in flight: the second server never saw it.
        expect(bHits).toBe(hitsBefore);
        // The page never reached the second origin.
        expect(page.url().startsWith(originB)).toBe(false);
      } finally {
        await page.close();
      }
    },
    TIMEOUT,
  );

  it(
    'aborts a click on a same-origin link whose target redirects to the second server',
    async () => {
      const page = await newPage();
      try {
        await page.goto(`${originA}/`);
        const hitsBefore = bHits;
        const result = await execute({
          action: { kind: 'click', ref: 'e1' },
          observation: observationFor(),
          page,
          targetOrigin: originA,
          fixtures: {},
          callTimeoutMs: 10000,
        });

        expect(result.status).toBe('give_up');
        if (result.status !== 'give_up') return;
        expect(result.reason).toBe('cross-origin');
        expect(result.refusal.detail).toContain(originB);
        expect(bHits).toBe(hitsBefore);
        expect(page.url().startsWith(originB)).toBe(false);
      } finally {
        await page.close();
      }
    },
    TIMEOUT,
  );

  it(
    'lets a same-origin redirect chain complete',
    async () => {
      const page = await newPage();
      try {
        await page.goto(`${originA}/`);
        const observation = { ...observationFor(), navigation: [`${originA}/hop`] };
        const result = await execute({
          action: { kind: 'goto', url: `${originA}/hop` },
          observation,
          page,
          targetOrigin: originA,
          fixtures: {},
          callTimeoutMs: 10000,
        });
        expect(result).toEqual({ status: 'ok', changed: true });
        expect(page.url()).toBe(`${originA}/final`);
      } finally {
        await page.close();
      }
    },
    TIMEOUT,
  );
});
