// Capability_Registry: validated, frozen list of capabilities the run pipeline may call.
import type { Assessment, Surface } from '../assessment/index.js';
import { V0_SUPPORTED_SURFACES } from '../outcome/index.js';
import type { CapabilityEntry, CapabilityRegistry } from './types.js';

export function createCapabilityRegistry(entries: readonly CapabilityEntry[]): CapabilityRegistry {
  const names = new Set<string>();
  const supported: readonly Surface[] = V0_SUPPORTED_SURFACES;
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new Error(`Duplicate capability name: ${entry.name}`);
    }
    names.add(entry.name);
    for (const surface of entry.surfaces) {
      if (!supported.includes(surface)) {
        throw new Error(`Unsupported capability surface: ${surface}`);
      }
    }
  }
  const copy = entries.map((e) => Object.freeze({ ...e, surfaces: Object.freeze([...e.surfaces]) }));
  return Object.freeze(copy) as unknown as CapabilityRegistry;
}

export const EMPTY_REGISTRY: CapabilityRegistry = createCapabilityRegistry([]);

/** First entry in registration order that supports the Surface; undefined when evidence is not required. */
export function selectCapability(
  assessment: Pick<Assessment, 'required' | 'surface'>,
  registry: CapabilityRegistry,
): CapabilityEntry | undefined {
  if (!assessment.required) return undefined;
  return registry.find((e) => e.surfaces.includes(assessment.surface));
}

/** De-duplicated union of registered Surfaces, in first-seen order. */
export function supportedSurfaces(registry: CapabilityRegistry): Surface[] {
  const out: Surface[] = [];
  for (const entry of registry) {
    for (const surface of entry.surfaces) {
      if (!out.includes(surface)) out.push(surface);
    }
  }
  return out;
}
