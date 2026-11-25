import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Image, box, noul } from '@typesafe-ai/sdk';
import { timedCall, type HarnessCallResult, type RequestType } from '../lib/call.js';
import { buildClient, type Provider } from '../lib/client.js';
import { diffAnswer, type ConformanceEntry } from '../lib/conformance.js';
import { rawJsonSystemOne } from '../lib/raw.js';

/**
 * Check 2: mixed text + image state with `noul` and `box` in one request (Req 2.1-2.5).
 * Question text is local to this file and is never moved to jev/catalog.ts.
 */

export const PINNED_MODEL = 'typesafe/jev-1.14';
/** Per SDK docs, `box` questions need this model. */
export const BOX_MODEL_OVERRIDE = 'jev-preview';
export const IMAGES_HEADER = { 'TypeSafe-Danger-Zone-Images': 'true' } as const;

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE = join(HERE, '..', 'fixtures', 'demo-app-screenshot.png');

const NOUL_QUESTION = 'Does the screenshot show a page with a visible heading?';
const BOX_QUESTION = 'The main heading of the page';
const STATE_TEXT = 'Claim: the demo page renders a main heading. A screenshot of the page is attached.';

export interface BoxObservation {
  present: boolean;
  /** Raw box object as returned, or null when absent. */
  coordinates: { top: unknown; bottom: unknown; left: unknown; right: unknown } | null;
  /** All four edges are finite numbers in [0, 1]. Observed, not assumed. */
  fractionsInUnitRange: boolean | null;
  /** top < bottom and left < right. */
  edgesOrdered: boolean | null;
  /** Convention taken from SDK docs; the observed flags above are what this run measured. */
  convention: {
    origin: 'top/left';
    unit: 'fraction of image height (top, bottom) and width (left, right)';
    source: 'SDK README (documented, not verified by this run)';
  };
}

export interface ShapeObservation {
  noulPresent: boolean;
  boxPresent: boolean;
  noulValue: unknown;
  box: BoxObservation;
  conformance: { noul: ConformanceEntry[]; box: ConformanceEntry[] };
}

export interface AttemptRecord {
  label: string;
  call: HarnessCallResult;
  /** Model actually requested, and whether it differs from the pinned model. */
  modelOverride: { pinned: string; used: string; overridden: boolean; reason: string | null };
  shape: ShapeObservation | null;
}

export type StepStatus = 'ran' | 'skipped' | 'not-run';

export interface FallbackStep {
  step: 'separate-noul' | 'separate-box' | 'typesafe-provider';
  status: StepStatus;
  reason: string | null;
  attempt: AttemptRecord | null;
}

export interface MixedStateResult {
  status: 'ran' | 'not-run';
  /** Why the check did not run (e.g. fixture file absent). */
  notRunReason: string | null;
  fixturePath: string;
  imageHeaderSent: boolean;
  withImage: AttemptRecord | null;
  withoutImage: AttemptRecord | null;
  /** Whether the response shape (answer keys/types) differs between image and no-image runs. */
  shapeChangedWithoutImage: boolean | null;
  shapeComparisonNote: string | null;
  /** Human judgment field: the harness never decides this. */
  boxEnclosesSubject: 'UNJUDGED';
  fallbacks: FallbackStep[];
  /**
   * Diagnostic attempts added after the first run returned HTTP 400 with no recorded reason.
   * Each is its own attempt with a label naming model, header and transport.
   */
  diagnostics: AttemptRecord[];
  /** Every call made, in order, for sample writing and model-id aggregation. */
  calls: HarnessCallResult[];
}

export interface MixedStateOptions {
  fixturePath?: string;
  env?: NodeJS.ProcessEnv;
  /** Calls are pushed here as they happen, so a caller keeps partial calls if the check throws. */
  sink?: HarnessCallResult[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isEdge = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Describe what came back, without judging whether the box is correct. */
export function observeShape(response: unknown): ShapeObservation {
  const answers = isRecord(response) && isRecord(response.answers) ? response.answers : {};
  const noulAnswer = answers.noul;
  const boxAnswer = answers.box;
  const noulPresent = isRecord(noulAnswer);
  const boxPresent = isRecord(boxAnswer);
  const rawBox = boxPresent && isRecord(boxAnswer.box) ? boxAnswer.box : null;
  const coords = rawBox
    ? { top: rawBox.top, bottom: rawBox.bottom, left: rawBox.left, right: rawBox.right }
    : null;
  const allNumbers = coords !== null && Object.values(coords).every(isEdge);
  return {
    noulPresent,
    boxPresent,
    noulValue: noulPresent ? noulAnswer.noul : undefined,
    box: {
      present: rawBox !== null,
      coordinates: coords,
      fractionsInUnitRange: allNumbers
        ? Object.values(coords).every((v) => (v as number) >= 0 && (v as number) <= 1)
        : coords === null
          ? null
          : false,
      edgesOrdered: allNumbers
        ? (coords.top as number) < (coords.bottom as number) && (coords.left as number) < (coords.right as number)
        : null,
      convention: {
        origin: 'top/left',
        unit: 'fraction of image height (top, bottom) and width (left, right)',
        source: 'SDK README (documented, not verified by this run)',
      },
    },
    conformance: {
      noul: noulPresent ? diffAnswer('noul', noulAnswer) : [{ field: 'noul', expectedType: 'answer object', observedValue: undefined }],
      box: boxPresent ? diffAnswer('box', boxAnswer) : [{ field: 'box', expectedType: 'answer object', observedValue: undefined }],
    },
  };
}

/** Compact signature of an answer set: which keys exist and the type of each answer field. */
function shapeSignature(response: unknown): string {
  const answers = isRecord(response) && isRecord(response.answers) ? response.answers : null;
  if (!answers) return 'no-answers';
  const sig: Record<string, string[]> = {};
  for (const k of Object.keys(answers).sort()) {
    const a = answers[k];
    sig[k] = isRecord(a) ? Object.keys(a).sort().map((f) => `${f}:${a[f] === null ? 'null' : typeof a[f]}`) : [typeof a];
  }
  return JSON.stringify(sig);
}

type Wanted = 'both' | 'noul' | 'box';

interface AttemptSpec {
  label: string;
  requestType: RequestType;
  provider: Provider;
  wanted: Wanted;
  image: Image | null;
  env?: NodeJS.ProcessEnv;
  /** Explicit model. Defaults: jev-preview when box is asked, else the pinned model. */
  model?: string;
  /** Send the images header. Defaults to true when an image is attached. */
  imagesHeader?: boolean;
  /**
   * 'sdk' (default): client.systemOne, which sends images as multipart/form-data.
   * 'raw-json': JSON body with an `assets` entry carrying data_base64 (documented in api.md).
   */
  transport?: 'sdk' | 'raw-json';
  pngBase64?: string;
}

async function attempt(spec: AttemptSpec): Promise<AttemptRecord> {
  const needsBox = spec.wanted !== 'noul';
  // Questions are built per attempt; box forces the documented override model.
  const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof box>> = {};
  if (spec.wanted !== 'box') questions.noul = noul(NOUL_QUESTION);
  if (needsBox) questions.box = box(BOX_QUESTION);

  const pinned = spec.provider === 'openrouter' ? PINNED_MODEL : 'jev-latest';
  const used = spec.model ?? (needsBox ? BOX_MODEL_OVERRIDE : pinned);
  const modelOverride = {
    pinned,
    used,
    overridden: used !== pinned,
    reason: used !== pinned ? (spec.model ? 'explicit diagnostic model' : 'box questions require jev-preview per SDK docs') : null,
  };

  const state: { [key: string]: string | Image } = { text: STATE_TEXT };
  if (spec.image) state.screenshot = spec.image;
  const sendHeader = spec.imagesHeader ?? spec.image !== null;
  const transport = spec.transport ?? 'sdk';
  const client = buildClient({ provider: spec.provider, ...(spec.env ? { env: spec.env } : {}) });

  const call = await timedCall(
    {
      requestType: spec.requestType,
      label: spec.label,
      provider: spec.provider,
      modelRequested: used,
      // Image bytes are not stored in the request record; the sample writer saves the image file.
      request: {
        model: used,
        transport,
        headers: sendHeader ? IMAGES_HEADER : {},
        state: { text: STATE_TEXT, ...(spec.image ? { screenshot: '<image: demo-app-screenshot.png>' } : {}) },
        questions: {
          ...(spec.wanted !== 'box' ? { noul: NOUL_QUESTION } : {}),
          ...(needsBox ? { box: BOX_QUESTION } : {}),
        },
      },
    },
    () => {
      if (transport === 'raw-json') {
        const questionsRaw: Record<string, { type: 'noul' | 'box'; instructions: string }> = {};
        if (spec.wanted !== 'box') questionsRaw.noul = { type: 'noul', instructions: NOUL_QUESTION };
        if (needsBox) questionsRaw.box = { type: 'box', instructions: BOX_QUESTION };
        return rawJsonSystemOne({
          model: used,
          state: `${STATE_TEXT} Screenshot: <shot>`,
          questions: questionsRaw,
          placeholder: '<shot>',
          pngBase64: spec.pngBase64 ?? '',
          imagesHeader: sendHeader,
          ...(spec.env ? { env: spec.env } : {}),
        });
      }
      return client.systemOne({ state, questions, model: used }, sendHeader ? { headers: { ...IMAGES_HEADER } } : {});
    },
  );
  return {
    label: spec.label,
    call,
    modelOverride,
    shape: call.ok ? observeShape(call.raw.response) : null,
  };
}

function wantedSatisfied(a: AttemptRecord | null, wanted: Wanted): boolean {
  if (!a || !a.call.ok || !a.shape) return false;
  if (wanted === 'noul') return a.shape.noulPresent;
  if (wanted === 'box') return a.shape.boxPresent && a.shape.box.present;
  return a.shape.noulPresent && a.shape.boxPresent && a.shape.box.present;
}

/** Read the fixture as a base64 data URL, or return null when the file is absent. */
export function readFixtureDataUrl(path: string): string | null {
  if (!existsSync(path)) return null;
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

function imageFromDataUrl(dataUrl: string): Image {
  // SDK wants raw base64, without the `data:` prefix.
  return Image.fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

export async function runMixedState(options: MixedStateOptions = {}): Promise<MixedStateResult> {
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE;
  const env = options.env ?? process.env;
  const base: MixedStateResult = {
    status: 'not-run',
    notRunReason: null,
    fixturePath,
    imageHeaderSent: false,
    withImage: null,
    withoutImage: null,
    shapeChangedWithoutImage: null,
    shapeComparisonNote: null,
    boxEnclosesSubject: 'UNJUDGED',
    fallbacks: [],
    diagnostics: [],
    calls: options.sink ?? [],
  };

  const dataUrl = readFixtureDataUrl(fixturePath);
  if (dataUrl === null) {
    return { ...base, notRunReason: `fixture not found: ${fixturePath} (run fixtures/capture-screenshot.ts)` };
  }
  const image = imageFromDataUrl(dataUrl);
  const result: MixedStateResult = { ...base, status: 'ran', imageHeaderSent: true };
  const ctx = { env };

  // 1. Mixed request with image, noul + box.
  result.withImage = await attempt({
    label: 'mixed with image',
    requestType: 'mixed_state',
    provider: 'openrouter',
    wanted: 'both',
    image,
    ...ctx,
  });
  result.calls.push(result.withImage.call);

  // 2. Same request, image removed.
  result.withoutImage = await attempt({
    label: 'mixed without image',
    requestType: 'mixed_state_no_image',
    provider: 'openrouter',
    wanted: 'both',
    image: null,
    ...ctx,
  });
  result.calls.push(result.withoutImage.call);

  if (result.withImage.call.ok && result.withoutImage.call.ok) {
    const a = shapeSignature(result.withImage.call.raw.response);
    const b = shapeSignature(result.withoutImage.call.raw.response);
    result.shapeChangedWithoutImage = a !== b;
    result.shapeComparisonNote = a === b ? 'same answer keys and field types' : `with image ${a}; without image ${b}`;
  } else {
    result.shapeComparisonNote = 'not comparable: at least one of the two calls failed';
  }

  // 3. Fallbacks when the mixed request failed or lacks box.
  if (!wantedSatisfied(result.withImage, 'both')) {
    const noulAttempt = await attempt({
      label: 'separate noul',
      requestType: 'mixed_state_split_noul',
      provider: 'openrouter',
      wanted: 'noul',
      image,
      ...ctx,
    });
    result.calls.push(noulAttempt.call);
    result.fallbacks.push({ step: 'separate-noul', status: 'ran', reason: null, attempt: noulAttempt });

    const boxAttempt = await attempt({
      label: 'separate box',
      requestType: 'mixed_state_split_box',
      provider: 'openrouter',
      wanted: 'box',
      image,
      ...ctx,
    });
    result.calls.push(boxAttempt.call);
    result.fallbacks.push({ step: 'separate-box', status: 'ran', reason: null, attempt: boxAttempt });

    if (typeof env.TYPESAFE_API_KEY === 'string' && env.TYPESAFE_API_KEY.trim() !== '') {
      const direct = await attempt({
        label: 'typesafe provider, mixed',
        requestType: 'mixed_state_typesafe_provider',
        provider: 'typesafe',
        wanted: 'both',
        image,
        ...ctx,
      });
      result.calls.push(direct.call);
      result.fallbacks.push({ step: 'typesafe-provider', status: 'ran', reason: null, attempt: direct });
    } else {
      result.fallbacks.push({
        step: 'typesafe-provider',
        status: 'skipped',
        reason: 'TYPESAFE_API_KEY not set',
        attempt: null,
      });
    }
  }

  // 4. Diagnostics (always run). The first live run returned HTTP 400 for every box and image
  // request with no recorded reason. Each variant below isolates one suspect: the model id
  // (jev-preview is a TypeSafe-direct alias and may not exist on OpenRouter), the images header,
  // and the transport (the SDK sends images as multipart/form-data; the OpenRouter route may
  // only accept JSON).
  // Request-construction review against SDK 0.7.0 README and api.md: image placed inside `state`
  // object, `box` on jev-preview, header `TypeSafe-Danger-Zone-Images: true` per call. The
  // construction matches the docs, so no change was made to the original attempts.
  const pngBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const diag: Array<Omit<AttemptSpec, 'requestType' | 'provider' | 'image' | 'env'> & { noImage?: boolean }> = [
    { label: 'diag: box only, pinned model, images header ON', wanted: 'box', model: PINNED_MODEL, imagesHeader: true },
    { label: 'diag: box only, pinned model, images header OFF', wanted: 'box', model: PINNED_MODEL, imagesHeader: false },
    { label: 'diag: image noul only, pinned model, images header ON', wanted: 'noul', model: PINNED_MODEL, imagesHeader: true },
    { label: 'diag: image noul only, pinned model, images header OFF', wanted: 'noul', model: PINNED_MODEL, imagesHeader: false },
    { label: 'diag: image noul only, jev-preview, images header ON', wanted: 'noul', model: BOX_MODEL_OVERRIDE, imagesHeader: true },
    { label: 'diag: text-only noul, pinned model (control, no image)', wanted: 'noul', model: PINNED_MODEL, imagesHeader: false, noImage: true },
    { label: 'diag: raw JSON data_base64 asset, box only, pinned model, header ON', wanted: 'box', model: PINNED_MODEL, imagesHeader: true, transport: 'raw-json', pngBase64 },
    { label: 'diag: raw JSON data_base64 asset, image noul only, pinned model, header ON', wanted: 'noul', model: PINNED_MODEL, imagesHeader: true, transport: 'raw-json', pngBase64 },
  ];
  for (const d of diag) {
    const { noImage, ...rest } = d;
    const rec = await attempt({
      ...rest,
      requestType: 'diagnostic',
      provider: 'openrouter',
      image: noImage ? null : image,
      ...ctx,
    });
    result.diagnostics.push(rec);
    result.calls.push(rec.call);
  }
  return result;
}
