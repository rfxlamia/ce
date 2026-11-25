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

export interface ImageUrlSummaryInput {
  date: string;
  result: ProbeResult;
  /** True when the answer reflects both the text and the image part. Decided by the reader. */
  usedBothParts: boolean | undefined;
  samplesDir: string;
}

export function imageUrlSummaryMarkdown(input: ImageUrlSummaryInput): string {
  const { result } = input;
  const status: AnswerStatus =
    result.ok && input.usedBothParts === true ? { kind: 'confirmed' } : { kind: 'not_supported' };
  const lines = ['### image_url array form', ''];
  lines.push(`- Date: ${input.date}`);
  lines.push(`- Request shape: ${IMAGE_URL_SHAPE_DESCRIPTION}`);
  lines.push(`- HTTP status: ${result.status ?? (result.ok ? 200 : 'none')}`);
  if (result.ok) {
    lines.push(`- Answer: ${JSON.stringify(result.answers ?? {})}`);
    lines.push(
      `- Answer used both parts: ${input.usedBothParts === undefined ? 'not judged yet' : input.usedBothParts ? 'yes' : 'no'}`,
    );
  } else {
    lines.push(`- Error: ${result.errorText ?? 'n/a'}`);
  }
  lines.push(`- Answer_Status: ${answerStatusText(status)}`);
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
  errorText?: string;
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
