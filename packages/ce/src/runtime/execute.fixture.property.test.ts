import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildOptions } from './decide.js';
import { execute } from './execute.js';
import { observe, type ActionableElementSnapshot, type Observation, type ObservedElement } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 12: Fixture matching and fill are total and fixture-value-free in text
// **Validates: Requirements 6.1, 6.2, 6.3, 6.5**

const ORIGIN = 'http://localhost:4000';
const KEY_POOL = ['email', 'password', 'username', 'q', 'toString'];
const ATTR_POOL = ['email', 'password', 'username', 'q', 'other', 'toString'];

/** Random casing and padding of a word, which must not change matching. */
const casedArb = (word: string): fc.Arbitrary<string> =>
  fc
    .tuple(fc.array(fc.boolean(), { minLength: word.length, maxLength: word.length }), fc.constantFrom('', ' ', '  '), fc.constantFrom('', ' '))
    .map(([flags, pre, post]) => pre + [...word].map((c, i) => (flags[i] ? c.toUpperCase() : c)).join('') + post);

const attrArb = fc.option(fc.constantFrom(...ATTR_POOL).chain(casedArb), { nil: undefined });

const fieldArb = fc.record({
  role: fc.constantFrom('textbox', 'textbox', 'textbox', 'button', 'link'),
  tag: fc.constantFrom('input', 'textarea'),
  inputType: fc.constantFrom('text', 'email', 'password', 'checkbox', 'submit'),
  nameAttr: attrArb,
  id: attrArb,
  autocomplete: fc.option(
    fc.array(fc.constantFrom(...ATTR_POOL, 'section-login', 'on'), { minLength: 1, maxLength: 3 }).map((t) => t.join(' ')),
    { nil: undefined },
  ),
  name: fc.oneof(fc.constant(''), fc.constantFrom(...ATTR_POOL).chain(casedArb), fc.constantFrom('Email address', 'Search')),
});

type Field = typeof fieldArb extends fc.Arbitrary<infer T> ? T : never;

function toSnapshot(f: Field): ActionableElementSnapshot {
  const snap: ActionableElementSnapshot = {
    tag: f.role === 'textbox' ? f.tag : f.role === 'link' ? 'a' : 'button',
    role: f.role,
    name: f.name.trim(),
    visible: true,
    enabled: true,
    cssPath: 'html > body > div:nth-of-type(1)',
  };
  if (snap.tag === 'input') snap.type = f.inputType;
  if (f.nameAttr !== undefined) snap.nameAttr = f.nameAttr;
  if (f.id !== undefined) snap.id = f.id;
  if (f.autocomplete !== undefined) snap.autocomplete = f.autocomplete;
  return snap;
}

const norm = (s: string): string => s.trim().toLowerCase();
const NON_TEXT = new Set(['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color']);

/** Independent oracle for Requirement 6.1. */
function expectedKeys(snap: ActionableElementSnapshot, keys: readonly string[]): string[] {
  if (snap.role !== 'textbox') return [];
  if (snap.tag === 'input' && (snap.type === undefined || NON_TEXT.has(snap.type))) return [];
  const candidates = [snap.nameAttr, snap.id, snap.name, ...(snap.autocomplete ?? '').split(/\s+/)]
    .filter((v): v is string => v !== undefined)
    .map(norm)
    .filter((v) => v.length > 0);
  return [...new Set(keys.filter((k) => candidates.includes(norm(k))))].sort();
}

function fakeObservePage(snapshots: ActionableElementSnapshot[]): PlaywrightPage {
  return { url: () => `${ORIGIN}/`, title: async () => 't', evaluate: async () => snapshots } as unknown as PlaywrightPage;
}

describe('Property 12: fixture matching and fill', () => {
  it('observe() sets fixtureKeys by case-insensitive, trimmed equality (6.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fieldArb, { minLength: 1, maxLength: 6 }),
        fc.uniqueArray(fc.constantFrom(...KEY_POOL).chain(casedArb), { maxLength: 5, selector: norm }),
        async (fields, keys) => {
          const snapshots = fields.map(toSnapshot);
          const obs = await observe({ page: fakeObservePage(snapshots), step: 0, targetOrigin: ORIGIN, fixtureKeys: keys });
          expect(obs.elements).toHaveLength(snapshots.length);
          obs.elements.forEach((el, i) => {
            expect(el.fixtureKeys).toEqual(expectedKeys(snapshots[i]!, keys));
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  const VALUE_PREFIX = 'VAL9x';
  const fixturesArb = fc
    .subarray(['email', 'password', 'username'])
    .chain((keys) =>
      fc
        .array(fc.stringMatching(/^[a-f0-9]{8}$/), { minLength: keys.length, maxLength: keys.length })
        .map((vals) => Object.fromEntries(keys.map((k, i) => [k, `${VALUE_PREFIX}${vals[i]}`]))),
    );

  function observationOf(fieldKeys: string[]): Observation {
    const el: ObservedElement = {
      ref: 'e1',
      role: 'textbox',
      name: 'Account',
      locator: '[data-testid="f1"]',
      visible: true,
      enabled: true,
      fixtureKeys: [...fieldKeys].sort(),
    };
    return { step: 0, url: `${ORIGIN}/`, title: 'T', domDigest: 'd', elements: [el], navigation: [], screenshot: 's.png' };
  }

  it('fill Options name the key and never the value; empty fixtures yield none (6.2, 6.5)', () => {
    fc.assert(
      fc.property(fixturesArb, fc.subarray(['email', 'password', 'username', 'q']), (fixtures, fieldKeys) => {
        const options = buildOptions({
          observation: observationOf(fieldKeys),
          routes: [],
          targetOrigin: ORIGIN,
          fixtures,
          changeTerms: new Set(),
        });
        const fills = options.filter((o) => o.kind === 'fill');
        const expected = fieldKeys.filter((k) => Object.prototype.hasOwnProperty.call(fixtures, k)).sort();
        expect(fills.map((o) => o.fixtureKey)).toEqual(expected);
        for (const o of options) {
          for (const value of Object.values(fixtures)) expect(o.description).not.toContain(value);
        }
        for (const o of fills) expect(o.description).toContain(`"${o.fixtureKey}"`);
        if (Object.keys(fixtures).length === 0) expect(fills).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('execute() fills only a known key present on the element, else refuses with unknown-fixture (6.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fixturesArb,
        fc.subarray(['email', 'password', 'username', 'q']),
        fc.constantFrom('email', 'password', 'username', 'q', 'toString', 'missing'),
        async (fixtures, fieldKeys, key) => {
          const filled: string[] = [];
          let locatorCalls = 0;
          const page = {
            locator: () => {
              locatorCalls++;
              return {
                count: async () => 1,
                click: async () => {},
                fill: async (v: string) => {
                  filled.push(v);
                },
              };
            },
            route: async () => {},
            unroute: async () => {},
            goto: async () => {},
          } as unknown as PlaywrightPage;

          const result = await execute({
            action: { kind: 'fill', ref: 'e1', fixtureKey: key },
            observation: observationOf(fieldKeys),
            page,
            targetOrigin: ORIGIN,
            fixtures,
            callTimeoutMs: 1000,
          });

          const known = Object.prototype.hasOwnProperty.call(fixtures, key) && fieldKeys.includes(key);
          if (known) {
            expect(result).toEqual({ status: 'ok', changed: true });
            expect(filled).toEqual([fixtures[key]]);
          } else {
            expect(filled).toEqual([]);
            expect(locatorCalls).toBe(0);
            expect(result.status).toBe('give_up');
            if (result.status === 'give_up') {
              expect(result.reason).toBe('unknown-fixture');
              expect(result.refusal.kind).toBe('refusal');
              for (const value of Object.values(fixtures)) expect(result.refusal.detail).not.toContain(value);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
