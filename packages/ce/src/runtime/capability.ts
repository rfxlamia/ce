/**
 * Browser_Capability (spec observe-decide-execute-loop, Requirement 13).
 *
 * This part holds the two pure functions: `selectClaim` and `mapLoopResultToRuntimeResult`.
 * No import of `playwright`, no I/O, no file writes.
 */

import path from 'node:path';

import type { Assessment, Claim } from '../assessment/index.js';
import type { ChangeContext } from '../context/types.js';
import type { RuntimeResult } from '../outcome/index.js';
import { ConfigDefaults } from '../config/defaults.js';
import { parseDuration } from '../config/duration.js';
import type { CapabilityEntry, RuntimeHookInput } from '../run/types.js';
import { changeTermsFrom } from './decide.js';
import { runLoop, type LoopClock, type LoopResult, type RunLoopInput } from './loop.js';
import { createRedactor } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';
import { targetOptionsFromConfig, type TargetHandle, type TargetOptions } from './target.js';

/** The one Claim the loop works on, or the Change text when no Claim was identified. */
export type SelectedClaim =
  | { status: 'identified'; claim: Claim; text: string }
  | { status: 'not_identified'; text: string };

/**
 * Requirement 13 criterion 6. Filters in order: `browser_ui` Claims that are needed, then
 * `browser_ui` Claims, then all Claims. The highest `runtimeObservable` wins; a tie goes to
 * the first Claim in `claims` order. With no Claims, the text of the `change` subject is used.
 */
export function selectClaim(claims: readonly Claim[], assessment: Assessment): SelectedClaim {
  if (claims.length === 0) {
    const subject = assessment.subjects.find((s) => s.kind === 'change');
    return { status: 'not_identified', text: subject?.text ?? '' };
  }

  const entryOf = (claim: Claim) => assessment.perClaim.find((p) => p.claimId === claim.id);
  const observable = (claim: Claim): number => entryOf(claim)?.runtimeObservable ?? 0;

  const browser = claims.filter((c) => entryOf(c)?.surface === 'browser_ui');
  const needed = browser.filter((c) => entryOf(c)?.needed === true);
  const pool = needed.length > 0 ? needed : browser.length > 0 ? browser : claims;

  let best = pool[0] as Claim;
  for (const claim of pool) {
    if (observable(claim) > observable(best)) best = claim;
  }
  return { status: 'identified', claim: best, text: best.text };
}

export interface MapLoopResultInput {
  loopResult: LoopResult;
  selectedClaim: SelectedClaim;
  change: ChangeContext['change'];
  baseUrl: string;
  runDir: string;
  /** Redactor input only. Values never appear in the output. */
  fixtureValues?: readonly string[];
}

/**
 * Requirement 13 criterion 8. Pure and total. `LoopResult.subjectBox` holds fractions of the
 * screenshot, not pixels; it is not part of the `RuntimeResult` and is not touched here.
 */
export function mapLoopResultToRuntimeResult(input: MapLoopResultInput): RuntimeResult {
  const { loopResult, selectedClaim, change, baseUrl, runDir } = input;
  const redact = createRedactor(input.fixtureValues ?? []);

  const evidenceChange: RuntimeResult['evidence']['change'] = {
    files: change.files.map((file) => file.path),
  };
  if (change.title !== undefined) evidenceChange.title = change.title;
  if (change.description !== undefined) evidenceChange.description = change.description;
  if (change.base !== undefined) evidenceChange.base = change.base;
  if (change.head !== undefined) evidenceChange.head = change.head;

  const claim: RuntimeResult['evidence']['claim'] =
    selectedClaim.status === 'identified'
      ? {
          status: 'identified',
          id: selectedClaim.claim.id,
          text: selectedClaim.claim.text,
          provenance: selectedClaim.claim.provenance,
        }
      : { status: 'not_identified' };

  const actions: RuntimeResult['evidence']['actions'] = [];
  for (const step of loopResult.steps) {
    const action = step.action;
    if (action.kind === 'click' || action.kind === 'fill') {
      const element = step.observation.elements.find((e) => e.ref === action.ref);
      const target = element === undefined ? action.ref : `${element.role} "${element.name}"`;
      const description = action.kind === 'fill' ? `${target} from fixture "${action.fixtureKey}"` : target;
      actions.push({ kind: action.kind, description: redact(description) });
    } else if (action.kind === 'goto') {
      actions.push({ kind: 'goto', description: redact(action.url) });
    }
  }

  return {
    finalState: loopResult.finalState,
    evidence: {
      change: evidenceChange,
      claim,
      subject: { url: baseUrl },
      actions,
      observations: loopResult.observations.map((o) => ({ step: o.step, screenshot: o.screenshot })),
      artifacts: { runDir, reportPath: path.join(runDir, 'report.html') },
    },
  };
}

// ---------------------------------------------------------------------------
// createBrowserCapability (Requirement 13)
// ---------------------------------------------------------------------------

/** Thrown by `run` when no run directory was computed; nothing is opened or launched. */
export class RunDirMissingError extends Error {
  constructor() {
    super('browser_ui capability requires a run directory (runDir is absent)');
    this.name = 'RunDirMissingError';
  }
}

/** A launched browser: hands out pages already configured with the viewport, and closes. */
export interface BrowserLike {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface BrowserCapabilityDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  openTarget: (options: TargetOptions) => Promise<TargetHandle>;
  launchBrowser?: (options: { viewport: { width: number; height: number } }) => Promise<BrowserLike>;
  clock?: LoopClock;
  /** Loop_Sink: receives the raw LoopResult. Default no-op. */
  onLoopResult?: (result: LoopResult) => void | Promise<void>;
}

/** Default launcher. Playwright is imported lazily so no static path from `index.ts` reaches it. */
async function defaultLaunchBrowser(options: {
  viewport: { width: number; height: number };
}): Promise<BrowserLike> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  return {
    newPage: async () => (await browser.newPage({ viewport: options.viewport })) as unknown as PlaywrightPage,
    close: () => browser.close(),
  };
}

export function createBrowserCapability(deps: BrowserCapabilityDeps): CapabilityEntry {
  const launchBrowser = deps.launchBrowser ?? defaultLaunchBrowser;
  const onLoopResult = deps.onLoopResult ?? (() => undefined);

  return {
    name: 'browser_ui',
    surfaces: ['browser_ui'],
    run: async (input: RuntimeHookInput): Promise<RuntimeResult> => {
      const { context, claims, assessment, config, gateway, runDir, signal } = input;
      if (runDir === undefined) throw new RunDirMissingError();

      const runtime = config.runtime ?? {};
      const defaults = ConfigDefaults.runtime ?? {};
      const maxSteps = runtime['max-steps'] ?? defaults['max-steps'] ?? 12;
      const timeBudgetMs = parseDuration(runtime.timeout ?? defaults.timeout ?? '90s');
      const viewport = {
        width: runtime.viewport?.width ?? defaults.viewport?.width ?? 1280,
        height: runtime.viewport?.height ?? defaults.viewport?.height ?? 800,
      };
      const fixtures = runtime.fixtures ?? {};
      const selected = selectClaim(claims, assessment);

      let target: TargetHandle | undefined;
      let browser: BrowserLike | undefined;
      try {
        const targetExtras: { cwd: string; env: Record<string, string | undefined>; runDir: string; signal?: AbortSignal } = {
          cwd: deps.cwd,
          env: deps.env,
          runDir,
        };
        if (signal !== undefined) targetExtras.signal = signal;
        target = await deps.openTarget(targetOptionsFromConfig(config, targetExtras));

        browser = await launchBrowser({ viewport });
        const page = await browser.newPage();
        // The loop observes the current page; start it on the Subject, not on about:blank.
        await page.goto(target.baseUrl, { timeout: timeBudgetMs });

        const loopInput: RunLoopInput = {
          page,
          gateway,
          claim: selected.text,
          changeTerms: changeTermsFrom(context.change.files),
          targetOrigin: new URL(target.baseUrl).origin,
          routes: config.target?.routes ?? [],
          fixtures,
          maxSteps,
          timeBudgetMs,
          runDir,
        };
        if (signal !== undefined) loopInput.signal = signal;
        if (deps.clock !== undefined) loopInput.clock = deps.clock;
        const loopResult = await runLoop(loopInput);

        await onLoopResult(loopResult);
        return mapLoopResultToRuntimeResult({
          loopResult,
          selectedClaim: selected,
          change: context.change,
          baseUrl: target.baseUrl,
          runDir,
          fixtureValues: Object.values(fixtures),
        });
      } finally {
        try {
          await browser?.close();
        } finally {
          await target?.stop();
        }
      }
    },
  };
}
