import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildChildInvocation, buildMirrorEntries } from './inputs.js';

// Feature: github-action-pr-comment, Property 8: The Input_Map sends each non-empty input to exactly one destination, and each empty input to none
// **Validates: Requirements 3.3, 3.4, 3.5, 15.3**

const entries = buildMirrorEntries();

// Values without surrounding whitespace so the trimmed value equals the generated value.
const plainValue = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => s.trim())
  .filter((s) => s !== '');

const optionalValue = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant('\t \n'),
  plainValue,
);

const plainLine = plainValue.filter((s) => !s.includes('\n') && !s.includes('\r'));
const flagLine = plainLine.map((s) => `--${s}`);
const claimLine = fc.oneof(
  plainLine.filter((s) => !s.startsWith('--')),
  flagLine,
  fc.constant(''),
  fc.constant('  '),
);

function inputsFrom(values: Record<string, string>) {
  return { getInput: (name: string) => values[name] ?? '' };
}

describe('Property 8: Input_Map destinations', () => {
  it('sends each non-empty mirror input to exactly its CE_* variable, and empty ones to none', () => {
    fc.assert(
      fc.property(
        fc.array(optionalValue, { minLength: entries.length, maxLength: entries.length }),
        optionalValue,
        optionalValue,
        fc.array(claimLine, { maxLength: 8 }),
        (mirrorValues, config, base, claimLines) => {
          const values: Record<string, string> = { config, base, claim: claimLines.join('\n') };
          entries.forEach((e, i) => {
            values[e.inputName] = mirrorValues[i]!;
          });
          const { env, argv, warnings } = buildChildInvocation(inputsFrom(values));

          // Mirror inputs: env var present iff non-empty, with the trimmed value.
          const expectedEnv: Record<string, string> = {};
          entries.forEach((e, i) => {
            const v = mirrorValues[i]!.trim();
            if (v !== '') expectedEnv[e.envName] = v;
          });
          expect(env).toEqual(expectedEnv);

          // No mirror value leaks into argv (config/base/claim are the only argv sources).
          const expectedArgv: string[] = [];
          if (config.trim() !== '') expectedArgv.push('--config', config.trim());
          if (base.trim() !== '') expectedArgv.push('--base', base.trim());
          let skipped = 0;
          claimLines.forEach((l) => {
            const t = l.trim();
            if (t === '') return;
            if (t.startsWith('--')) {
              skipped += 1;
              return;
            }
            expectedArgv.push('--claim', t);
          });
          expect(argv).toEqual(expectedArgv);

          // config and base never reach env; claims never reach env.
          const envValues = new Set(Object.values(env));
          for (const [k] of Object.entries(env)) {
            expect(entries.some((e) => e.envName === k)).toBe(true);
          }
          expect(envValues.size).toBeLessThanOrEqual(entries.length);

          // Skipped '--' claim lines produce one warning each, naming the line number, not the text.
          expect(warnings).toHaveLength(skipped);
          const lines = values.claim!.split('\n');
          const skippedIdx = lines
            .map((l, i) => ({ t: l.trim(), n: i + 1 }))
            .filter((x) => x.t.startsWith('--'))
            .map((x) => x.n);
          // Exact message equality proves the line text is not echoed. A substring
          // check is unsound: a line like "--'" is a substring of the fixed message.
          expect(warnings).toEqual(
            skippedIdx.map((n) => `claim line ${n} starts with '--' and was skipped`),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sends nothing anywhere when every input is empty', () => {
    const { env, argv, warnings } = buildChildInvocation(inputsFrom({}));
    expect(env).toEqual({});
    expect(argv).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
