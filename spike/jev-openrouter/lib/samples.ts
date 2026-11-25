import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RequestType } from './call.js';
import { assertNoEnvLeak } from './sanitize.js';

export interface RawSample {
  requestType: RequestType;
  request: unknown; // sanitized
  response: unknown; // sanitized
  label?: string;
  modelId: string;
  latencyMs: number;
  imageRef?: string; // relative path, when requestType carries an image
}

function stamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, (c) => (c === '-' ? '-' : ''));
}

/**
 * Creates a new timestamped directory under `base` (e.g. 2025-06-01T120000Z).
 * Never reuses an existing directory: on collision a numeric suffix is added.
 */
export function newDatedOutputDir(base: string): string {
  mkdirSync(base, { recursive: true });
  const name = stamp(new Date());
  for (let i = 0; ; i++) {
    const dir = join(base, i === 0 ? name : `${name}-${i}`);
    try {
      mkdirSync(dir); // non-recursive: throws EEXIST instead of reusing
      return dir;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

function safeName(name: string): string {
  const s = basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
  return s.length > 0 ? s : 'sample';
}

/**
 * Writes one sanitized sample as `<name>.json` in `dir`. If `image` bytes are
 * given, they are written as a separate file and referenced by `imageRef`.
 * Refuses (throws) if the sample contains a credential value, or if the file
 * already exists.
 */
export function writeSample(
  dir: string,
  name: string,
  sample: RawSample,
  image?: { data: Uint8Array; ext?: string },
): void {
  const base = safeName(name);
  const out: RawSample = { ...sample };
  let imagePath: string | undefined;
  if (image) {
    const file = `${base}.${(image.ext ?? 'png').replace(/[^A-Za-z0-9]/g, '')}`;
    out.imageRef = file;
    imagePath = join(dir, file);
  }
  assertNoEnvLeak(out);
  const json = JSON.stringify(out, null, 2) + '\n';
  assertNoEnvLeak(json);
  if (image && imagePath) writeFileSync(imagePath, image.data, { flag: 'wx' });
  writeFileSync(join(dir, `${base}.json`), json, { flag: 'wx' });
}
