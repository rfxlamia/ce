import { describe, expect, it } from 'vitest';
import type { Surface } from '../assessment/index.js';
import { V0_SUPPORTED_SURFACES } from '../outcome/index.js';
import { EMPTY_REGISTRY, createCapabilityRegistry, selectCapability, supportedSurfaces } from './capabilities.js';
import type { CapabilityEntry, RuntimeHook } from './types.js';

const run: RuntimeHook = async () => {
  throw new Error('not called');
};

function entry(name: string, surfaces: readonly Surface[]): CapabilityEntry {
  return { name, surfaces, run };
}

describe('createCapabilityRegistry', () => {
  it('throws on a duplicate capability name (8.3, 13.12)', () => {
    expect(() =>
      createCapabilityRegistry([entry('browser', ['browser_ui']), entry('browser', ['browser_ui'])]),
    ).toThrow(/Duplicate capability name: browser/);
  });

  it('throws on a Surface outside V0_SUPPORTED_SURFACES (8.4, 13.12)', () => {
    expect(() => createCapabilityRegistry([entry('api', ['http_api'])])).toThrow(
      /Unsupported capability surface: http_api/,
    );
  });

  it('accepts an empty list and EMPTY_REGISTRY is empty', () => {
    expect(createCapabilityRegistry([])).toHaveLength(0);
    expect(EMPTY_REGISTRY).toHaveLength(0);
    expect(supportedSurfaces(EMPTY_REGISTRY)).toEqual([]);
  });

  it('every Surface of an accepted registry is in V0_SUPPORTED_SURFACES (8.4)', () => {
    const registry = createCapabilityRegistry([entry('a', ['browser_ui']), entry('b', ['browser_ui'])]);
    const allowed: readonly Surface[] = V0_SUPPORTED_SURFACES;
    for (const e of registry) {
      for (const s of e.surfaces) expect(allowed).toContain(s);
    }
    for (const s of supportedSurfaces(registry)) expect(allowed).toContain(s);
  });
});

describe('selectCapability', () => {
  it('selects the first-registered capability when two share a Surface (8.11, 13.13)', () => {
    const registry = createCapabilityRegistry([entry('first', ['browser_ui']), entry('second', ['browser_ui'])]);
    expect(selectCapability({ required: true, surface: 'browser_ui' }, registry)?.name).toBe('first');
  });

  it('returns undefined for an empty registry', () => {
    expect(selectCapability({ required: true, surface: 'browser_ui' }, EMPTY_REGISTRY)).toBeUndefined();
  });

  it('returns undefined when evidence is not required', () => {
    const registry = createCapabilityRegistry([entry('first', ['browser_ui'])]);
    expect(selectCapability({ required: false, surface: 'browser_ui' }, registry)).toBeUndefined();
  });
});
