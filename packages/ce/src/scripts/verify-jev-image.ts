/**
 * Verification_Script: manual live verification of the Jev image path (Requirements 14 and 15).
 *
 * Usage: verify-jev-image <latency|image-url|typesafe|all> [--samples <n>] [--image <path>]
 *        [--out <dir>] [--allow-ci]
 *
 * Imports only `jev/probe` and Node built-ins. Reads keys only from the process environment,
 * accepts no key as an argument and calls no `fetch`. Never run by `npm test`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as probe from '../jev/probe.js';
import type { PlannedItem, ProbeOptions, ProbeResult, VerificationCommand } from '../jev/probe.js';

const COMMANDS: readonly VerificationCommand[] = ['latency', 'image-url', 'typesafe', 'all'];
const MODEL = 'typesafe/jev-1.14';
const CLAIM = 'The page shows a confirmation message after the form is submitted.';
const FINAL_IMAGE_QUESTIONS = ['state_reached', 'locate_subject'];
const IMAGE_URL_QUESTIONS = ['state_reached'];
const TEXT_QUESTIONS = ['surface'];

// src/scripts -> repository root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface CliArgs {
  command: VerificationCommand;
  samples: number;
  image: string;
  out: string;
  allowCi: boolean;
}

function usage(): string {
  return 'Usage: verify-jev-image <latency|image-url|typesafe|all> [--samples <n>] [--image <path>] [--out <dir>] [--allow-ci]';
}

function parseArgs(argv: string[]): CliArgs | string {
  let command: VerificationCommand | undefined;
  let samples = 20;
  let image = join(REPO_ROOT, 'packages', 'ce', 'fixtures', 'jev', 'demo-app-screenshot.png');
  let out: string | undefined;
  let allowCi = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--allow-ci') {
      allowCi = true;
    } else if (arg === '--samples' || arg === '--image' || arg === '--out') {
      const value = argv[++i];
      if (value === undefined) return `${arg} needs a value`;
      if (arg === '--samples') {
        samples = Number(value);
        if (!Number.isInteger(samples) || samples < 1) return '--samples must be a positive integer';
      } else if (arg === '--image') {
        image = resolve(value);
      } else {
        out = resolve(value);
      }
    } else if ((COMMANDS as readonly string[]).includes(arg) && command === undefined) {
      command = arg as VerificationCommand;
    } else {
      return `unknown argument: ${arg}`;
    }
  }
  if (command === undefined) return 'a command is required';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  out ??= join(REPO_ROOT, 'docs', 'journal', 'v0.0', 'samples', `${stamp}-gateway`);
  return { command, samples, image, out, allowCi };
}

class SampleWriter {
  private n = 0;
  constructor(
    private readonly dir: string,
    private readonly secrets: readonly string[],
  ) {}

  async write(name: string, result: ProbeResult, questionNames: readonly string[]): Promise<void> {
    this.n += 1;
    const sample = probe.sanitizeSample({ probe: name, result, questionNames }, this.secrets);
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${String(this.n).padStart(3, '0')}-${name}.json`);
    await writeFile(file, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
  }
}

function firstFailure(results: ProbeResult[]): ProbeResult | undefined {
  return results.find((r) => !r.ok);
}

async function runLatency(
  base: ProbeOptions,
  args: CliArgs,
  writer: SampleWriter,
  date: string,
): Promise<string> {
  const times: number[] = [];
  const results: ProbeResult[] = [];
  let model: string | undefined;
  for (let i = 0; i < args.samples; i++) {
    // Sequential: each sample starts after the previous one ended.
    const result = await probe.sendFinalImage({ ...base, claim: CLAIM });
    results.push(result);
    await writer.write('latency-final-image', result, FINAL_IMAGE_QUESTIONS);
    if (result.ok) {
      times.push(result.latencyMs);
      model ??= result.model;
    }
  }
  const failed = firstFailure(results);
  return probe.latencySummaryMarkdown({
    date,
    requests: results.length,
    stats: probe.computeLatencyStats(times, results.length - times.length),
    model,
    provider: 'openrouter',
    transport: 'json',
    samplesDir: args.out,
    ...(failed?.status !== undefined ? { failureStatus: failed.status } : {}),
    ...(failed?.errorText !== undefined ? { failureText: failed.errorText } : {}),
  });
}

async function runImageUrl(
  base: ProbeOptions,
  args: CliArgs,
  writer: SampleWriter,
  date: string,
): Promise<string> {
  const result = await probe.sendImageUrlForm({ ...base, claim: CLAIM });
  await writer.write('image-url-array-form', result, IMAGE_URL_QUESTIONS);
  return probe.imageUrlSummaryMarkdown({
    date,
    result,
    usedBothParts: undefined,
    samplesDir: args.out,
  });
}

async function runTypesafe(
  base: ProbeOptions,
  args: CliArgs,
  writer: SampleWriter,
  date: string,
): Promise<string> {
  const text = await probe.sendText(base);
  await writer.write('typesafe-text-sdk', text, TEXT_QUESTIONS);

  const imageJson = await probe.sendFinalImage({ ...base, claim: CLAIM });
  await writer.write('typesafe-image-json', imageJson, FINAL_IMAGE_QUESTIONS);

  let imageJsonWithHeader: ProbeResult | undefined;
  if (!imageJson.ok) {
    imageJsonWithHeader = await probe.sendFinalImage({ ...base, claim: CLAIM, dangerZoneHeader: true });
    await writer.write('typesafe-image-json-header', imageJsonWithHeader, FINAL_IMAGE_QUESTIONS);
  }

  const imageSdk = await probe.sendSdkImage({ ...base, claim: CLAIM });
  await writer.write('typesafe-image-sdk-multipart', imageSdk, FINAL_IMAGE_QUESTIONS);

  return probe.typesafeSummaryMarkdown({
    date,
    text,
    imageJson,
    ...(imageJsonWithHeader !== undefined ? { imageJsonWithHeader } : {}),
    imageSdk,
    model: MODEL,
    samplesDir: args.out,
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`${args}\n${usage()}`);
    return 1;
  }

  // CI check and key presence check happen inside planRun, before any key value is read.
  const plan = probe.planRun(args.command, process.env, args.allowCi);
  if (plan.exitCode === 2) {
    console.error(plan.message);
    return 2;
  }
  if (plan.exitCode === 3) {
    console.error(`${plan.message}. ${plan.status}`);
    return 3;
  }

  let imageBytes: Uint8Array;
  try {
    imageBytes = new Uint8Array(await readFile(args.image));
  } catch {
    console.error(`cannot read image file: ${args.image}`);
    return 1;
  }

  const date = new Date().toISOString();
  const blocks: string[] = [];
  for (const item of plan.items as PlannedItem[]) {
    const apiKey = process.env[item.keyVariable] as string;
    const base: ProbeOptions = { provider: item.provider, apiKey, model: MODEL, imageBytes };
    const writer = new SampleWriter(args.out, [apiKey]);
    if (item.item === 'latency') blocks.push(await runLatency(base, args, writer, date));
    else if (item.item === 'image-url') blocks.push(await runImageUrl(base, args, writer, date));
    else blocks.push(await runTypesafe(base, args, writer, date));
  }
  for (const b of plan.blocked) {
    blocks.push(`### ${b.item}\n\n- Answer_Status: ${b.status}`);
  }
  console.log(blocks.join('\n\n'));
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`verification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  },
);
