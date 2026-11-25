import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HarnessCallResult } from './call.js';
import { aggregateModelIds } from './models.js';
import { assertNoEnvLeak } from './sanitize.js';
import type { LatencyCheckResult, LatencyRequestSummary } from '../checks/latency.js';
import type { AttemptRecord, MixedStateResult } from '../checks/mixed-state.js';
import type { PrimitivesOutput } from '../checks/primitives.js';

export const DEFAULT_FINDINGS_PATH = 'docs/journal/v0.0/spike-jev-openrouter.md';

/** Section titles, in the required order (R5.1). */
export const SECTION_TITLES = [
  'Primitive compatibility',
  'Mixed text and image state',
  'Latency',
  'Model identification',
] as const;

export interface FindingsInput {
  /** A check that did not run is passed as null/undefined and written as `not confirmed`. */
  primitives?: PrimitivesOutput | null;
  mixedState?: MixedStateResult | null;
  latency?: LatencyCheckResult | null;
  /** Cause shown for a check that is absent from the input. */
  notRunReasons?: { primitives?: string; mixedState?: string; latency?: string };
  runDate: string;
  sdkVersion: string;
  nodeVersion: string;
  pinnedModel: string;
  /** Name of the dated samples directory. */
  samplesDir: string;
  /** Free-text; left as a TODO when not given, since it cannot be inferred. */
  networkLocation?: string;
  timeOfDay?: string;
}

const TODO = (what: string) => `**TODO (human reviewer): ${what}**`;
const NOT_CONFIRMED = (cause: string) => `not confirmed. Cause: ${cause}. No result is inferred.`;
const STATUS_TODO = TODO('set status to `confirmed`, `confirmed with differences`, or `not confirmed`');
const cell = (v: unknown) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const fmt = (n: number) => (Number.isFinite(n) ? `${Math.round(n)} ms` : 'n/a');
const json = (v: unknown) => '`' + cell(JSON.stringify(v)) + '`';

function callLine(c: HarnessCallResult): string {
  const name = c.label ? `${c.requestType}: ${c.label}` : c.requestType;
  if (c.ok) return `| ${cell(name)} | ${c.provider} | ok | ${cell(c.modelReturned ?? 'none')} | ${Math.round(c.latencyMs)} ms |`;
  const why = [c.errorClass, c.httpStatus !== undefined ? `HTTP ${c.httpStatus}` : null, c.errorMessage?.slice(0, 400)].filter(Boolean).join(': ');
  return `| ${cell(name)} | ${c.provider} | failed (${cell(why)}) | none | ${Math.round(c.latencyMs)} ms |`;
}

function callsTable(calls: HarnessCallResult[]): string[] {
  return ['| Request | Provider | Outcome | Model_Id | Latency |', '| --- | --- | --- | --- | --- |', ...calls.map(callLine)];
}

function primitivesSection(p: PrimitivesOutput | null | undefined, reason: string): string[] {
  const out = ['## 1. Primitive compatibility', '', '### Method', '',
    'One `choice`, one `noul`, and one `score` probe were sent through the OpenRouter route with the Pinned_Model, on a synthetic state. Each answer was compared with the SDK_Types shape. Question text is local to the harness.', '',
    '### Result', ''];
  if (!p) out.push(NOT_CONFIRMED(reason));
  else {
    out.push(...callsTable(p.results), '', 'Conformance differences:', '');
    for (const c of p.conformance) {
      if (!c.compared) out.push(`- ${c.requestType}: not compared (call failed, no answer to compare).`);
      else if (c.entries.length === 0) out.push(`- ${c.requestType}: no differences observed.`);
      else for (const e of c.entries) out.push(`- ${c.requestType}: field \`${e.field}\` expected ${e.expectedType}, observed ${json(e.observedValue)}.`);
    }
  }
  out.push('', `**Status:** ${STATUS_TODO}`, '');
  return out;
}

function attemptLines(label: string, a: AttemptRecord | null): string[] {
  if (!a) return [`- ${label}: not run.`];
  const o = a.modelOverride;
  const lines = [`- ${label}: ${a.call.ok ? 'call succeeded' : `call failed (${cell(a.call.errorClass ?? 'unknown')}${a.call.httpStatus !== undefined ? `, HTTP ${a.call.httpStatus}` : ''})`}. Model requested: \`${o.used}\`${o.overridden ? ` (override of pinned \`${o.pinned}\`${o.reason ? `: ${cell(o.reason)}` : ''})` : ' (pinned model)'}.`];
  if (a.shape) {
    const s = a.shape;
    lines.push(`  - noul present: ${s.noulPresent}; box present: ${s.boxPresent}.`);
    if (s.box.present) {
      lines.push(`  - box coordinates: ${json(s.box.coordinates)}; fractions in [0, 1]: ${s.box.fractionsInUnitRange}; edges ordered (top < bottom, left < right): ${s.box.edgesOrdered}.`);
      lines.push(`  - coordinate convention (${s.box.convention.source}): origin ${s.box.convention.origin}, ${s.box.convention.unit}.`);
    }
    const diffs = [...s.conformance.noul, ...s.conformance.box];
    for (const e of diffs) lines.push(`  - conformance: field \`${e.field}\` expected ${e.expectedType}, observed ${json(e.observedValue)}.`);
  }
  return lines;
}

function mixedSection(m: MixedStateResult | null | undefined, reason: string): string[] {
  const out = ['## 2. Mixed text and image state', '', '### Method', '',
    'One request combined text and an `image_url` part (the demo-app screenshot fixture) and asked for `noul` and `box`. The `TypeSafe-Danger-Zone-Images: true` header was sent. The request was repeated with the image removed. On failure or an absent `box`, separate `noul` and `box` requests and the `typesafe` provider were tried as fallbacks.', '',
    '### Result', ''];
  if (!m) out.push(NOT_CONFIRMED(reason));
  else if (m.status === 'not-run') out.push(NOT_CONFIRMED(m.notRunReason ?? 'the check did not run (no cause recorded)'));
  else {
    out.push(`Image header sent: ${m.imageHeaderSent}. Fixture: \`${cell(m.fixturePath)}\`.`, '',
      ...attemptLines('With image', m.withImage), ...attemptLines('Without image', m.withoutImage), '',
      `Response shape changed without image: ${m.shapeChangedWithoutImage ?? 'not determined'}${m.shapeComparisonNote ? ` (${cell(m.shapeComparisonNote)})` : ''}.`, '',
      'Fallbacks:', '');
    if (m.fallbacks.length === 0) out.push('- none attempted.');
    for (const f of m.fallbacks) {
      if (f.status === 'ran') out.push(...attemptLines(`${f.step}`, f.attempt));
      else out.push(`- ${f.step}: ${f.status}${f.reason ? `. Cause: ${cell(f.reason)}` : ''}.`);
    }
    out.push('', 'Diagnostic attempts:', '');
    if (m.diagnostics.length === 0) out.push('- none attempted.');
    else out.push(...callsTable(m.diagnostics.map((d) => ({ ...d.call, label: d.label }))));
    out.push('', `Box encloses subject: ${TODO('judge from the sample image and box coordinates')}`);
  }
  out.push('', `**Status:** ${STATUS_TODO}`, '');
  return out;
}

function latencyBlock(name: string, s: LatencyRequestSummary, budgetMs: number): string[] {
  const out = [`#### ${name}`, ''];
  if (s.status === 'not-run') return [...out, NOT_CONFIRMED(s.reason ?? 'the check did not run (no cause recorded)'), ''];
  const st = s.stats;
  out.push(`- Model requested: \`${s.modelRequested}\`. Samples requested: ${s.requestedSamples}; successful: ${st.count}; failures: ${st.failures}.`);
  out.push(`- p50 ${fmt(st.p50)}, p95 ${fmt(st.p95)}, min ${fmt(st.min)}, max ${fmt(st.max)} (successful samples only).`);
  if (s.optionCount !== undefined) out.push(`- Options offered: ${s.optionCount}.`);
  out.push(`- Reported input tokens: ${s.inputTokens.length ? s.inputTokens.join(', ') : 'none reported'}.`);
  if (s.rateLimits.length === 0) out.push('- Rate limiting or `retry-after`: none observed.');
  else for (const r of s.rateLimits) out.push(`- Rate limit: ${r.requestType} sample ${r.sampleIndex}${r.httpStatus !== undefined ? `, HTTP ${r.httpStatus}` : ''}${r.retryAfter ? `, retry-after ${cell(r.retryAfter)}` : ''}.`);
  const fit = (v: boolean | null) => (v === null ? 'not determined (no successful samples)' : v ? 'within' : 'over');
  out.push(`- Per-step budget fit (${(budgetMs / 1000).toFixed(1)} s per step): p50 ${fit(s.budget.p50WithinBudget)}; p95 ${fit(s.budget.p95WithinBudget)}.`, '');
  return out;
}

function latencySection(l: LatencyCheckResult | null | undefined, reason: string): string[] {
  const out = ['## 3. Latency', '', '### Method', '',
    'Sequential samples of a Next_Action_Request (text only, about 100 locally invented options) and a Final_Image_Request (screenshot, `noul` and `box`), with no retries. Statistics use successful samples only; failures are counted separately.', '',
    '### Result', ''];
  if (!l) out.push(NOT_CONFIRMED(reason));
  else {
    const b = l.budget;
    out.push(`Stated budget: ${b.timeoutSeconds} s timeout over ${b.steps} steps, which is ${(b.perStepMs / 1000).toFixed(1)} s per step.`, '',
      ...latencyBlock('Next_Action_Request', l.nextAction, b.perStepMs), ...latencyBlock('Final_Image_Request', l.finalImage, b.perStepMs),
      ...(l.diagnostics.length > 0 ? ['#### Final-image diagnostics', '', ...callsTable(l.diagnostics), ''] : []),
      `Budget fit statement: ${TODO('state fit or no fit against the per-step budget, based on the figures above')}`);
  }
  out.push('', '### Measurement limits', '');
  return out;
}

export function allCalls(i: FindingsInput): HarnessCallResult[] {
  return [...(i.primitives?.results ?? []), ...(i.mixedState?.calls ?? []), ...(i.latency?.calls ?? [])];
}

/** Pure: build the draft Findings_Document markdown. */
export function buildFindings(input: FindingsInput): string {
  const r = input.notRunReasons ?? {};
  const calls = allCalls(input);
  const counts = aggregateModelIds(calls);
  const sampleCount = calls.length;
  const lat = latencySection(input.latency, r.latency ?? 'the latency check was not run');
  lat.push(
    `- Sample count: ${input.latency ? `${input.latency.nextAction.requestedSamples} requested per request type` : 'none'}; ${sampleCount} calls in the whole run.`,
    `- Time of day: ${input.timeOfDay ?? `${input.runDate} (run start; local time zone not recorded)`}.`,
    `- Network location: ${input.networkLocation ?? TODO('record where the run was made from')}.`,
    '- Single run: yes. Results are one run and do not show variation between runs or days.',
    '',
    `**Status:** ${STATUS_TODO}`,
    '',
  );

  const modelLines = ['## 4. Model identification', '', '### Method', '',
    'The Model_Id of every successful response was read from the `model` field of the response body and counted per request type. Failed calls are excluded.', '', '### Result', '',
    `- Pinned_Model: \`${input.pinnedModel}\`.`,
    '- Model_Id field location: `model` in the response body.'];
  const types = Object.keys(counts);
  if (types.length === 0) modelLines.push('- Distinct Model_Ids: none returned. Not confirmed: no successful response carried a Model_Id.');
  else {
    modelLines.push('- Distinct Model_Ids with counts, per request type:');
    for (const t of types) modelLines.push(`  - ${t}: ${Object.entries(counts[t]).map(([id, n]) => `\`${cell(id)}\` x ${n}`).join(', ')}`);
  }
  modelLines.push('', `**Status:** ${STATUS_TODO}`, '');

  const lines = [
    '# Spike findings: Jev via OpenRouter (DRAFT)', '',
    '> Draft generated by the spike harness. Items marked TODO need the human reviewer. Nothing below is inferred where a check could not run.', '',
    '## Run information', '',
    `- Run date: ${input.runDate}`,
    `- SDK version: \`@typesafe-ai/sdk\` ${input.sdkVersion}`,
    `- Node.js version: ${input.nodeVersion}`,
    `- Pinned_Model: \`${input.pinnedModel}\``,
    `- Samples directory: \`${input.samplesDir}\``, '',
    ...primitivesSection(input.primitives, r.primitives ?? 'the primitives check was not run'),
    ...mixedSection(input.mixedState, r.mixedState ?? 'the mixed-state check was not run'),
    ...lat,
    ...modelLines,
    '## Design consequences', '',
    TODO('list each affected design.md section or journal requirement (or "no change needed"), and report any contradiction with SPEC.md without editing SPEC.md'), '',
  ];
  return lines.join('\n');
}

/** Build, check for credential leaks, then write the draft. Returns the path written. */
export function writeFindings(input: FindingsInput, path: string = DEFAULT_FINDINGS_PATH): string {
  const text = buildFindings(input);
  assertNoEnvLeak(text);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}
