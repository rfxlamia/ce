/**
 * Capture (spec observe-decide-execute-loop, Requirements 7 and 8).
 *
 * This part holds the page event handlers and the settle wait. Type-only dependency on
 * Playwright: no runtime import of `playwright`.
 */

import { sanitizeText, PATH_TEXT_LIMIT } from './observe.js';
import type {
  PlaywrightDialog,
  PlaywrightDownload,
  PlaywrightLocator,
  PlaywrightPage,
  PlaywrightRequestLike,
} from './playwright-types.js';

export interface EventLogEntry {
  step: number;
  kind: 'dialog' | 'download' | 'popup' | 'settle' | 'refusal';
  /** Redactor output. */
  detail: string;
}

/** Longest `detail` of a `dialog` entry. */
export const DIALOG_DETAIL_LIMIT = 500;

/** A request must have been absent this long before the page counts as settled. */
export const SETTLE_QUIET_MS = 500;
/** Gap between the two digest reads. */
export const SETTLE_DIGEST_GAP_MS = 100;
/** Polling interval while waiting for requests to finish. */
const SETTLE_POLL_MS = 50;

export interface RegisterPageHandlersInput {
  page: PlaywrightPage;
  onEvent: (entry: EventLogEntry) => void;
  /** Redactor; applied to every detail before it leaves this module. */
  redact: (text: string) => string;
  /** Step number stamped on each entry. Read at event time. Defaults to 0. */
  getStep?: () => number;
}

/**
 * Dismisses every dialog, cancels every download (no file is written) and closes every
 * popup page, logging each one. Install before the first Observation. Returns a dispose
 * function. A popup page is never observed, screenshotted or sent to the gateway.
 */
export function registerPageHandlers(input: RegisterPageHandlersInput): () => void {
  const { page, onEvent, redact } = input;
  const step = (): number => input.getStep?.() ?? 0;
  const emit = (kind: EventLogEntry['kind'], detail: string): void => {
    onEvent({ step: step(), kind, detail });
  };

  const onDialog = (dialog: PlaywrightDialog): void => {
    const type = dialog.type?.() ?? 'dialog';
    const detail = `${type}: ${redact(dialog.message())}`.slice(0, DIALOG_DETAIL_LIMIT);
    emit('dialog', detail);
    void Promise.resolve(dialog.dismiss()).catch(() => undefined);
  };

  const onDownload = (download: PlaywrightDownload): void => {
    emit('download', redact(download.suggestedFilename()));
    void Promise.resolve(download.cancel()).catch(() => undefined);
  };

  const onPopup = (popup: PlaywrightPage): void => {
    let url = '';
    try {
      url = sanitizeText(redact(popup.url()), { maxLength: PATH_TEXT_LIMIT, fixtureValues: [] });
    } catch {
      // A popup that cannot report a URL is still closed and logged.
    }
    emit('popup', url);
    emit('refusal', `popup closed: ${url}`);
    void Promise.resolve(popup.close()).catch(() => undefined);
  };

  page.on('dialog', onDialog);
  page.on('download', onDownload);
  page.on('popup', onPopup);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    page.off('dialog', onDialog as (...args: never[]) => void);
    page.off('download', onDownload as (...args: never[]) => void);
    page.off('popup', onPopup as (...args: never[]) => void);
  };
}

export interface WaitForSettleInput {
  page: PlaywrightPage;
  computeDigest: () => Promise<string>;
  /** Normally `SETTLE_TIMEOUT_MS` (3000). */
  settleTimeoutMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** When given, a `settle` entry is appended on timeout. */
  onEvent?: (entry: EventLogEntry) => void;
  /** Step number of the `settle` entry. Defaults to 0. */
  step?: number;
}

/**
 * Waits until no request has been in flight for 500 ms and the digest is unchanged across
 * two reads 100 ms apart. Returns `settled: false` at the Settle_Timeout, never later,
 * and then appends a `settle` entry (when `onEvent` is given) and lets the caller continue.
 */
export async function waitForSettle(input: WaitForSettleInput): Promise<{ settled: boolean }> {
  const { page, computeDigest, settleTimeoutMs, now, sleep } = input;
  const start = now();
  const deadline = start + settleTimeoutMs;

  const inFlight = new Set<PlaywrightRequestLike>();
  let quietSince = start;
  const onRequest = (request: PlaywrightRequestLike): void => {
    inFlight.add(request);
  };
  const onDone = (request: PlaywrightRequestLike): void => {
    inFlight.delete(request);
    if (inFlight.size === 0) quietSince = now();
  };
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);

  const sleepUpTo = async (ms: number): Promise<void> => {
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(ms, remaining));
  };

  let settled = false;
  try {
    while (now() < deadline) {
      if (inFlight.size > 0) {
        await sleepUpTo(SETTLE_POLL_MS);
        continue;
      }
      const quietFor = now() - quietSince;
      if (quietFor < SETTLE_QUIET_MS) {
        await sleepUpTo(Math.min(SETTLE_POLL_MS, SETTLE_QUIET_MS - quietFor));
        continue;
      }
      // Both reads must fit before the deadline, otherwise the timeout wins.
      if (now() + SETTLE_DIGEST_GAP_MS > deadline) {
        await sleepUpTo(deadline - now());
        break;
      }
      const first = await computeDigest();
      await sleep(SETTLE_DIGEST_GAP_MS);
      const second = await computeDigest();
      if (first === second && inFlight.size === 0 && now() - quietSince >= SETTLE_QUIET_MS) {
        settled = true;
        break;
      }
      // The DOM or the network moved; restart the quiet window.
      quietSince = now();
    }
  } finally {
    page.off('request', onRequest as (...args: never[]) => void);
    page.off('requestfinished', onDone as (...args: never[]) => void);
    page.off('requestfailed', onDone as (...args: never[]) => void);
  }

  if (!settled) {
    input.onEvent?.({
      step: input.step ?? 0,
      kind: 'settle',
      detail: `page did not settle within ${settleTimeoutMs} ms`,
    });
  }
  return { settled };
}

/** Selector that matches every form field; the fallback mask. */
export const ALL_FORM_FIELDS_SELECTOR = 'input, textarea, select';

export interface TakeScreenshotInput {
  page: PlaywrightPage;
  /** Absolute path under the Run_Dir. */
  path: string;
  /** Filled_Fields plus fixture-text elements (or all form fields on a locate failure). */
  masks: readonly PlaywrightLocator[];
  /** Per-call timeout; omitted when not given. */
  timeoutMs?: number;
}

/** Writes a PNG with animations disabled and every given mask applied. */
export async function takeScreenshot(input: TakeScreenshotInput): Promise<void> {
  await input.page.screenshot({
    path: input.path,
    animations: 'disabled',
    mask: input.masks,
    ...(input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs }),
  });
}

export interface MaskTargetsInput {
  page: PlaywrightPage;
  /** Stable_Locators of the fields the Executor filled. */
  filledFieldLocators: readonly string[];
  /** Capture-only. Never forwarded to the Observer, the Decider or the Jev_Gateway. */
  fixtureValues: readonly string[];
}

/**
 * Returns the locators to mask in a screenshot: every Filled_Field, or every `input`,
 * `textarea` and `select` when any Filled_Field cannot be located (zero or several
 * matches, or a locator error), plus every element whose DOM text contains a fixture
 * value as a case-sensitive substring. Does not modify the page.
 */
export async function maskTargetsFor(input: MaskTargetsInput): Promise<PlaywrightLocator[]> {
  const { page, filledFieldLocators } = input;
  const values = input.fixtureValues.filter((value) => value !== '');
  const masks: PlaywrightLocator[] = [];

  let fieldsLocated = true;
  for (const selector of filledFieldLocators) {
    try {
      const locator = page.locator(selector);
      if ((await locator.count()) === 1) masks.push(locator);
      else {
        fieldsLocated = false;
        break;
      }
    } catch {
      fieldsLocated = false;
      break;
    }
  }
  if (!fieldsLocated) {
    masks.length = 0;
    masks.push(page.locator(ALL_FORM_FIELDS_SELECTOR));
  }

  if (values.length > 0) {
    let selectors: string[] = [];
    try {
      selectors = await page.evaluate(fixtureTextScript(values) as unknown as () => string[]);
    } catch {
      selectors = [];
    }
    for (const selector of selectors) masks.push(page.locator(selector));
  }
  return masks;
}

/**
 * Page-side script, plain JavaScript in a string (no DOM lib needed, immune to bundler
 * helpers). Returns a unique CSS path for each innermost element whose text content
 * contains one of the values (case-sensitive). Reads only; never writes.
 */
function fixtureTextScript(values: readonly string[]): string {
  return String.raw`((values) => {
  const doc = document;
  const contains = (el) => {
    const text = el.textContent || '';
    return values.some((value) => text.includes(value));
  };
  const pathOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node !== doc.documentElement) {
      const parent = node.parentElement;
      const tag = node.tagName.toLowerCase();
      if (!parent) { parts.unshift(tag); break; }
      parts.unshift(tag + ':nth-child(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')');
      node = parent;
    }
    return 'html > ' + parts.join(' > ');
  };
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const found = [];
  const all = doc.body ? doc.body.querySelectorAll('*') : [];
  for (const el of Array.from(all)) {
    if (skip.has(el.tagName) || !contains(el)) continue;
    if (!Array.from(el.children).some(contains)) found.push(pathOf(el));
  }
  return found;
})(${JSON.stringify(values)})`;
}
