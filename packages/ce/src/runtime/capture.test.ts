import { describe, expect, it } from 'vitest';
import {
  ALL_FORM_FIELDS_SELECTOR,
  maskTargetsFor,
  registerPageHandlers,
  takeScreenshot,
  type EventLogEntry,
} from './capture.js';
import type { PlaywrightLocator, PlaywrightPage, PlaywrightScreenshotOptions } from './playwright-types.js';

type Listener = (arg: never) => void;

interface FakePage {
  page: PlaywrightPage;
  emit: (event: string, arg: unknown) => void;
  listenerCount: (event: string) => number;
  screenshots: PlaywrightScreenshotOptions[];
}

interface FakeOptions {
  /** selector -> match count; unknown selectors count 1. */
  counts?: Record<string, number>;
  /** selectors the page-side fixture-text script reports. */
  fixtureSelectors?: string[];
}

function fakeLocator(selector: string, count: number): PlaywrightLocator & { selector: string } {
  return { selector, count: async () => count } as unknown as PlaywrightLocator & { selector: string };
}

function fakePage(options: FakeOptions = {}): FakePage {
  const listeners = new Map<string, Listener[]>();
  const screenshots: PlaywrightScreenshotOptions[] = [];
  const page = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    off(event: string, listener: Listener) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((l) => l !== listener),
      );
    },
    locator: (selector: string) => fakeLocator(selector, options.counts?.[selector] ?? 1),
    evaluate: async () => options.fixtureSelectors ?? [],
    screenshot: async (opts: PlaywrightScreenshotOptions) => {
      screenshots.push(opts);
      return new Uint8Array();
    },
  } as unknown as PlaywrightPage;
  return {
    page,
    emit: (event, arg) => {
      for (const listener of listeners.get(event) ?? []) listener(arg as never);
    },
    listenerCount: (event) => (listeners.get(event) ?? []).length,
    screenshots,
  };
}

const identity = (text: string): string => text;

describe('registerPageHandlers', () => {
  it('registers dialog, download and popup listeners synchronously, before any observation', () => {
    const fake = fakePage();
    expect(fake.listenerCount('dialog')).toBe(0);
    registerPageHandlers({ page: fake.page, onEvent: () => undefined, redact: identity });
    expect(fake.listenerCount('dialog')).toBe(1);
    expect(fake.listenerCount('download')).toBe(1);
    expect(fake.listenerCount('popup')).toBe(1);
  });

  it('dismisses a dialog and logs it with the current step, redacted', async () => {
    const fake = fakePage();
    const entries: EventLogEntry[] = [];
    let step = 3;
    registerPageHandlers({
      page: fake.page,
      onEvent: (e) => entries.push(e),
      redact: (t) => t.replace('s3cret', '[redacted]'),
      getStep: () => step,
    });
    let dismissed = 0;
    fake.emit('dialog', {
      type: () => 'confirm',
      message: () => 'token s3cret?',
      dismiss: async () => {
        dismissed += 1;
      },
    });
    step = 4;
    expect(dismissed).toBe(1);
    expect(entries).toEqual([{ step: 3, kind: 'dialog', detail: 'confirm: token [redacted]?' }]);
  });

  it('cancels a download without saving and logs its suggested name', () => {
    const fake = fakePage();
    const entries: EventLogEntry[] = [];
    registerPageHandlers({ page: fake.page, onEvent: (e) => entries.push(e), redact: identity, getStep: () => 2 });
    let cancelled = 0;
    let saved = 0;
    fake.emit('download', {
      suggestedFilename: () => 'report.pdf',
      cancel: async () => {
        cancelled += 1;
      },
      saveAs: async () => {
        saved += 1;
      },
    });
    expect(cancelled).toBe(1);
    expect(saved).toBe(0);
    expect(entries).toEqual([{ step: 2, kind: 'download', detail: 'report.pdf' }]);
  });

  it('closes a popup and logs a popup entry plus a refusal, without touching the page content', () => {
    const fake = fakePage();
    const entries: EventLogEntry[] = [];
    registerPageHandlers({ page: fake.page, onEvent: (e) => entries.push(e), redact: identity, getStep: () => 1 });
    let closed = 0;
    let touched = 0;
    fake.emit('popup', {
      url: () => 'https://other.example/x',
      close: async () => {
        closed += 1;
      },
      screenshot: async () => {
        touched += 1;
      },
      evaluate: async () => {
        touched += 1;
      },
    });
    expect(closed).toBe(1);
    expect(touched).toBe(0);
    expect(entries.map((e) => [e.step, e.kind])).toEqual([
      [1, 'popup'],
      [1, 'refusal'],
    ]);
    expect(entries[0]!.detail).toBe('https://other.example/x');
    expect(entries[1]!.detail).toContain('https://other.example/x');
  });

  it('still closes and logs a popup whose url() throws', () => {
    const fake = fakePage();
    const entries: EventLogEntry[] = [];
    registerPageHandlers({ page: fake.page, onEvent: (e) => entries.push(e), redact: identity });
    let closed = 0;
    fake.emit('popup', {
      url: () => {
        throw new Error('gone');
      },
      close: async () => {
        closed += 1;
      },
    });
    expect(closed).toBe(1);
    expect(entries.map((e) => e.kind)).toEqual(['popup', 'refusal']);
  });

  it('removes its listeners on dispose, and dispose is idempotent', () => {
    const fake = fakePage();
    const dispose = registerPageHandlers({ page: fake.page, onEvent: () => undefined, redact: identity });
    dispose();
    dispose();
    expect(fake.listenerCount('dialog')).toBe(0);
    expect(fake.listenerCount('download')).toBe(0);
    expect(fake.listenerCount('popup')).toBe(0);
  });
});

describe('takeScreenshot', () => {
  it("passes animations: 'disabled' and the given masks", async () => {
    const fake = fakePage();
    const mask = [fakeLocator('#email', 1) as unknown as PlaywrightLocator];
    await takeScreenshot({ page: fake.page, path: '/tmp/step-1.png', masks: mask, timeoutMs: 1234 });
    expect(fake.screenshots).toHaveLength(1);
    expect(fake.screenshots[0]).toMatchObject({
      path: '/tmp/step-1.png',
      animations: 'disabled',
      mask,
      timeout: 1234,
    });
  });

  it('omits the timeout when none is given', async () => {
    const fake = fakePage();
    await takeScreenshot({ page: fake.page, path: '/tmp/a.png', masks: [] });
    expect(fake.screenshots[0]).not.toHaveProperty('timeout');
    expect(fake.screenshots[0]!.animations).toBe('disabled');
  });
});

describe('maskTargetsFor', () => {
  const selectorsOf = (masks: PlaywrightLocator[]): string[] =>
    masks.map((m) => (m as unknown as { selector: string }).selector);

  it('masks a located Filled_Field', async () => {
    const fake = fakePage();
    const masks = await maskTargetsFor({
      page: fake.page,
      filledFieldLocators: ['[data-testid="email"]'],
      fixtureValues: [],
    });
    expect(selectorsOf(masks)).toEqual(['[data-testid="email"]']);
  });

  it.each([
    ['zero matches', 0],
    ['several matches', 2],
  ])('falls back to all form fields when a Filled_Field has %s', async (_label, count) => {
    const fake = fakePage({ counts: { '#gone': count } });
    const masks = await maskTargetsFor({
      page: fake.page,
      filledFieldLocators: ['#ok', '#gone'],
      fixtureValues: [],
    });
    expect(selectorsOf(masks)).toEqual([ALL_FORM_FIELDS_SELECTOR]);
  });

  it('falls back to all form fields when locating throws', async () => {
    const fake = fakePage();
    const page = {
      ...fake.page,
      locator: (selector: string) => {
        if (selector === '#bad') throw new Error('invalid selector');
        return fakeLocator(selector, 1);
      },
    } as unknown as PlaywrightPage;
    const masks = await maskTargetsFor({ page, filledFieldLocators: ['#bad'], fixtureValues: [] });
    expect(selectorsOf(masks)).toEqual([ALL_FORM_FIELDS_SELECTOR]);
  });

  it('masks elements whose DOM text contains a fixture value', async () => {
    const fake = fakePage({ fixtureSelectors: ['html > body:nth-child(2) > p:nth-child(1)'] });
    const masks = await maskTargetsFor({
      page: fake.page,
      filledFieldLocators: ['#email'],
      fixtureValues: ['hunter2'],
    });
    expect(selectorsOf(masks)).toEqual(['#email', 'html > body:nth-child(2) > p:nth-child(1)']);
  });

  it('does not search page text when there are no non-empty fixture values', async () => {
    let evaluated = 0;
    const fake = fakePage();
    const page = {
      ...fake.page,
      evaluate: async () => {
        evaluated += 1;
        return [];
      },
    } as unknown as PlaywrightPage;
    const masks = await maskTargetsFor({ page, filledFieldLocators: [], fixtureValues: ['', ''] });
    expect(evaluated).toBe(0);
    expect(masks).toEqual([]);
  });
});
