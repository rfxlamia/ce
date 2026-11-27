// Test support: launch Chromium for tests that need a real browser.
// Not a test file (vitest only collects *.test.ts). No Jev call, no API key.
// Playwright is imported lazily so that nothing reachable from index.ts
// loads it, and so this file typechecks before the dependency is installed.

export const CHROMIUM_INSTALL_COMMAND = 'npx playwright install chromium';

/** Minimal structural surface of the launched browser used by tests. */
export interface TestBrowser {
  newPage(options?: { viewport?: { width: number; height: number } }): Promise<unknown>;
  close(): Promise<void>;
}

const MISSING_BROWSER_PATTERNS = [
  /executable doesn't exist/i,
  /browserType\.launch/i,
  /playwright install/i,
  /download new browsers/i,
];

/** True when a launch error means the Chromium binary is not installed. */
export function isMissingChromiumError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return MISSING_BROWSER_PATTERNS.some((pattern) => pattern.test(message));
}

/** Build the error thrown when Chromium is missing; the message names the install command. */
export function missingChromiumError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
  return new Error(
    `Chromium is not installed for Playwright. Run \`${CHROMIUM_INSTALL_COMMAND}\` and retry. (${detail})`,
    { cause },
  );
}

/**
 * Launch headless Chromium. When the browser binary is missing, throws an
 * Error whose message names `npx playwright install chromium`.
 */
export async function launchChromiumForTest(): Promise<TestBrowser> {
  const specifier = 'playwright';
  let chromium: { launch(options?: { headless?: boolean }): Promise<TestBrowser> };
  try {
    ({ chromium } = (await import(specifier)) as { chromium: typeof chromium });
  } catch (error) {
    throw missingChromiumError(error);
  }
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (isMissingChromiumError(error)) throw missingChromiumError(error);
    throw error;
  }
}
