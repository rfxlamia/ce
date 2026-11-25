import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLatencyCheck, DEFAULT_FIXTURE_PATH } from './checks/latency.js';
import { runMixedState } from './checks/mixed-state.js';
import { PINNED_MODEL, runPrimitives, type PrimitivesOutput } from './checks/primitives.js';
import type { LatencyCheckResult } from './checks/latency.js';
import type { MixedStateResult } from './checks/mixed-state.js';
import type { HarnessCallResult, RequestType } from './lib/call.js';
import { buildClient } from './lib/client.js';
import { loadEnv } from './lib/env.js';
import { writeFindings, DEFAULT_FINDINGS_PATH } from './lib/findings.js';
import { newDatedOutputDir, writeSample } from './lib/samples.js';
import { sanitizeRequest, sanitizeResponse } from './lib/sanitize.js';

/**
 * Single entry point for the spike (R8.5, R8.7). Run from the repository root:
 *   npx tsx spike/jev-openrouter/run.ts
 * Not wired into any root script.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SAMPLES_BASE = join(REPO_ROOT, 'docs', 'journal', 'v0.0', 'samples');
const FINDINGS_PATH = join(REPO_ROOT, DEFAULT_FINDINGS_PATH);

/** Request types whose request carries the screenshot (mixed-state variants and final image). */
const IMAGE_TYPES: ReadonlySet<RequestType> = new Set<RequestType>([
  'mixed_state',
  'mixed_state_split_noul',
  'mixed_state_split_box',
  'mixed_state_typesafe_provider',
  'final_image',
]);

function sdkVersion(): string {
  try {
    const pkg = join(HERE, 'node_modules', '@typesafe-ai', 'sdk', 'package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

function writeSamples(dir: string, calls: HarnessCallResult[], fixturePath: string): void {
  const image = existsSync(fixturePath) ? readFileSync(fixturePath) : null;
  const imageWritten = new Set<RequestType>();
  calls.forEach((c, i) => {
    const name = `${String(i + 1).padStart(3, '0')}-${c.requestType}${c.label ? `-${c.label.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60)}` : ''}`;
    // One copy of the screenshot per image-bearing request type, as a separate file.
    const attach = image !== null && IMAGE_TYPES.has(c.requestType) && !imageWritten.has(c.requestType);
    if (attach) imageWritten.add(c.requestType);
    try {
      writeSample(
        dir,
        name,
        {
          requestType: c.requestType,
          ...(c.label !== undefined ? { label: c.label } : {}),
          request: sanitizeRequest(c.raw.request),
          response: sanitizeResponse(c.raw.response),
          modelId: c.modelReturned ?? 'none',
          latencyMs: c.latencyMs,
        },
        attach && image ? { data: image, ext: 'png' } : undefined,
      );
    } catch (e) {
      // A sample that cannot be written safely is skipped, never written unsanitized.
      console.error(`Sample ${name} not written: ${errMsg(e)}`);
    }
  });
}

/** Where the run was made from. Set NETWORK_LOCATION (e.g. 'home Wi-Fi, Jakarta') before running. */
function networkLocation(): string {
  const v = process.env.NETWORK_LOCATION;
  return v && v.trim() !== '' ? v.trim() : 'not recorded';
}

async function main(): Promise<void> {
  // Env first. Exits (before any request) when OPENROUTER_API_KEY is missing.
  const env = loadEnv();

  const runDate = new Date().toISOString();
  const client = buildClient({ provider: 'openrouter' });
  const reasons: { primitives?: string; mixedState?: string; latency?: string } = {};
  let primitives: PrimitivesOutput | null = null;
  let mixedState: MixedStateResult | null = null;
  let latency: LatencyCheckResult | null = null;
  // Calls are collected as they happen, so a check that throws midway still has its samples written.
  const mixedSink: HarnessCallResult[] = [];
  const latencySink: HarnessCallResult[] = [];

  try {
    primitives = await runPrimitives(client);
  } catch (e) {
    reasons.primitives = `the primitives check threw: ${errMsg(e)}`;
  }
  try {
    mixedState = await runMixedState({ sink: mixedSink });
  } catch (e) {
    reasons.mixedState = `the mixed-state check threw: ${errMsg(e)}`;
  }
  try {
    latency = await runLatencyCheck({ client, sink: latencySink });
  } catch (e) {
    reasons.latency = `the latency check threw: ${errMsg(e)}`;
  }

  const calls = [...(primitives?.results ?? []), ...(mixedState ? mixedState.calls : mixedSink), ...(latency ? latency.calls : latencySink)];
  const samplesDir = newDatedOutputDir(SAMPLES_BASE);
  writeSamples(samplesDir, calls, mixedState?.fixturePath ?? DEFAULT_FIXTURE_PATH);

  const written = writeFindings(
    {
      primitives,
      mixedState,
      latency,
      notRunReasons: reasons,
      runDate,
      sdkVersion: sdkVersion(),
      nodeVersion: process.version,
      pinnedModel: PINNED_MODEL,
      networkLocation: networkLocation(),
      samplesDir: basename(samplesDir),
    },
    FINDINGS_PATH,
  );

  console.log(`TYPESAFE_API_KEY present: ${env.typesafeKeyPresent}`);
  console.log(`Samples: ${samplesDir}`);
  console.log(`Draft findings: ${written}`);
}

main().catch((e) => {
  console.error(`Spike run failed: ${errMsg(e)}`);
  process.exit(1);
});
