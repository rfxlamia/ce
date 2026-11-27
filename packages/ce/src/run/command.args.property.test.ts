import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseRunArgs, type ParsedRunArgs } from './command.js';

const NUM_RUNS = 200;

/** Non-empty values that do not start with `--` (may contain `=` and spaces). */
const arbValue = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.startsWith('--'));

type Name = 'config' | 'base' | 'claim';
interface Entry {
  name: Name;
  value: string;
  eq: boolean;
}

/** Options with config/base at most once, claim repeated, each entry in a random form, in a random order. */
const arbEntries: fc.Arbitrary<Entry[]> = fc
  .record({
    config: fc.option(arbValue, { nil: undefined }),
    base: fc.option(arbValue, { nil: undefined }),
    claims: fc.array(arbValue, { maxLength: 5 }),
  })
  .chain(({ config, base, claims }) => {
    const raw: { name: Name; value: string }[] = [];
    if (config !== undefined) raw.push({ name: 'config', value: config });
    if (base !== undefined) raw.push({ name: 'base', value: base });
    for (const value of claims) raw.push({ name: 'claim', value });
    return fc
      .tuple(fc.shuffledSubarray(raw, { minLength: raw.length, maxLength: raw.length }), fc.array(fc.boolean(), { minLength: raw.length, maxLength: raw.length }))
      .map(([order, forms]) => {
        // Shuffling may reorder claims; the expectation is derived from the final order.
        return order.map((e, i) => ({ ...e, eq: forms[i]! }));
      });
  });

function toArgv(entries: readonly Entry[]): string[] {
  return entries.flatMap((e) => (e.eq ? [`--${e.name}=${e.value}`] : [`--${e.name}`, e.value]));
}

function expected(entries: readonly Entry[]): ParsedRunArgs {
  const out: ParsedRunArgs = {};
  for (const e of entries) {
    if (e.name === 'claim') (out.claim ??= []).push(e.value);
    else out[e.name] = e.value;
  }
  return out;
}

const arbName = fc.constantFrom<Name>('config', 'base', 'claim');

// Feature: run-vertical-slice, Property 8: Argument parsing round trip and rejection
// **Validates: Requirements 10.11, 10.12, 10.13, 10.14, 10.15, 13.7**
describe('Property 8: Argument parsing round trip and rejection', () => {
  it('round trips mixed --name value and --name=value forms, keeping claim order', () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        expect(parseRunArgs(toArgv(entries))).toEqual(expected(entries));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects an unknown flag', () => {
    const arbUnknown = fc
      .stringMatching(/^[a-z][a-z-]{0,10}$/)
      .filter((s) => s !== 'config' && s !== 'base' && s !== 'claim');
    fc.assert(
      fc.property(arbEntries, arbUnknown, arbValue, fc.boolean(), (entries, flag, value, eq) => {
        const extra = eq ? [`--${flag}=${value}`] : [`--${flag}`, value];
        expect(parseRunArgs([...toArgv(entries), ...extra])).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a positional argument', () => {
    const arbPositional = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.startsWith('--'));
    fc.assert(
      fc.property(arbEntries, arbPositional, (entries, positional) => {
        // Appended after a complete option list, so it cannot be consumed as a value.
        expect(parseRunArgs([...toArgv(entries), positional])).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a missing value', () => {
    fc.assert(
      fc.property(arbEntries, arbName, (entries, name) => {
        expect(parseRunArgs([...toArgv(entries), `--${name}`])).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects an empty value in either form', () => {
    fc.assert(
      fc.property(arbEntries, arbName, fc.boolean(), (entries, name, eq) => {
        const extra = eq ? [`--${name}=`] : [`--${name}`, ''];
        expect(parseRunArgs([...toArgv(entries), ...extra])).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a value token that starts with --', () => {
    fc.assert(
      fc.property(arbEntries, arbName, fc.string({ maxLength: 10 }), (entries, name, rest) => {
        expect(parseRunArgs([...toArgv(entries), `--${name}`, `--${rest}`])).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a repeated --config or --base', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'config' | 'base'>('config', 'base'),
        arbValue,
        arbValue,
        fc.boolean(),
        fc.boolean(),
        (name, v1, v2, eq1, eq2) => {
          const argv = toArgv([
            { name, value: v1, eq: eq1 },
            { name, value: v2, eq: eq2 },
          ]);
          expect(parseRunArgs(argv)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts an empty argument list', () => {
    expect(parseRunArgs([])).toEqual({});
  });
});
