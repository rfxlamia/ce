import { createHash } from 'node:crypto';
import type { TextWithAssets } from '@typesafe-ai/sdk';

const DOMAIN_PREFIX = 'ce-state-v1';
const IMAGE_REFERENCE = /<image:[0-9a-f]{32}>/g;

function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/**
 * Stable identifier of a state: lowercase hex SHA-256 (64 chars) of
 * `ce-state-v1 0x00 <text with positional image placeholders>` followed, per image in
 * placeholder order, by `0x00 SHA-256(image bytes)`. The random per-asset reference
 * strings never influence the result. Independent of question set, stage and model.
 */
export function stateHash(state: string | TextWithAssets): string {
  const text = typeof state === 'string' ? state : state.text;
  const assets = typeof state === 'string' ? [] : state.assets;

  const byReference = new Map<string, Uint8Array>();
  for (const asset of assets) {
    const data = asset.data;
    if (!(data instanceof Uint8Array)) {
      throw new TypeError('stateHash: Blob image data is not supported; use byte arrays');
    }
    const reference = String(asset);
    if (!byReference.has(reference)) byReference.set(reference, data);
  }

  // Number references in order of first appearance, then unreferenced assets.
  const order: string[] = [];
  const indexOf = new Map<string, number>();
  const register = (reference: string): number => {
    let index = indexOf.get(reference);
    if (index === undefined) {
      index = order.length;
      indexOf.set(reference, index);
      order.push(reference);
    }
    return index;
  };

  const normalized = text.replace(IMAGE_REFERENCE, (reference) => `<image:${register(reference)}>`);
  for (const reference of byReference.keys()) register(reference);

  const hash = createHash('sha256');
  hash.update(DOMAIN_PREFIX, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(normalized, 'utf8');
  for (const reference of order) {
    const bytes = byReference.get(reference);
    if (bytes === undefined) continue;
    hash.update(Uint8Array.of(0));
    hash.update(sha256(bytes));
  }
  return hash.digest('hex');
}
