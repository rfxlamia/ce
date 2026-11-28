/**
 * Test support for the committed per-Outcome fixtures (task 8.7): four invented,
 * schema-validated Run_Records plus the generator that renders them into
 * `fixtures/<outcome>/` (run.json, report.html, PNG screenshots for EVIDENCED).
 * Kept out of `scripts/` because scripts may not import the report, and Outcome
 * values come from OUTCOMES only (outcome/architecture.test.ts rule d).
 *
 * Regenerate: npm run generate:report-fixtures -w continuous-evidence
 *
 * Every value is invented: no real key, token, host or user data.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { ConfigDefaults } from '../../config/defaults.js';
import { OUTCOMES } from '../../outcome/types.js';
import { RunRecordSchema, type RunRecord } from '../schema.js';
import { render } from './render.js';

const [SKIPPED_O, EVIDENCED_O, UNSUPPORTED_O, ERROR_O] = OUTCOMES;

type Variant<O extends RunRecord['outcome']> = Extract<RunRecord, { outcome: O }>;

const STARTED_AT = '2026-01-15T10:00:00.000Z';
const CLAIM_TEXT = 'The empty inbox shows a "No messages" state instead of a blank list.';

const provenance = { provider: 'cli' as const, ref: 'demo-claim' };

const claims = [{ id: 'c1', text: CLAIM_TEXT, probability: 0.93, provenance }];

const context = {
  change: {
    title: 'Show an empty state in the inbox',
    base: 'main',
    head: 'feature/inbox-empty-state',
    files: [
      { path: 'examples/demo-app/src/inbox.js', status: 'modified' as const, provenance: { provider: 'git' as const } },
    ],
    commits: 1,
    claims: [{ text: CLAIM_TEXT, provenance }],
    provenance: [{ provider: 'git' as const }, provenance],
  },
  candidates: [{ id: 'c1', text: CLAIM_TEXT, provenance }],
  checks: [{ name: 'unit tests', status: 'passed' as const, provenance: { provider: 'junit' as const } }],
  providers: [
    { name: 'git' as const, status: 'used' as const },
    { name: 'cli' as const, status: 'used' as const },
  ],
  truncated: [],
  redactions: [],
};

function assessment(
  overrides: Partial<Variant<typeof EVIDENCED_O>['assessment']> = {},
): Variant<typeof EVIDENCED_O>['assessment'] {
  return {
    required: true,
    decidedBy: 'classifier',
    surface: 'browser_ui',
    claimStatus: 'identified',
    perClaimProbabilities: [{ claimId: 'c1', runtimeObservable: 0.91, checksAdequate: 0.22 }],
    questions: [
      { idVersion: 'claim.is_behavior@1', subjectId: 'c1', probability: 0.93, probabilities: null },
      { idVersion: 'assess.runtime_observable@1', subjectId: 'c1', probability: 0.91, probabilities: null },
      { idVersion: 'assess.checks_adequate@1', subjectId: 'c1', probability: 0.22, probabilities: null },
      {
        idVersion: 'assess.surface@1',
        subjectId: 'c1',
        probability: null,
        probabilities: { browser_ui: 0.95, cli: 0.03, http_api: 0.02 },
      },
    ],
    settings: {
      claimThreshold: 0.6,
      observableThreshold: 0.6,
      adequateThreshold: 0.7,
      uncertaintyBand: 0.1,
      onUncertain: 'evidence',
    },
    ...overrides,
  };
}

const common = {
  schemaVersion: '2' as const,
  ceVersion: '0.1.1',
  jevModels: ['typesafe/jev-1.14-2026-01-01'],
  config: ConfigDefaults,
};

function timings(durationMs: number, runtime: number | null): RunRecord['timings'] {
  return {
    startedAt: STARTED_AT,
    durationMs,
    stages: { config: 4, context: 38, assessment: 612, runtime },
  };
}

/** Relative screenshot paths the EVIDENCED record points to. */
export const FIXTURE_SCREENSHOTS = ['screenshots/step-0.png', 'screenshots/step-1.png', 'screenshots/final.png'] as const;

function evidenced(): Variant<typeof EVIDENCED_O> {
  return {
    ...common,
    outcome: EVIDENCED_O,
    outcomeReason: 'evidence-collected',
    context,
    claims,
    assessment: assessment(),
    subject: 'http://localhost:4173',
    steps: [
      {
        step: 0,
        url: 'http://localhost:4173/',
        title: 'Demo app',
        action: { kind: 'click', description: 'Click the "Inbox" link' },
        executed: true,
        screenshot: FIXTURE_SCREENSHOTS[0],
        probabilities: { 'link-inbox': 0.88, 'button-compose': 0.07, done: 0.05 },
        alternatives: [
          { key: 'link-inbox', description: 'Click the "Inbox" link', probability: 0.88 },
          { key: 'button-compose', description: 'Click the "Compose" button', probability: 0.07 },
          { key: 'done', description: '', probability: 0.05 },
        ],
      },
      {
        step: 1,
        url: 'http://localhost:4173/inbox',
        title: 'Inbox',
        action: { kind: 'done', description: '' },
        executed: true,
        screenshot: FIXTURE_SCREENSHOTS[1],
        probabilities: { done: 0.9, 'link-home': 0.1 },
        alternatives: [
          { key: 'done', description: '', probability: 0.9 },
          { key: 'link-home', description: 'Click the "Home" link', probability: 0.1 },
        ],
      },
    ],
    eventLog: [],
    finalImage: {
      model: 'typesafe/jev-1.14-2026-01-01',
      error: null,
      screenshot: FIXTURE_SCREENSHOTS[2],
      box: { x: 0.2, y: 0.3, width: 0.6, height: 0.4 },
      signals: { stateReachedDom: 0.84, stateReached: 0.9 },
    },
    runtime: { stopReason: 'done' },
    finalState: 'reached',
    error: null,
    artifacts: [
      ...FIXTURE_SCREENSHOTS.map((p) => ({ path: p, kind: 'screenshot' as const })),
      { path: 'jev-calls.jsonl', kind: 'jev-calls' as const },
    ],
    timings: timings(9400, 8700),
  };
}

function notRun(
  outcome: typeof SKIPPED_O | typeof UNSUPPORTED_O,
  outcomeReason: 'not-required' | 'surface-unsupported',
  a: Variant<typeof EVIDENCED_O>['assessment'],
): RunRecord {
  return {
    ...common,
    outcome,
    outcomeReason,
    context,
    claims,
    assessment: a,
    subject: null,
    steps: [],
    eventLog: [],
    finalImage: null,
    runtime: null,
    finalState: null,
    error: null,
    artifacts: [{ path: 'jev-calls.jsonl', kind: 'jev-calls' }],
    timings: timings(700, null),
  };
}

function errored(): Variant<typeof ERROR_O> {
  return {
    ...common,
    outcome: ERROR_O,
    outcomeReason: 'stage-error',
    context,
    claims,
    assessment: assessment(),
    subject: 'http://localhost:4173',
    steps: [],
    eventLog: [],
    finalImage: null,
    runtime: null,
    finalState: null,
    error: { stage: 'runtime', reason: 'stage-error', causeName: 'TargetNotReadyError', fields: [] },
    artifacts: [{ path: 'jev-calls.jsonl', kind: 'jev-calls' }],
    timings: timings(30900, 30100),
  };
}

/** Fixture directory name to validated record. */
export function fixtureRecords(): Record<'skipped' | 'evidenced' | 'unsupported' | 'error', RunRecord> {
  return {
    skipped: RunRecordSchema.parse(
      notRun(
        SKIPPED_O,
        'not-required',
        assessment({ required: false, perClaimProbabilities: [{ claimId: 'c1', runtimeObservable: 0.8, checksAdequate: 0.95 }] }),
      ),
    ),
    evidenced: RunRecordSchema.parse(evidenced()),
    unsupported: RunRecordSchema.parse(
      notRun(
        UNSUPPORTED_O,
        'surface-unsupported',
        assessment({
          surface: 'http_api',
          perClaimProbabilities: [{ claimId: 'c1', runtimeObservable: 0.9, checksAdequate: 0.2 }],
        }),
      ),
    ),
    error: RunRecordSchema.parse(errored()),
  };
}

export function fixturesDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A 160x100 RGB PNG: a dark page with a lighter panel, shifted per variant. Deterministic. */
export function makePng(variant: number): Buffer {
  const w = 160;
  const h = 100;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const inPanel = x >= 32 && x < 128 && y >= 30 + variant * 4 && y < 70;
      const [r, g, b] = inPanel ? [70, 90, 130] : [24, 28, 36];
      const o = row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function generateFixtures(): void {
  const root = fixturesDir();
  for (const [name, record] of Object.entries(fixtureRecords())) {
    const dir = path.join(root, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(dir, 'report.html'), render(record), 'utf8');
    if (name === 'evidenced') {
      FIXTURE_SCREENSHOTS.forEach((rel, i) => {
        const file = path.join(dir, rel);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, makePng(i));
      });
    }
    console.log(`wrote ${dir}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateFixtures();
}
