import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { observe, type ActionableElementSnapshot } from './observe.js';
import type { PlaywrightPage } from './playwright-types.js';

const ORIGIN = 'http://localhost:4000';
const ROLES = ['button', 'link', 'menuitem', 'option', 'tab', 'combobox', 'checkbox', 'radio', 'switch', 'textbox'];

/** A fake page that only answers what `observe()` asks: evaluate, url and title. */
function fakePage(snapshots: ActionableElementSnapshot[], url: string, title: string): PlaywrightPage {
  return {
    url: () => url,
    title: async () => title,
    evaluate: async () => snapshots,
  } as unknown as PlaywrightPage;
}

const snapshotArb = (index: number): fc.Arbitrary<ActionableElementSnapshot> =>
  fc
    .record({
      role: fc.constantFrom(...ROLES),
      name: fc.oneof(fc.constant(''), fc.string({ maxLength: 40 }).map((s) => s.replace(/[\s\p{Cc}]+/gu, ' ').trim())),
      hasTestId: fc.boolean(),
      hasId: fc.boolean(),
      visible: fc.boolean(),
      enabled: fc.boolean(),
      linkPath: fc.option(fc.constantFrom('/a', '/b', '/c?x=1'), { nil: undefined }),
      offOrigin: fc.boolean(),
      nameAttr: fc.option(fc.constantFrom('email', 'Password', 'q'), { nil: undefined }),
    })
    .map((r) => {
      const snap: ActionableElementSnapshot = {
        tag: r.role === 'link' ? 'a' : r.role === 'textbox' ? 'input' : 'div',
        role: r.role,
        name: r.name,
        visible: r.visible,
        enabled: r.enabled,
        cssPath: `html > body > div:nth-of-type(${index + 1})`,
      };
      if (r.role === 'textbox') snap.type = 'text';
      if (r.nameAttr) snap.nameAttr = r.nameAttr;
      if (r.hasTestId) {
        snap.testId = `tid-${index}`;
        snap.testIdUnique = true;
      }
      if (r.hasId) {
        snap.id = `id-${index}`;
        snap.idUnique = true;
      }
      if (r.role === 'link' && r.linkPath) {
        snap.href = `${r.offOrigin ? 'http://other.example' : ORIGIN}${r.linkPath}`;
      }
      return snap;
    });

const snapshotsArb = fc
  .integer({ min: 0, max: 15 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => snapshotArb(i))).map((a) => a as ActionableElementSnapshot[]));

const pageArb = fc.record({
  snapshots: snapshotsArb,
  url: fc.constantFrom(`${ORIGIN}/`, `${ORIGIN}/x?y=1`),
  title: fc.string({ maxLength: 30 }),
  step: fc.integer({ min: 0, max: 50 }),
  fixtureKeys: fc.subarray(['email', 'password', 'q']),
});

describe('observe() structure and stability', () => {
  // Feature: observe-decide-execute-loop, Property 1: Observation structure is total and complete
  /** **Validates: Requirements 1.1, 1.2, 1.7** */
  it('Property 1: returns one fully populated element per snapshot and all observation fields', async () => {
    await fc.assert(
      fc.asyncProperty(pageArb, async ({ snapshots, url, title, step, fixtureKeys }) => {
        const obs = await observe({ page: fakePage(snapshots, url, title), step, targetOrigin: ORIGIN, fixtureKeys });
        expect(obs.elements).toHaveLength(snapshots.length);
        expect(obs.step).toBe(step);
        expect(typeof obs.url).toBe('string');
        expect(typeof obs.title).toBe('string');
        expect(obs.domDigest.length).toBeGreaterThan(0);
        expect(Array.isArray(obs.navigation)).toBe(true);
        obs.elements.forEach((el, i) => {
          const snap = snapshots[i]!;
          expect(el.role).toBe(snap.role);
          expect(typeof el.name).toBe('string');
          if (snap.name === '') expect(el.name).toBe('');
          expect(el.locator.length).toBeGreaterThan(0);
          expect(el.visible).toBe(snap.visible);
          expect(el.enabled).toBe(snap.enabled);
          expect(Array.isArray(el.fixtureKeys)).toBe(true);
        });
        // navigation: absolute, on-origin only
        for (const nav of obs.navigation) expect(new URL(nav).origin).toBe(ORIGIN);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: observe-decide-execute-loop, Property 2: Refs and locators are stable and unique across repeated observation
  /** **Validates: Requirements 1.3, 1.5, 1.6** */
  it('Property 2: refs are unique, in document order, and repeat observation is identical', async () => {
    await fc.assert(
      fc.asyncProperty(pageArb, async ({ snapshots, url, title, step, fixtureKeys }) => {
        const opts = { page: fakePage(snapshots, url, title), step, targetOrigin: ORIGIN, fixtureKeys };
        const first = await observe(opts);
        const second = await observe(opts);

        const refs = first.elements.map((e) => e.ref);
        expect(new Set(refs).size).toBe(refs.length);
        expect(refs).toEqual(snapshots.map((_, i) => `e${i}`));

        const locators = first.elements.map((e) => e.locator);
        expect(new Set(locators).size).toBe(locators.length);

        expect(second.elements.map((e) => e.ref)).toEqual(refs);
        expect(second.elements.map((e) => e.locator)).toEqual(locators);
        expect(second.domDigest).toBe(first.domDigest);
        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });
});
