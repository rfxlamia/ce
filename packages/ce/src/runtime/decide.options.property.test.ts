import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_NEXT_ACTION_OPTIONS } from './constants.js';
import { buildOptions, proximityScore, type Option } from './decide.js';
import type { Observation, ObservedElement } from './observe.js';

// Feature: observe-decide-execute-loop, Property 4: Option ranking, cap and determinism
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 12.2**

const ORIGIN = 'http://localhost:4000';
const VOCAB = ['menu', 'settings', 'theme', 'save', 'close', 'language', 'open', 'help'];
const ROUTE_POOL = ['/p0', '/p1', '/p2', '/r1', '/r2', '/settings', 'https://other.example/x'];
const FIXTURE_VALUES: Record<string, string> = { email: 'Zq9-secret-mail', password: 'Zq9-secret-pass' };

const elementArb = (index: number): fc.Arbitrary<ObservedElement> =>
  fc
    .record({
      role: fc.constantFrom('button', 'link', 'option', 'textbox'),
      words: fc.array(fc.constantFrom(...VOCAB), { maxLength: 3 }),
      visible: fc.boolean(),
      enabled: fc.boolean(),
      hrefKind: fc.constantFrom('none', 'on', 'on', 'off'),
      hrefN: fc.integer({ min: 0, max: 4 }),
      fixtureKeys: fc.subarray(['email', 'password']),
    })
    .map((r) => {
      const el: ObservedElement = {
        ref: `e${index + 1}`,
        role: r.role,
        name: r.words.join(' '),
        locator: `[data-testid="t${index}"]`,
        visible: r.visible,
        enabled: r.enabled,
        fixtureKeys: r.role === 'textbox' ? [...r.fixtureKeys].sort() : [],
      };
      if (r.role === 'link' && r.hrefKind !== 'none') {
        el.href = r.hrefKind === 'on' ? `${ORIGIN}/p${r.hrefN}` : `https://other.example/p${r.hrefN}`;
      }
      return el;
    });

const elementsArb = (min: number, max: number): fc.Arbitrary<ObservedElement[]> =>
  fc.integer({ min, max }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => elementArb(i))));

const fixturesArb = fc
  .subarray(['email', 'password'])
  .map((keys) => Object.fromEntries(keys.map((k) => [k, FIXTURE_VALUES[k]!])));

const termsArb = fc.subarray(VOCAB).map((t) => new Set(t));
const routesArb = fc.array(fc.constantFrom(...ROUTE_POOL), { maxLength: 6 });

function observationOf(elements: ObservedElement[]): Observation {
  return {
    step: 0,
    url: `${ORIGIN}/`,
    title: 'Demo',
    domDigest: 'd',
    elements,
    navigation: [],
    screenshot: 'step-0.png',
  };
}

function build(
  elements: ObservedElement[],
  routes: string[],
  fixtures: Record<string, string>,
  terms: Set<string>,
): Option[] {
  return buildOptions({
    observation: observationOf(elements),
    routes,
    targetOrigin: ORIGIN,
    fixtures,
    changeTerms: terms,
  });
}

describe('buildOptions properties', () => {
  it('contains only eligible Options, ranked by score with document-then-routes tie-break', () => {
    fc.assert(
      fc.property(elementsArb(0, 12), routesArb, fixturesArb, termsArb, (elements, routes, fixtures, terms) => {
        const options = build(elements, routes, fixtures, terms);

        // Element Options: exactly the visible, enabled, non-cross-origin elements.
        const expectedRefs = elements
          .filter((e) => e.visible && e.enabled && (e.href === undefined || e.href.startsWith(ORIGIN)))
          .map((e) => e.ref);
        const elementRefs = options.filter((o) => o.kind === 'element').map((o) => o.ref!);
        expect([...elementRefs].sort()).toEqual([...expectedRefs].sort());

        // Fill Options: only for fixture keys that are configured, on eligible elements, key only.
        for (const o of options.filter((x) => x.kind === 'fill')) {
          const el = elements.find((e) => e.ref === o.ref)!;
          expect(expectedRefs).toContain(el.ref);
          expect(el.fixtureKeys).toContain(o.fixtureKey);
          expect(Object.keys(fixtures)).toContain(o.fixtureKey);
        }
        for (const o of options) {
          for (const value of Object.values(fixtures)) expect(o.description).not.toContain(value);
        }
        if (Object.keys(fixtures).length === 0) expect(options.some((o) => o.kind === 'fill')).toBe(false);

        // Navigation Options: on-origin routes not already an observed link href, no duplicates.
        const observedHrefs = new Set(elements.filter((e) => e.href).map((e) => new URL(e.href!).href));
        const resolvedRoutes = routes.map((r) => new URL(r, ORIGIN).href);
        const expectedNav = [
          ...new Set(resolvedRoutes.filter((u) => u.startsWith(ORIGIN) && !observedHrefs.has(u))),
        ];
        const navUrls = options.filter((o) => o.kind === 'navigation').map((o) => o.url!);
        expect([...navUrls].sort()).toEqual([...expectedNav].sort());
        for (const url of navUrls) expect(observedHrefs.has(url)).toBe(false);

        // Ranking: non-increasing score; ties by document order, then routes order.
        const position = (o: Option): [number, number] =>
          o.kind === 'navigation'
            ? [1, resolvedRoutes.indexOf(o.url!)]
            : [0, elements.findIndex((e) => e.ref === o.ref)];
        for (let i = 1; i < options.length; i += 1) {
          const prev = options[i - 1]!;
          const cur = options[i]!;
          expect(prev.proximityScore).toBeGreaterThanOrEqual(cur.proximityScore);
          if (prev.proximityScore === cur.proximityScore) {
            const [pg, pi] = position(prev);
            const [cg, ci] = position(cur);
            expect(pg < cg || (pg === cg && pi <= ci)).toBe(true);
          }
        }
        for (const o of options) expect(Number.isInteger(o.proximityScore) && o.proximityScore >= 0).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic across repeated calls with the same inputs', () => {
    fc.assert(
      fc.property(elementsArb(0, 12), routesArb, fixturesArb, termsArb, (elements, routes, fixtures, terms) => {
        const a = build(elements, routes, fixtures, terms);
        const b = build(structuredClone(elements), [...routes], { ...fixtures }, new Set(terms));
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 100 },
    );
  });

  it('keeps document then routes order, all scores 0, when Change_Terms is empty', () => {
    fc.assert(
      fc.property(elementsArb(0, 12), routesArb, fixturesArb, (elements, routes, fixtures) => {
        const options = build(elements, routes, fixtures, new Set());
        expect(options.every((o) => o.proximityScore === 0)).toBe(true);
        const groups = options.map((o) => (o.kind === 'navigation' ? 1 : 0));
        expect(groups).toEqual([...groups].sort((a, b) => a - b));
        const docIdx = options
          .filter((o) => o.kind !== 'navigation')
          .map((o) => elements.findIndex((e) => e.ref === o.ref));
        expect(docIdx).toEqual([...docIdx].sort((a, b) => a - b));
      }),
      { numRuns: 100 },
    );
  });

  it('never exceeds the cap and keeps the highest-ranked Options when more exist', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_NEXT_ACTION_OPTIONS + 1, max: MAX_NEXT_ACTION_OPTIONS + 60 }),
        fc.array(fc.constantFrom(...VOCAB), { minLength: 1, maxLength: 3 }),
        fc.subarray(VOCAB, { minLength: 1 }),
        (count, words, termList) => {
          const terms = new Set(termList);
          // Highest-scoring element sits last in document order; it must survive the cap.
          const elements: ObservedElement[] = Array.from({ length: count }, (_, i) => ({
            ref: `e${i + 1}`,
            role: 'button',
            name: i === count - 1 ? [...termList].join(' ') : words.join(' '),
            locator: `[data-testid="t${i}"]`,
            visible: true,
            enabled: true,
            fixtureKeys: [],
          }));
          const options = build(elements, [], {}, terms);
          expect(options.length).toBe(MAX_NEXT_ACTION_OPTIONS);
          const best = Math.max(...elements.map((e) => proximityScore(`${e.role} ${e.name}`, terms)));
          expect(options[0]!.proximityScore).toBe(best);
          const lastScore = proximityScore(`button ${elements[count - 1]!.name}`, terms);
          const otherScore = proximityScore(`button ${words.join(' ')}`, terms);
          // A strictly better-ranked element must survive the cap; equal scores may be cut.
          if (lastScore > otherScore) expect(options.map((o) => o.ref)).toContain(`e${count}`);
        },
      ),
      { numRuns: 100 },
    );
  });
});
