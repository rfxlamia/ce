/**
 * Minimal structural surface of the Playwright objects the runtime uses.
 * Type-only: modules and test fakes depend on these shapes, never on a runtime
 * import of `playwright`. Real Playwright `Page` and `Locator` satisfy them.
 */

export interface PlaywrightRequestLike {
  url(): string;
  isNavigationRequest(): boolean;
  resourceType(): string;
}

export interface PlaywrightRouteLike {
  request(): PlaywrightRequestLike;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
  /** Performs the request without following redirects when `maxRedirects` is 0. */
  fetch?(options?: { maxRedirects?: number; timeout?: number }): Promise<PlaywrightApiResponseLike>;
  fulfill?(options: { response: PlaywrightApiResponseLike }): Promise<void>;
}

export interface PlaywrightApiResponseLike {
  status(): number;
  headers(): Record<string, string>;
}

export interface PlaywrightLocator {
  count(): Promise<number>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  isEnabled(options?: { timeout?: number }): Promise<boolean>;
  first(): PlaywrightLocator;
  locator(selector: string): PlaywrightLocator;
}

export interface PlaywrightDialog {
  /** `alert`, `confirm`, `prompt` or `beforeunload`. */
  type?(): string;
  message(): string;
  dismiss(): Promise<void>;
}

export interface PlaywrightDownload {
  suggestedFilename(): string;
  cancel(): Promise<void>;
}

export interface PlaywrightScreenshotOptions {
  path?: string;
  animations?: 'disabled' | 'allow';
  mask?: readonly PlaywrightLocator[];
  timeout?: number;
}

export interface PlaywrightPage {
  url(): string;
  title(): Promise<string>;
  locator(selector: string): PlaywrightLocator;
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<R, A = unknown>(fn: (arg: A) => R, arg?: A): Promise<R>;
  screenshot(options?: PlaywrightScreenshotOptions): Promise<Uint8Array>;
  route(
    url: string | RegExp,
    handler: (route: PlaywrightRouteLike) => void | Promise<void>,
  ): Promise<void>;
  unroute(
    url: string | RegExp,
    handler?: (route: PlaywrightRouteLike) => void | Promise<void>,
  ): Promise<void>;
  on(event: 'dialog', listener: (dialog: PlaywrightDialog) => void): unknown;
  on(event: 'download', listener: (download: PlaywrightDownload) => void): unknown;
  on(event: 'popup', listener: (popup: PlaywrightPage) => void): unknown;
  on(event: 'request' | 'requestfinished' | 'requestfailed', listener: (request: PlaywrightRequestLike) => void): unknown;
  off(event: string, listener: (...args: never[]) => void): unknown;
  close(): Promise<void>;
  isClosed(): boolean;
}
