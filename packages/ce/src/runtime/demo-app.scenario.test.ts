// Markup and behavior tests of the Demo_App modal and dropdown scenario (task 2.2).
// Real Chromium against a temporary build of examples/demo-app. No Jev call, no API key.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChromiumForTest, type TestBrowser } from './chromium.testsupport.js';
import {
  DEMO_APP_DIR,
  DemoAppCleanup,
  buildDemoApp,
  makeTempDir,
  pickFreePort,
  startPreview,
} from './demo-app.testsupport.js';

// Minimal structural view of the Playwright surface used here.
interface Loc {
  click(): Promise<void>;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  textContent(): Promise<string | null>;
  boundingBox(): Promise<Box | null>;
  allTextContents(): Promise<string[]>;
  first(): Loc;
  getAttribute(name: string): Promise<string | null>;
}
interface Page {
  goto(url: string): Promise<unknown>;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Loc;
  viewportSize(): { width: number; height: number } | null;
  close(): Promise<void>;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TIMEOUT = 120000;
const VIEWPORT = { width: 1024, height: 768 };

const cleanup = new DemoAppCleanup();
let browser: TestBrowser;
let baseUrl = '';

beforeAll(async () => {
  const outDir = cleanup.addDir(await makeTempDir());
  await buildDemoApp(outDir);
  const server = cleanup.addServer(await startPreview(outDir, await pickFreePort()));
  baseUrl = server.url;
  browser = await launchChromiumForTest();
}, TIMEOUT);

afterAll(async () => {
  await browser?.close();
  await cleanup.run();
}, TIMEOUT);

async function newPage(): Promise<Page> {
  const page = (await browser.newPage({ viewport: VIEWPORT })) as Page;
  await page.goto(baseUrl);
  return page;
}

const inside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

describe('demo-app settings modal scenario', () => {
  it('opens a dialog named "Settings" and closes it with "Close"', async () => {
    const page = await newPage();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    expect(await dialog.count()).toBe(0); // hidden dialogs are not exposed
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    expect(await dialog.isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await dialog.isVisible()).toBe(false);
    await page.close();
  }, TIMEOUT);

  it('theme list has at least three options including Dark, and choosing Dark updates the theme text', async () => {
    const page = await newPage();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
    const options = await page.getByRole('option').allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options).toContain('Dark');
    await page.getByRole('option', { name: 'Dark', exact: true }).click();
    const current = page.getByRole('status', { name: 'Current theme' });
    expect(await current.textContent()).toBe('Theme: Dark');
    await page.close();
  }, TIMEOUT);

  it('theme list lies inside the modal and the viewport', async () => {
    const page = await newPage();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
    const list = await page.getByRole('listbox', { name: 'Theme options' }).boundingBox();
    const modal = await page.getByRole('dialog', { name: 'Settings' }).boundingBox();
    expect(list).not.toBeNull();
    expect(modal).not.toBeNull();
    const viewport: Box = { x: 0, y: 0, ...VIEWPORT };
    expect(inside(list!, modal!)).toBe(true);
    expect(inside(list!, viewport)).toBe(true);
    await page.close();
  }, TIMEOUT);

  it('language list has at least three options and extends beyond the modal', async () => {
    const page = await newPage();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: 'Choose language', exact: true }).click();
    const list = page.getByRole('listbox', { name: 'Language options' });
    const options = await list.first().boundingBox();
    expect(options).not.toBeNull();
    const count = await page.getByRole('option').count();
    expect(count).toBeGreaterThanOrEqual(3);
    const modal = await page.getByRole('dialog', { name: 'Settings' }).boundingBox();
    expect(modal).not.toBeNull();
    expect(inside(options!, modal!)).toBe(false);
    expect(options!.y + options!.height).toBeGreaterThan(modal!.y + modal!.height);
    await page.close();
  }, TIMEOUT);

  it('keeps the Menu toggle, navigation and Increment counter behavior', async () => {
    const page = await newPage();
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    expect(await menu.getAttribute('aria-expanded')).toBe('false');
    expect(await page.getByRole('link', { name: 'Dashboard' }).isVisible()).toBe(false);
    await menu.click();
    expect(await menu.getAttribute('aria-expanded')).toBe('true');
    const links = await page.getByRole('link').allTextContents();
    expect(links).toEqual(['Dashboard', 'Reports', 'Settings']);
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    await page.getByRole('button', { name: 'Increment', exact: true }).click();
    expect(await page.getByRole('status').first().textContent()).toBe('2');
    await page.close();
  }, TIMEOUT);
});

describe('demo-app source', () => {
  it('has no CE reference and no CE-only test hook', () => {
    const sources = [
      readFileSync(join(DEMO_APP_DIR, 'index.html'), 'utf8'),
      readFileSync(join(DEMO_APP_DIR, 'src', 'main.ts'), 'utf8'),
    ].join('\n');
    // Strip the one pre-existing descriptive sentence about the app's purpose.
    const scrubbed = sources
      .replace(/CE demo app/gi, '')
      .replace(/CE Demo App/g, '')
      .replace(/Continuous Evidence spike/g, '')
      .replace(/knows nothing about CE/gi, '')
      .replace(/CE-unaware/g, '');
    expect(scrubbed).not.toMatch(/\bCE\b/);
    expect(scrubbed).not.toMatch(/data-ce|data-testid|__ce|window\.ce/i);
  });
});
