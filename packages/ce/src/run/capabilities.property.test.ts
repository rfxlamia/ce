import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Surface } from '../assessment/index.js';
import { ALL_SURFACES, arbSurface } from '../outcome/arbitraries.js';
import { V0_SUPPORTED_SURFACES } from '../outcome/index.js';
import { createCapabilityRegistry, EMPTY_REGISTRY, selectCapability } from './capabilities.js';
import type { CapabilityEntry } from './types.js';

const NUM_RUNS = 200;

const noopRun: CapabilityEntry['run'] = () => Promise.reject(new Error('not called'));

/** Entries with unique names and Surfaces drawn from the v0 supported list, so the registry is valid. */
const arbEntries: fc.Arbitrary<CapabilityEntry[]> = fc
  .array(fc.subarray([...V0_SUPPORTED_SURFACES] as Surface[]), { maxLength: 6 })
  .map((surfaceLists) => surfaceLists.map((surfaces, i) => ({ name: `cap-${i}`, surfaces, run: noopRun })));

const arbAssessment = fc.record({ required: fc.boolean(), surface: arbSurface });

// Feature: run-vertical-slice, Property 2: Capability selection
// **Validates: Requirements 3.2, 8.11, 13.13, 13.14**
describe('Property 2: Capability selection', () => {
  it('returns undefined when required is false, else the first entry in registration order that includes the Surface', () => {
    fc.assert(
      fc.property(arbAssessment, arbEntries, (assessment, entries) => {
        const registry = createCapabilityRegistry(entries);
        const selected = selectCapability(assessment, registry);

        if (!assessment.required) {
          expect(selected).toBeUndefined();
          return;
        }
        const expectedName = entries.find((e) => e.surfaces.includes(assessment.surface))?.name;
        expect(selected?.name).toBe(expectedName);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns undefined when no entry supports the Surface', () => {
    fc.assert(
      fc.property(arbAssessment, arbEntries, (assessment, entries) => {
        const registry = createCapabilityRegistry(entries);
        if (entries.some((e) => e.surfaces.includes(assessment.surface))) return;
        expect(selectCapability(assessment, registry)).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns undefined for every Assessment on the empty registry', () => {
    fc.assert(
      fc.property(arbAssessment, (assessment) => {
        expect(selectCapability(assessment, EMPTY_REGISTRY)).toBeUndefined();
        expect(selectCapability(assessment, createCapabilityRegistry([]))).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const NON_V0_SURFACES: Surface[] = ALL_SURFACES.filter((s) => !(V0_SUPPORTED_SURFACES as readonly Surface[]).includes(s));

/** Valid entries with a copy of one entry's name forced onto another position. */
const arbEntriesWithDuplicateName: fc.Arbitrary<CapabilityEntry[]> = fc
  .tuple(arbEntries.filter((e) => e.length > 0), fc.nat(), fc.nat())
  .map(([entries, a, b]) => {
    const dup = entries[a % entries.length]!;
    const out = [...entries, { ...entries[b % entries.length]!, name: dup.name }];
    return out;
  });

/** Valid entries with one entry given a non-v0 Surface. */
const arbEntriesWithNonV0Surface: fc.Arbitrary<CapabilityEntry[]> = fc
  .tuple(arbEntries.filter((e) => e.length > 0), fc.nat(), fc.constantFrom(...NON_V0_SURFACES))
  .map(([entries, i, bad]) =>
    entries.map((e, idx) => (idx === i % entries.length ? { ...e, surfaces: [...e.surfaces, bad] } : e)),
  );

// Feature: run-vertical-slice, Property 3: Registry validation
// **Validates: Requirements 8.3, 8.4, 13.12**
describe('Property 3: Registry validation', () => {
  it('throws when two entries share a name', () => {
    fc.assert(
      fc.property(arbEntriesWithDuplicateName, (entries) => {
        expect(() => createCapabilityRegistry(entries)).toThrow(/Duplicate capability name/);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws when an entry has a Surface outside V0_SUPPORTED_SURFACES', () => {
    fc.assert(
      fc.property(arbEntriesWithNonV0Surface, (entries) => {
        expect(() => createCapabilityRegistry(entries)).toThrow(/Unsupported capability surface/);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns the same entries in the same order, with every Surface in V0_SUPPORTED_SURFACES, for valid lists', () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const registry = createCapabilityRegistry(entries);
        expect(registry.map((e) => e.name)).toEqual(entries.map((e) => e.name));
        expect(registry.map((e) => [...e.surfaces])).toEqual(entries.map((e) => [...e.surfaces]));
        expect(registry.map((e) => e.run)).toEqual(entries.map((e) => e.run));
        const supported: readonly Surface[] = V0_SUPPORTED_SURFACES;
        for (const entry of registry) {
          for (const surface of entry.surfaces) expect(supported).toContain(surface);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
