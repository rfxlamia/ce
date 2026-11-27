// End-to-end scenarios of the Runtime_Loop on the Demo_App settings modal (task 11.1, the
// issue #10 "Done when" scenario). Real Chromium, a real build of examples/demo-app started
// through `openTarget`, a fixed ChangeContext. Text requests are answered by recordings of the
// fake gateway (`jev/fixtures/runtime-dropdown-modal.recordings.json`); the Final_Image_Request
// is answered by question id through the `GatewayTestSupport` wrapper. No Jev call, no API key.
//
// Regenerating the recordings after a Demo_App or decision-request change:
//   CE_RECORD_FIXTURES=1 npx vitest run src/runtime/dropdown-modal.loop.test.ts
// Recording uses a scripted decider (below) and rewrites the fixture; a normal run only replays.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeJevGateway, type Recording } from '../jev/fake.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import { launchChromiumForTest, type TestBrowser } from './chromium.testsupport.js';
import { changeTermsFrom } from './decide.js';
import {
  DEMO_APP_DIR,
  DemoAppCleanup,
  buildDemoApp,
  makeTempDir,
  pickFreePort,
} from './demo-app.testsupport.js';
import { GatewayTestSupport, type FinalImageAnswer } from './gateway.testsupport.js';
import { runLoop, type LoopResult } from './loop.js';
import type { PlaywrightPage } from './playwright-types.js';
import { openTarget, type TargetHandle } from './target.js';

// ---------------------------------------------------------------------------------------
// Fixed inputs
// ---------------------------------------------------------------------------------------

const TIMEOUT = 180_000;
const VIEWPORT = { width: 1024, height: 768 };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'jev',
  'fixtures',
  'runtime-dropdown-modal.recordings.json',
);
const RECORD = process.env['CE_RECORD_FIXTURES'] === '1';

const THEME_CLAIM = 'the theme dropdown is fully visible inside the settings modal';
const LANGUAGE_CLAIM = 'the language dropdown is fully visible inside the settings modal';

/** Fixed ChangeContext: the files of the change that added the modal and dropdowns. */
const CHANGE_FILES = [
  {
    path: 'examples/demo-app/src/main.ts',
    patch: '+function wireDropdown(triggerId, listId, onChoose) {}\n+wireDropdown("theme-trigger", "theme-list")',
  },
  { path: 'examples/demo-app/index.html', patch: '+<div role="dialog" aria-label="Settings">' },
];

// ---------------------------------------------------------------------------------------
// Structural views of the real page used for geometry assertions
// ---------------------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface GeoLocator {
  boundingBox(): Promise<Box | null>;
  isVisible(): Promise<boolean>;
}
interface GeoPage {
  getByRole(role: string, options?: { name?: string; exact?: boolean }): GeoLocator;
  close(): Promise<void>;
}

const inside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

// ---------------------------------------------------------------------------------------
// Scripted decider, used only to record the fixture
// ---------------------------------------------------------------------------------------

/** Decision of the scripted decider for one request, from the request alone. */
function scriptedAnswers(request: Jev_Request): { next: Record<string, number>; dom: number } {
  const state = typeof request.state === 'string' ? request.state : request.state.text;
  const claim = /^claim: (.*)$/m.exec(state)?.[1] ?? '';
  const taken = (state.match(/^step \d+:/gm) ?? []).length;
  const criteria = (request.questions['next_action']?.question as { criteria?: Record<string, string> } | undefined)
    ?.criteria;
  if (criteria === undefined) throw new Error('scripted decider: request has no next_action');
  const indexOf = (needle: string): string => {
    const found = Object.entries(criteria).find(
      ([key, text]) => key !== 'done' && key !== 'give_up' && text.includes(needle),
    );
    if (found === undefined) throw new Error(`scripted decider: no option containing ${needle}`);
    return found[0];
  };
  const only = (key: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(criteria)) out[k] = k === key ? 1 : 0;
    return out;
  };
  const theme = claim === THEME_CLAIM;
  if (taken === 0) return { next: only(indexOf('button "Open settings"')), dom: 0.05 };
  if (taken === 1) {
    return { next: only(indexOf(theme ? 'button "Choose theme"' : 'button "Choose language"')), dom: 0.1 };
  }
  // The dropdown is open. Theme list fits: reached. Language list is clipped: not reached.
  return theme ? { next: only('done'), dom: 0.92 } : { next: only('give_up'), dom: 0.05 };
}

/** Answers like a Jev would and keeps one Recording per question. */
class RecordingGateway implements JevGateway {
  readonly recordings: Recording[] = [];

  async ask(request: Jev_Request, _options?: AskOptions): Promise<Jev_Response> {
    const { next, dom } = scriptedAnswers(request);
    const hash = stateHash(request.state);
    const nextKey = Object.entries(next).find(([, p]) => p === 1)![0];
    const answers: Jev_Response['answers'] = {
      next_action: { type: 'choice', choice: nextKey, probabilities: next, confidence: 1 },
      state_reached_dom: { type: 'noul', noul: dom },
    };
    const model = 'typesafe/jev-1.14-20261014';
    const usage = { input_tokens: 0, output_tokens: 0 };
    for (const [name, built] of Object.entries(request.questions)) {
      const answer = answers[name] as Recording['answer'];
      if (!this.recordings.some((r) => r.idVersion === built.idVersion && r.stateHash === hash && r.question === name)) {
        this.recordings.push({ idVersion: built.idVersion, stateHash: hash, question: name, answer, model, usage });
      }
    }
    return { model, answers, usage };
  }
}

// ---------------------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------------------

const cleanup = new DemoAppCleanup();
const recorder = new RecordingGateway();
let browser: TestBrowser;
let target: TargetHandle;
let baseUrl = '';
let origin = '';

beforeAll(async () => {
  const outDir = cleanup.addDir(await makeTempDir('ce-dropdown-loop-'));
  await buildDemoApp(outDir);
  const port = await pickFreePort();
  const env: Record<string, string | undefined> = { ...process.env };
  delete env['OPENROUTER_API_KEY'];
  delete env['TYPESAFE_API_KEY'];
  target = await openTarget({
    url: `http://localhost:${port}/`,
    start: `npx --no-install vite preview --outDir ${outDir} --port ${port} --strictPort`,
    cwd: DEMO_APP_DIR,
    env,
  });
  baseUrl = target.baseUrl;
  origin = new URL(baseUrl).origin;
  browser = await launchChromiumForTest();
}, TIMEOUT);

afterAll(async () => {
  if (RECORD && recorder.recordings.length > 0) {
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(recorder.recordings, null, 2)}\n`);
  }
  await browser?.close();
  await target?.stop();
  await cleanup.run();
}, TIMEOUT);

function textGateway(): JevGateway {
  if (RECORD) return recorder;
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(`missing ${FIXTURE_PATH}; record it with CE_RECORD_FIXTURES=1`);
  }
  return new FakeJevGateway(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Recording[]);
}

interface Scenario {
  result: LoopResult;
  gateway: GatewayTestSupport;
  page: GeoPage;
  runDir: string;
}

const runDirs: string[] = [];

async function runScenario(claim: string, finalImage: FinalImageAnswer): Promise<Scenario> {
  const runDir = await mkdtemp(join(tmpdir(), 'ce-dropdown-run-'));
  runDirs.push(runDir);
  const page = (await browser.newPage({ viewport: VIEWPORT })) as GeoPage & PlaywrightPage;
  await (page as unknown as { goto(url: string): Promise<unknown> }).goto(baseUrl);
  const gateway = new GatewayTestSupport({ inner: textGateway(), finalImage });
  const result = await runLoop({
    page,
    gateway,
    claim,
    changeTerms: changeTermsFrom(CHANGE_FILES),
    targetOrigin: origin,
    routes: [],
    fixtures: {},
    maxSteps: 6,
    timeBudgetMs: 120_000,
    runDir,
  });
  return { result, gateway, page, runDir };
}

afterAll(async () => {
  await Promise.allSettled(runDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** `kind name` of every Action of the loop that acts on an element, in order. */
function executedActions(result: LoopResult): string[] {
  return result.steps
    .filter((s) => s.action.kind === 'click' || s.action.kind === 'fill')
    .map((s) => {
      const ref = (s.action as { ref: string }).ref;
      const element = s.observation.elements.find((e) => e.ref === ref);
      return `${s.action.kind} ${element?.name ?? '?'}`;
    });
}

async function expectPng(runDir: string, relative: string): Promise<void> {
  const bytes = await readFile(join(runDir, relative));
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
}

async function expectEvidenceFiles(s: Scenario): Promise<void> {
  const { result, runDir } = s;
  expect(result.observations.length).toBeGreaterThanOrEqual(3);
  for (const observation of result.observations) {
    expect(observation.screenshot).not.toBe('');
    await expectPng(runDir, observation.screenshot);
  }
  expect(result.finalScreenshot).toBeDefined();
  await expectPng(runDir, result.finalScreenshot!);
}

function expectGatewayDiscipline(s: Scenario): void {
  // One text request per decision, none with an image; exactly one combined image request.
  expect(s.gateway.textRequests.length).toBe(s.result.steps.length);
  for (const request of s.gateway.textRequests) {
    expect(request.hasImage).toBe(false);
    expect(request.questionNames).toEqual(['next_action', 'state_reached_dom']);
  }
  expect(s.gateway.imageRequests.length).toBe(1);
  expect(s.gateway.finalImageRequests.length).toBe(1);
  expect(s.gateway.requests.at(-1)?.isFinalImageRequest).toBe(true);
}

// ---------------------------------------------------------------------------------------
// Scenario 1: the theme dropdown fits inside the modal
// ---------------------------------------------------------------------------------------

describe('dropdown-in-modal loop: theme dropdown (claim is satisfied)', () => {
  it(
    'opens settings, opens the theme dropdown and ends reached, with the list inside modal and viewport',
    async () => {
      const s = await runScenario(THEME_CLAIM, { stateReached: 0.93 });
      const { result } = s;
      try {
        expect(executedActions(result)).toEqual(['click Open settings', 'click Choose theme']);
        expect(result.stopReason).toBe('reached');
        expect(result.finalState).toBe('reached');
        expect(result.finalSignals.stateReached).toBe(0.93);
        expect(result.finalSignals.stateReachedDom).toBeGreaterThanOrEqual(0.7);
        expect(result.finalImageError).toBeUndefined();
        expect(result.finalImageModel).toBeDefined();
        expect(result.subjectBox).toBeDefined();
        await expectEvidenceFiles(s);
        expectGatewayDiscipline(s);

        // The page the loop left behind is the page the claim is about.
        const list = await s.page.getByRole('listbox', { name: 'Theme options' }).boundingBox();
        const modal = await s.page.getByRole('dialog', { name: 'Settings' }).boundingBox();
        expect(list).not.toBeNull();
        expect(modal).not.toBeNull();
        expect(inside(list!, modal!)).toBe(true);
        expect(inside(list!, { x: 0, y: 0, ...VIEWPORT })).toBe(true);
      } finally {
        await s.page.close();
      }
    },
    TIMEOUT,
  );

  it(
    'still ends reached from the text signals when the image request fails (multipart 400)',
    async () => {
      const s = await runScenario(THEME_CLAIM, { failure: 'multipart-400' });
      try {
        expect(executedActions(s.result)).toEqual(['click Open settings', 'click Choose theme']);
        expect(s.result.finalImageError).toBe('bad_request');
        expect(s.result.subjectBox).toBeUndefined();
        expect(s.result.finalState).toBe('reached');
        expect(s.gateway.finalImageRequests.length).toBe(1);
      } finally {
        await s.page.close();
      }
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------
// Scenario 2: the language dropdown is clipped by the modal
// ---------------------------------------------------------------------------------------

describe('dropdown-in-modal loop: language dropdown (claim is not satisfied)', () => {
  it(
    'opens settings, opens the language dropdown and ends not_reached, with the list beyond the modal',
    async () => {
      const s = await runScenario(LANGUAGE_CLAIM, { stateReached: 0.1 });
      try {
        expect(executedActions(s.result)).toEqual(['click Open settings', 'click Choose language']);
        expect(s.result.stopReason).toBe('give_up');
        expect(s.result.finalState).toBe('not_reached');
        expect(s.result.finalSignals.stateReached).toBe(0.1);
        expect(s.result.finalSignals.stateReachedDom).toBeLessThan(0.7);
        await expectEvidenceFiles(s);
        expectGatewayDiscipline(s);

        const list = await s.page.getByRole('listbox', { name: 'Language options' }).boundingBox();
        const modal = await s.page.getByRole('dialog', { name: 'Settings' }).boundingBox();
        expect(list).not.toBeNull();
        expect(modal).not.toBeNull();
        expect(inside(list!, modal!)).toBe(false);
        expect(list!.y + list!.height).toBeGreaterThan(modal!.y + modal!.height);
      } finally {
        await s.page.close();
      }
    },
    TIMEOUT,
  );

  it(
    'stays not_reached from the text signals when the image request fails (multipart 400)',
    async () => {
      const s = await runScenario(LANGUAGE_CLAIM, { failure: 'multipart-400' });
      try {
        expect(executedActions(s.result)).toEqual(['click Open settings', 'click Choose language']);
        expect(s.result.finalImageError).toBe('bad_request');
        expect(s.result.subjectBox).toBeUndefined();
        expect(s.result.finalState).toBe('not_reached');
      } finally {
        await s.page.close();
      }
    },
    TIMEOUT,
  );
});
