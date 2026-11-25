/**
 * Probe_Library: the logic of the manual live verification (Requirements 14 to 17).
 *
 * Holds the Probe_Functions (real gateway and transports), the network-free logic (latency
 * statistics, request shapes, Answer_Status text, Markdown summaries, sample sanitizer) and the
 * pure run planner. Never throws for an HTTP failure. Calls no SDK question helper (those live
 * in `catalog.ts`) and no `fetch` itself (that lives in `transport-json.ts`).
 */
import type { Fetch as SdkFetch } from '@typesafe-ai/sdk';
import { StageError } from '../errors.js';
import { BASE_URLS, HybridJevGateway } from './gateway.js';
import { CATALOG, finalImageQuestions } from './catalog.js';
import { createSdkTransport } from './transport-sdk.js';
import { createJsonTransport, detectImageFormat } from './transport-json.js';
import type { JsonFetch, JsonTransport } from './transport-json.js';
import type { Jev_Request } from './types.js';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface ProbeOptions {
  provider: 'openrouter' | 'typesafe';
  apiKey: string;
  model: string;
  imageBytes?: Uint8Array;
  /** Sent only by the JSON transport and only for provider `typesafe`. Default false. */
  dangerZoneHeader?: boolean;
  fetch?: JsonFetch;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  /** Returned_Model_Id on success. */
  model?: string;
  usage?: { input_tokens: number | null; output_tokens: number | null };
  status?: number;
  /** Sanitized: no key, no Authorization header, no image bytes. */
  errorText?: string;
  /** Answers of a successful call, for the image_url item (the answer content is not secret). */
  answers?: Record<string, unknown>;
}

export interface ClaimProbeOptions extends ProbeOptions {
  claim: string;
}

export interface LatencyStats {
  p50: number;
  p95: number;
  min: number;
  max: number;
  count: number;
  failures: number;
}

const TEXT_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 30_000;
const MAX_ERROR_TEXT = 300;
const DEFAULT_TEXT_CLAIM = 'The page shows a confirmation message after the form is submitted.';

// ---------------------------------------------------------------------------------------------
// Sanitizing
// ---------------------------------------------------------------------------------------------

/** Removes keys, Authorization headers and long base64 runs, then truncates. */
export function sanitizeText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join('[redacted]');
  }
  out = out
    .replace(/Authorization\s*[:=]\s*\S+(\s+\S+)?/gi, 'Authorization: [redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9+/=_-]{200,}/g, '[image bytes removed]')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > MAX_ERROR_TEXT ? `${out.slice(0, MAX_ERROR_TEXT)}…` : out;
}

function statusOf(source: unknown): number | undefined {
  if (typeof source === 'object' && source !== null) {
    const status = (source as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status)) return status;
  }
  return undefined;
}

function failure(error: unknown, latencyMs: number, apiKey: string): ProbeResult {
  // A StageError message deliberately omits detail; the cause carries it.
  const source = error instanceof StageError ? error.cause : error;
  const status = statusOf(source) ?? statusOf(error);
  const raw =
    source instanceof Error
      ? `${source.name}: ${source.message}`
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : 'unknown error';
  return {
    ok: false,
    latencyMs,
    ...(status !== undefined ? { status } : {}),
    errorText: sanitizeText(raw, [apiKey]),
  };
}

function missingImage(): ProbeResult {
  return { ok: false, latencyMs: 0, errorText: 'imageBytes is required for an image probe' };
}

// ---------------------------------------------------------------------------------------------
// Gateway and transport construction
// ---------------------------------------------------------------------------------------------

function jsonTransportFor(options: ProbeOptions): JsonTransport {
  const inner = createJsonTransport({
    baseURL: BASE_URLS[options.provider],
    apiKey: options.apiKey,
    requestedModel: options.model,
    provider: options.provider,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
  const dangerZoneHeader = options.dangerZoneHeader === true;
  return { send: (request, sendOptions) => inner.send(request, { ...sendOptions, dangerZoneHeader }) };
}

function sdkTransportFor(options: ProbeOptions): ReturnType<typeof createSdkTransport> {
  return createSdkTransport({
    baseURL: BASE_URLS[options.provider],
    apiKey: options.apiKey,
    requestedModel: options.model,
    ...(options.fetch !== undefined ? { fetch: options.fetch as unknown as SdkFetch } : {}),
  });
}

function newGateway(options: ProbeOptions, maxRateLimitRetries: number): HybridJevGateway {
  return new HybridJevGateway({
    sdkTransport: sdkTransportFor(options),
    jsonTransport: jsonTransportFor(options),
    callLog: { append: () => Promise.resolve() },
    provider: options.provider,
    requestedModel: options.model,
    maxRateLimitRetries,
  });
}

async function timed(
  options: ProbeOptions,
  run: () => Promise<{ model: string; usage: ProbeResult['usage']; answers?: Record<string, unknown> }>,
): Promise<ProbeResult> {
  const started = performance.now();
  try {
    const result = await run();
    return {
      ok: true,
      latencyMs: Math.max(0, performance.now() - started),
      model: result.model,
      ...(result.usage !== undefined ? { usage: result.usage } : {}),
      ...(result.answers !== undefined ? { answers: result.answers } : {}),
    };
  } catch (error) {
    return failure(error, Math.max(0, performance.now() - started), options.apiKey);
  }
}

// ---------------------------------------------------------------------------------------------
// Probe_Functions
// ---------------------------------------------------------------------------------------------

/** One Text_Request through a new HybridJevGateway (SDK transport). */
export function sendText(options: ProbeOptions): Promise<ProbeResult> {
  return timed(options, async () => {
    const gateway = newGateway(options, 0);
    const response = await gateway.ask({
      stage: 'assessment',
      state: `claim: ${DEFAULT_TEXT_CLAIM}`,
      questions: { surface: CATALOG.assessSurface.built() },
    });
    return { model: response.model, usage: response.usage, answers: response.answers };
  });
}

/** One Final_Image_Request through a fresh gateway with rate-limit retries off. */
export function sendFinalImage(options: ClaimProbeOptions): Promise<ProbeResult> {
  const bytes = options.imageBytes;
  if (bytes === undefined) return Promise.resolve(missingImage());
  return timed(options, async () => {
    const gateway = newGateway(options, 0);
    const response = await gateway.ask(finalImageQuestions(options.claim, bytes));
    return { model: response.model, usage: response.usage, answers: response.answers };
  });
}

/** One Image_Request through the SDK transport directly, bypassing the gateway routing. */
export function sendSdkImage(options: ClaimProbeOptions): Promise<ProbeResult> {
  const bytes = options.imageBytes;
  if (bytes === undefined) return Promise.resolve(missingImage());
  return timed(options, async () => {
    const result = await sdkTransportFor(options).send(finalImageQuestions(options.claim, bytes), {
      timeoutMs: IMAGE_TIMEOUT_MS,
    });
    return { model: result.model, usage: result.usage, answers: result.answers };
  });
}

/** One array-form request through the JSON transport. */
export function sendImageUrlForm(options: ClaimProbeOptions): Promise<ProbeResult> {
  const bytes = options.imageBytes;
  if (bytes === undefined) return Promise.resolve(missingImage());
  return timed(options, async () => {
    const body = buildImageUrlRequestBody(options.claim, bytes, options.model);
    // The JSON transport serializes `state` and `questions` as given, and adds an empty `assets`
    // object because the state holds no SDK Image. That reproduces `body` on the wire.
    const request: Jev_Request = {
      stage: 'runtime',
      state: body.state as unknown as string,
      questions: { state_reached: CATALOG.runtimeStateReached.built() },
    };
    const result = await jsonTransportFor(options).send(request, { timeoutMs: IMAGE_TIMEOUT_MS });
    return { model: result.model, usage: result.usage, answers: result.answers };
  });
}

// ---------------------------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------------------------

export interface ImageUrlRequestBody {
  model: string;
  state: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  >;
  questions: Record<string, unknown>;
}

/** Text of the shape, for the Findings_Document. */
export const IMAGE_URL_SHAPE_DESCRIPTION =
  'Best-effort OpenAI-style content array: state = [{type:"text", text}, {type:"image_url", ' +
  'image_url:{url:"data:<mime>;base64,<bytes>"}}]. The fetched TypeSafe API reference documents ' +
  'no such shape (only data_base64 assets), so this is a probe, not a documented form.';

/** Best-effort array form with one text part and one `image_url` part, plus one noul question. */
export function buildImageUrlRequestBody(
  claim: string,
  pngBytes: Uint8Array,
  model: string,
): ImageUrlRequestBody {
  const mime = detectImageFormat(pngBytes) === 'jpeg' ? 'image/jpeg' : 'image/png';
  return {
    model,
    state: [
      { type: 'text', text: `claim: ${claim}` },
      {
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${Buffer.from(pngBytes).toString('base64')}` },
      },
    ],
    questions: { state_reached: CATALOG.runtimeStateReached.build() },
  };
}

// ---------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const rank = Math.ceil((p * sorted.length) / 100);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

/** Nearest-rank statistics over successful samples. Empty list gives NaN and never throws. */
export function computeLatencyStats(samples: number[], failureCount: number): LatencyStats {
  if (samples.length === 0) {
    return { p50: NaN, p95: NaN, min: NaN, max: NaN, count: 0, failures: failureCount };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    count: sorted.length,
    failures: failureCount,
  };
}

// ---------------------------------------------------------------------------------------------
// Answer_Status text and Markdown summaries
// ---------------------------------------------------------------------------------------------

export type AnswerStatus =
  | { kind: 'confirmed' }
  | { kind: 'not_supported' }
  | { kind: 'blocked'; variable: string };

export function answerStatusText(status: AnswerStatus): string {
  switch (status.kind) {
    case 'confirmed':
      return 'confirmed';
    case 'not_supported':
      return 'not supported';
    case 'blocked':
      return `not tested (blocked: ${status.variable} not set)`;
  }
}

/** Per-step latency budget of design section 5. */
export const STEP_BUDGET_MS = 7500;

function ms(value: number): string {
  return Number.isNaN(value) ? 'n/a' : `${Math.round(value)} ms`;
}

export interface LatencySummaryInput {
  date: string;
  requests: number;
  stats: LatencyStats;
  model: string | undefined;
  provider: string;
  transport: string;
  samplesDir: string;
  failureStatus?: number;
  failureText?: string;
}

export function latencySummaryMarkdown(input: LatencySummaryInput): string {
  const { stats } = input;
  const lines = ['### Final-image latency', ''];
  lines.push(`- Date: ${input.date}`);
  lines.push(`- Requests sent: ${input.requests}`);
  lines.push(`- Successes: ${stats.count}, failures: ${stats.failures}`);
  lines.push(`- Provider: ${input.provider}, transport: ${input.transport}`);
  lines.push(`- Returned model id: ${input.model ?? 'n/a'}`);
  if (stats.count === 0) {
    lines.push(`- Answer_Status: ${answerStatusText({ kind: 'not_supported' })}`);
    lines.push(`- HTTP status: ${input.failureStatus ?? 'none'}`);
    lines.push(`- Error: ${input.failureText ?? 'n/a'}`);
  } else {
    lines.push(`- p50: ${ms(stats.p50)}, p95: ${ms(stats.p95)}, min: ${ms(stats.min)}, max: ${ms(stats.max)}`);
    lines.push(
      `- p95 below the ${STEP_BUDGET_MS} ms per-step budget: ${stats.p95 < STEP_BUDGET_MS ? 'yes' : 'no'}`,
    );
  }
  lines.push(`- Raw samples: ${input.samplesDir}`);
  return lines.join('\n');
}

/** Claim that is TRUE for the fixture screenshot (a counter showing 0). */
export const IMAGE_URL_TRUE_CLAIM = 'The page shows a counter with value 0';
/** Claim that is FALSE for the fixture screenshot (no form, no confirmation message). */
export const IMAGE_URL_FALSE_CLAIM =
  'The page shows a confirmation message after the form is submitted.';

/**
 * Judging rule for the array form. The image was used only if the noul for the TRUE claim is
 * clearly higher than the noul for the FALSE claim: true >= 0.5 and false <= 0.5 and a gap of at
 * least 0.3. A low noul alone proves nothing, since a model ignoring the image would give it too.
 */
export const IMAGE_URL_TRUE_MIN = 0.5;
export const IMAGE_URL_FALSE_MAX = 0.5;
export const IMAGE_URL_MIN_GAP = 0.3;

/** Reads the noul probability of one question from a result's answers. */
export function noulOf(result: ProbeResult, name: string): number | undefined {
  const answer = result.answers?.[name];
  if (typeof answer === 'object' && answer !== null) {
    const value = (answer as { noul?: unknown }).noul;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function judgeImageUrl(trueNoul: number | undefined, falseNoul: number | undefined): boolean {
  if (trueNoul === undefined || falseNoul === undefined) return false;
  return (
    trueNoul >= IMAGE_URL_TRUE_MIN &&
    falseNoul <= IMAGE_URL_FALSE_MAX &&
    trueNoul - falseNoul >= IMAGE_URL_MIN_GAP
  );
}

export interface ImageUrlSummaryInput {
  date: string;
  /** Result for the TRUE claim. */
  trueResult: ProbeResult;
  /** Result for the FALSE claim. */
  falseResult: ProbeResult;
  /** Name of the noul question. */
  question: string;
  samplesDir: string;
}

export function imageUrlSummaryMarkdown(input: ImageUrlSummaryInput): string {
  const { trueResult, falseResult, question } = input;
  const trueNoul = noulOf(trueResult, question);
  const falseNoul = noulOf(falseResult, question);
  const confirmed = trueResult.ok && falseResult.ok && judgeImageUrl(trueNoul, falseNoul);
  const fmt = (n: number | undefined): string => (n === undefined ? 'n/a' : String(n));
  const lines = ['### image_url array form', ''];
  lines.push(`- Date: ${input.date}`);
  lines.push(`- Request shape: ${IMAGE_URL_SHAPE_DESCRIPTION}`);
  for (const [label, claim, r, n] of [
    ['TRUE claim', IMAGE_URL_TRUE_CLAIM, trueResult, trueNoul],
    ['FALSE claim', IMAGE_URL_FALSE_CLAIM, falseResult, falseNoul],
  ] as const) {
    lines.push(`- ${label} (${JSON.stringify(claim)}): HTTP status ${r.status ?? (r.ok ? 200 : 'none')}`);
    if (r.ok) {
      lines.push(`  - noul: ${fmt(n)}, model: ${r.model ?? 'n/a'}, usage: ${JSON.stringify(r.usage ?? {})}`);
    } else {
      lines.push(`  - Error: ${r.errorText ?? 'n/a'}`);
    }
  }
  lines.push(
    `- Judging: confirmed only if true noul >= ${IMAGE_URL_TRUE_MIN}, false noul <= ${IMAGE_URL_FALSE_MAX} and gap >= ${IMAGE_URL_MIN_GAP}`,
  );
  lines.push(
    `- Gap (true - false): ${trueNoul !== undefined && falseNoul !== undefined ? (trueNoul - falseNoul).toFixed(3) : 'n/a'}`,
  );
  lines.push(`- Answer_Status: ${answerStatusText(confirmed ? { kind: 'confirmed' } : { kind: 'not_supported' })}`);
  lines.push(`- Raw samples: ${input.samplesDir}`);
  return lines.join('\n');
}

export interface TypesafeSummaryInput {
  date: string;
  text: ProbeResult;
  imageJson: ProbeResult;
  /** Present only when the first JSON request was rejected and was repeated with the header. */
  imageJsonWithHeader?: ProbeResult;
  imageSdk: ProbeResult;
  model: string;
  samplesDir: string;
}

function resultLine(label: string, r: ProbeResult): string {
  return `- ${label}: ${r.ok ? 'accepted' : 'rejected'}, status ${r.status ?? (r.ok ? 200 : 'none')}, ${ms(r.latencyMs)}${
    r.ok ? `, model ${r.model ?? 'n/a'}` : `, error ${r.errorText ?? 'n/a'}`
  }`;
}

export function typesafeSummaryMarkdown(input: TypesafeSummaryInput): string {
  const all = [input.text, input.imageJson, input.imageJsonWithHeader, input.imageSdk];
  const anyOk = all.some((r) => r?.ok === true);
  const lines = ['### Direct typesafe provider', ''];
  lines.push(`- Date: ${input.date}`);
  lines.push(`- Requested model: ${input.model}`);
  lines.push(resultLine('Text request (SDK)', input.text));
  lines.push(resultLine('Image request (JSON, no header)', input.imageJson));
  if (input.imageJsonWithHeader !== undefined) {
    lines.push(resultLine('Image request (JSON, with TypeSafe-Danger-Zone-Images)', input.imageJsonWithHeader));
  }
  lines.push(resultLine('Image request (SDK multipart)', input.imageSdk));
  lines.push(`- SDK multipart image accepted: ${input.imageSdk.ok ? 'yes' : 'no'}`);
  lines.push(
    `- JSON transport needs the header: ${
      input.imageJson.ok ? 'no' : input.imageJsonWithHeader?.ok === true ? 'yes' : 'not established'
    }`,
  );
  lines.push(
    `- Answer_Status: ${answerStatusText(anyOk ? { kind: 'confirmed' } : { kind: 'not_supported' })}`,
  );
  lines.push(`- Raw samples: ${input.samplesDir}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Sample sanitizer
// ---------------------------------------------------------------------------------------------

export interface SampleInput {
  probe: string;
  result: ProbeResult;
  questionNames?: readonly string[];
}

export interface SanitizedSample {
  probe: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  model?: string;
  usage?: ProbeResult['usage'];
  questionNames: string[];
  /** Noul probability per question name. Numbers only: no text, no keys, no image data. */
  noul?: Record<string, number>;
  errorText?: string;
}

function numericNoul(answers: Record<string, unknown> | undefined): Record<string, number> | undefined {
  if (answers === undefined) return undefined;
  const out: Record<string, number> = {};
  for (const [name, answer] of Object.entries(answers)) {
    if (typeof answer !== 'object' || answer === null) continue;
    const value = (answer as { noul?: unknown }).noul;
    if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Keeps only whitelisted fields, so no key, Authorization header or image bytes can enter. */
export function sanitizeSample(sample: SampleInput, secrets: readonly string[] = []): SanitizedSample {
  const { result } = sample;
  return {
    probe: sample.probe,
    ok: result.ok,
    ...(result.status !== undefined ? { status: result.status } : {}),
    latencyMs: result.latencyMs,
    ...(result.model !== undefined ? { model: result.model } : {}),
    ...(result.usage !== undefined ? { usage: result.usage } : {}),
    questionNames: [...(sample.questionNames ?? [])],
    ...(numericNoul(result.answers) !== undefined ? { noul: numericNoul(result.answers) as Record<string, number> } : {}),
    ...(result.errorText !== undefined ? { errorText: sanitizeText(result.errorText, secrets) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Run plan
// ---------------------------------------------------------------------------------------------

export type VerificationCommand = 'latency' | 'image-url' | 'typesafe' | 'all';
export type KeyVariable = 'OPENROUTER_API_KEY' | 'TYPESAFE_API_KEY';
export type ProbeFunctionName = 'sendText' | 'sendFinalImage' | 'sendSdkImage' | 'sendImageUrlForm';

export interface PlannedItem {
  item: 'latency' | 'image-url' | 'typesafe';
  provider: 'openrouter' | 'typesafe';
  keyVariable: KeyVariable;
  probes: ProbeFunctionName[];
}

export type RunPlan =
  | { exitCode: 2; message: string }
  | { exitCode: 3; variable: KeyVariable; status: string; message: string }
  | {
      exitCode: 0;
      items: PlannedItem[];
      /** Items skipped because their key is absent (`all` only), with the Answer_Status text. */
      blocked: Array<{ item: PlannedItem['item']; variable: KeyVariable; status: string }>;
    };

const ITEMS: Record<PlannedItem['item'], PlannedItem> = {
  latency: {
    item: 'latency',
    provider: 'openrouter',
    keyVariable: 'OPENROUTER_API_KEY',
    probes: ['sendFinalImage'],
  },
  'image-url': {
    item: 'image-url',
    provider: 'openrouter',
    keyVariable: 'OPENROUTER_API_KEY',
    probes: ['sendImageUrlForm'],
  },
  typesafe: {
    item: 'typesafe',
    provider: 'typesafe',
    keyVariable: 'TYPESAFE_API_KEY',
    probes: ['sendText', 'sendFinalImage', 'sendSdkImage'],
  },
};

function blockedStatus(variable: KeyVariable): string {
  return answerStatusText({ kind: 'blocked', variable });
}

/**
 * Plans a run. Reads `CI` first and no key before that check. Exit 2 in CI without `--allow-ci`.
 * Exit 3 when a key the command needs is empty or unset. For `all`, an absent TYPESAFE key
 * blocks only the typesafe item; an absent OPENROUTER key is exit 3. Never prints a value.
 */
export function planRun(
  command: VerificationCommand,
  env: Record<string, string | undefined>,
  allowCi: boolean,
): RunPlan {
  if (env['CI'] === 'true' && !allowCi) {
    return {
      exitCode: 2,
      message: 'Refusing to run live verification in CI. Pass --allow-ci to override.',
    };
  }
  const present = (variable: KeyVariable): boolean => (env[variable] ?? '').trim() !== '';
  const wanted: PlannedItem[] =
    command === 'all' ? [ITEMS.latency, ITEMS['image-url'], ITEMS.typesafe] : [ITEMS[command]];

  const items: PlannedItem[] = [];
  const blocked: Array<{ item: PlannedItem['item']; variable: KeyVariable; status: string }> = [];
  for (const planned of wanted) {
    if (present(planned.keyVariable)) {
      items.push(planned);
    } else if (command === 'all' && planned.keyVariable === 'TYPESAFE_API_KEY') {
      blocked.push({ item: planned.item, variable: planned.keyVariable, status: blockedStatus(planned.keyVariable) });
    } else {
      return {
        exitCode: 3,
        variable: planned.keyVariable,
        status: blockedStatus(planned.keyVariable),
        message: `${planned.keyVariable} is not set`,
      };
    }
  }
  return { exitCode: 0, items, blocked };
}
