/**
 * Executor of the Observe → Decide → Execute loop (spec observe-decide-execute-loop,
 * Requirements 4, 5 and 6). It turns a DecidedAction into a Playwright call, after the
 * Ref, origin and fixture guards. Type-only dependency on Playwright.
 */

import type { DecidedAction } from './decide.js';
import { createRedactor, type Observation } from './observe.js';
import type { PlaywrightPage, PlaywrightRouteLike } from './playwright-types.js';

export type GiveUpReason =
  | 'unobserved-ref'
  | 'ineligible-ref'
  | 'locator-mismatch'
  | 'unknown-fixture'
  | 'cross-origin'
  | 'invalid-answer';

export interface RefusalEntry {
  step: number;
  kind: 'refusal';
  detail: string;
}

export type ExecuteResult =
  | { status: 'ok'; changed: boolean }
  | { status: 'give_up'; reason: GiveUpReason; refusal: RefusalEntry };

export interface ExecuteInput {
  action: DecidedAction;
  /** The most recent Observation: the only source of valid refs, locators and navigation URLs. */
  observation: Observation;
  page: PlaywrightPage;
  targetOrigin: string;
  fixtures: Readonly<Record<string, string>>;
  /** min(Playwright default, time remaining), Requirement 9.12. */
  callTimeoutMs: number;
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };

function originTuple(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    const port = parsed.port === '' ? DEFAULT_PORTS[parsed.protocol] : parsed.port;
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}`;
  } catch {
    return undefined;
  }
}

/**
 * Compares scheme, host and port after default-port normalization (Requirement 5.6).
 * A value that is not an http(s) URL is never the same origin as anything.
 */
export function isSameOrigin(a: string, b: string): boolean {
  const left = originTuple(a);
  const right = originTuple(b);
  return left !== undefined && right !== undefined && left === right;
}

/** Origin of a URL for a refusal detail; never the path or query, which may reflect a value. */
function originForDetail(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid-url';
  }
}

function resolveLocation(location: string, base: string): string | undefined {
  try {
    return new URL(location, base).href;
  } catch {
    return undefined;
  }
}

/**
 * Runs `act` with a route interceptor that aborts every top-level or frame navigation
 * (including form submissions and each redirect hop) whose origin differs from the
 * Target_Origin. Sub-resource requests are continued. The interceptor is removed afterwards
 * (Requirements 5.3, 5.4, 5.5, 5.7). Returns the blocked origin when something was aborted.
 */
async function withOriginGuard(
  page: PlaywrightPage,
  targetOrigin: string,
  act: () => Promise<void>,
): Promise<{ blockedOrigin?: string }> {
  let blockedOrigin: string | undefined;
  const handler = async (route: PlaywrightRouteLike): Promise<void> => {
    const request = route.request();
    try {
      if (!request.isNavigationRequest()) {
        await route.continue();
      } else if (!isSameOrigin(request.url(), targetOrigin)) {
        blockedOrigin ??= originForDetail(request.url());
        await route.abort('blockedbyclient');
      } else if (route.fetch === undefined || route.fulfill === undefined) {
        await route.continue();
      } else {
        // Chromium follows redirects inside the network stack and does not re-invoke this
        // handler per hop. Fetch without following, check the Location, and hand the redirect
        // response to the browser only when its target is on the Target_Origin; the browser
        // then issues the next hop, which comes back through this handler.
        const response = await route.fetch({ maxRedirects: 0 });
        const status = response.status();
        const location = status >= 300 && status < 400 ? response.headers()['location'] : undefined;
        const next = location === undefined ? undefined : resolveLocation(location, request.url());
        if (next !== undefined && !isSameOrigin(next, targetOrigin)) {
          blockedOrigin ??= originForDetail(next);
          await route.abort('blockedbyclient');
        } else {
          await route.fulfill({ response });
        }
      }
    } catch {
      // The page or request is already gone; nothing left to route.
    }
  };
  await page.route('**/*', handler);
  try {
    await act();
  } catch (error) {
    // An aborted navigation can make the action itself throw; that is the refusal, not a failure.
    if (blockedOrigin === undefined) throw error;
  } finally {
    await page.unroute('**/*', handler);
  }
  return blockedOrigin === undefined ? {} : { blockedOrigin };
}

export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
  const { action, observation, page, targetOrigin, fixtures, callTimeoutMs } = input;
  const redact = createRedactor(Object.values(fixtures));

  const refuse = (reason: GiveUpReason, detail: string): ExecuteResult => ({
    status: 'give_up',
    reason,
    refusal: { step: observation.step, kind: 'refusal', detail: redact(`${reason}: ${detail}`) },
  });

  switch (action.kind) {
    case 'done':
      return { status: 'ok', changed: false };

    case 'give_up':
      return refuse(action.reason, 'decider gave up');

    case 'goto': {
      if (!isSameOrigin(action.url, targetOrigin)) {
        return refuse('cross-origin', originForDetail(action.url));
      }
      // Requirement 5.2: only a URL stored in the most recent Observation is accepted.
      if (!observation.navigation.includes(action.url)) {
        return refuse('unobserved-ref', `url not in observation.navigation: ${action.url}`);
      }
      const guarded = await withOriginGuard(page, targetOrigin, async () => {
        await page.goto(action.url, { timeout: callTimeoutMs });
      });
      if (guarded.blockedOrigin !== undefined) {
        return refuse('cross-origin', guarded.blockedOrigin);
      }
      return { status: 'ok', changed: true };
    }

    case 'click':
    case 'fill': {
      const element = observation.elements.find((e) => e.ref === action.ref);
      if (element === undefined) return refuse('unobserved-ref', action.ref);
      if (!element.visible || !element.enabled) return refuse('ineligible-ref', action.ref);

      if (action.kind === 'fill') {
        const known =
          Object.prototype.hasOwnProperty.call(fixtures, action.fixtureKey) &&
          element.fixtureKeys.includes(action.fixtureKey);
        if (!known) return refuse('unknown-fixture', `${action.ref} key "${action.fixtureKey}"`);
      }

      // The only way to a locator is the Stable_Locator stored in the Observation.
      const locator = page.locator(element.locator);
      const matches = await locator.count();
      if (matches !== 1) return refuse('locator-mismatch', `${action.ref} matched ${matches}`);

      const guarded = await withOriginGuard(page, targetOrigin, async () => {
        if (action.kind === 'click') {
          await locator.click({ timeout: callTimeoutMs });
        } else {
          await locator.fill(fixtures[action.fixtureKey] as string, { timeout: callTimeoutMs });
        }
      });
      if (guarded.blockedOrigin !== undefined) {
        return refuse('cross-origin', guarded.blockedOrigin);
      }
      return { status: 'ok', changed: true };
    }
  }
}
