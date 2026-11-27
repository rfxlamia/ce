import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildDecisionRequest, buildStateText, type StepHistoryEntry } from './decide.js';
import type { Observation } from './observe.js';

// Feature: observe-decide-execute-loop, Property 9: State text is a deterministic, origin-free round trip

const text = fc.stringMatching(/^[A-Za-z0-9 _.-]{0,30}$/);
const pathArb = fc
  .array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { maxLength: 4 })
  .map((segments) => `/${segments.join('/')}`);

const historyArb: fc.Arbitrary<StepHistoryEntry[]> = fc.array(
  fc.record({
    step: fc.nat({ max: 50 }),
    kind: fc.constantFrom('click', 'fill', 'goto', 'done', 'give_up'),
    description: text,
    result: fc.constantFrom('changed', 'unchanged', 'refused'),
  }),
  { maxLength: 6 },
);

// Host and port never occur in the generated text (hyphen-free host with a reserved suffix).
const originArb = fc
  .tuple(fc.constantFrom('http', 'https'), fc.integer({ min: 10000, max: 65535 }))
  .map(([scheme, port]) => ({ origin: `${scheme}://zzhost.invalid:${port}`, scheme, port }));

describe('Property 9: State text is a deterministic, origin-free round trip', () => {
  /**
   * **Validates: Requirements 3.9, 12.16**
   */
  it('buildStateText is byte-identical for identical input and keeps the fixed history format', () => {
    fc.assert(
      fc.property(text, pathArb, text, historyArb, (claim, path, title, history) => {
        const input = { claim, path, title, history };
        const first = buildStateText(input);
        const second = buildStateText({ ...input, history: history.map((entry) => ({ ...entry })) });
        expect(second).toBe(first);
        for (const entry of history) {
          expect(first).toContain(`step ${entry.step}: ${entry.kind} ${entry.description} -> ${entry.result}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.9, 12.16**
   */
  it('the decision request state never contains the scheme, host or port of the Target_Origin', () => {
    fc.assert(
      fc.property(originArb, pathArb, text, text, historyArb, (target, path, claim, title, history) => {
        const observation = {
          step: 0,
          url: `${target.origin}${path}`,
          title,
          elements: [],
          navigation: [],
          screenshot: 'step-0.png',
          domDigest: 'd',
        } as unknown as Observation;
        const request = (origin: string) =>
          buildDecisionRequest({
            claim,
            observation: { ...observation, url: `${origin}${path}` },
            options: [],
            history,
            targetOrigin: origin,
            fixtureValues: [],
          });
        const a = request(target.origin);
        // Same scenario on a different scheme and port: identical bytes.
        const b = request(`http://zzhost.invalid:${target.port === 10000 ? 10001 : 10000}`);
        expect(a.state).toBe(b.state);
        expect(a.state).not.toContain('zzhost');
        expect(a.state).not.toContain(`${target.scheme}://`);
        expect(a.state).not.toContain(`:${target.port}`);
        expect(a.state).toContain(`page: ${path}`);
      }),
      { numRuns: 100 },
    );
  });
});
