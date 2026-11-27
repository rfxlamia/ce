// Unit test of the visibility computation in observe() (task 3.5).
// Real Chromium, static markup. No Jev call, no API key.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChromiumForTest, type TestBrowser } from './chromium.testsupport.js';
import { observe } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

interface TestPage {
  setContent(html: string): Promise<void>;
  close(): Promise<void>;
}

const HTML = `<!doctype html><html><head><title>t</title></head><body>
  <button id="shown">Shown</button>
  <button id="none" style="display:none">None</button>
  <div style="height:0;overflow:hidden"><button id="clipped">Clipped</button></div>
</body></html>`;

let browser: TestBrowser;

beforeAll(async () => {
  browser = await launchChromiumForTest();
}, 120000);

afterAll(async () => {
  await browser?.close();
});

describe('observe visibility', () => {
  it('marks a rendered button visible, display:none hidden, and zero-clipped-by-ancestor hidden', async () => {
    const page = (await browser.newPage({ viewport: { width: 800, height: 600 } })) as TestPage;
    try {
      await page.setContent(HTML);
      const observation = await observe({
        page: page as unknown as PlaywrightPage,
        step: 0,
        targetOrigin: 'http://localhost:3000',
        fixtureKeys: [],
      });
      const byName = new Map(observation.elements.map((e) => [e.name, e.visible]));
      expect(byName.get('Shown')).toBe(true);
      expect(byName.get('None')).toBe(false);
      expect(byName.get('Clipped')).toBe(false);
    } finally {
      await page.close();
    }
  }, 60000);
});
