import { describe, expect, it } from 'vitest';
import { buildDecisionRequest, buildOptions, mapAnswerToAction, type Option } from './decide.js';
import type { Observation, ObservedElement } from './observe.js';

const ORIGIN = 'http://127.0.0.1:5173';

function el(n: number, over: Partial<ObservedElement> = {}): ObservedElement {
  return { ref: `e${n}`, role: 'button', name: `Btn ${n}`, locator: `role=button[name="Btn ${n}"s]`, visible: true, enabled: true, fixtureKeys: [], ...over };
}
function obs(elements: ObservedElement[]): Observation {
  return { step: 0, url: `${ORIGIN}/a?x=1`, title: 'T', domDigest: 'd', elements, navigation: [], screenshot: 's.png' };
}
const base = { routes: [], targetOrigin: ORIGIN, fixtures: {}, changeTerms: new Set<string>() };

describe('buildOptions', () => {
  it('skips hidden, disabled and cross-origin elements; merges routes except observed links', () => {
    const o = obs([
      el(0),
      el(1, { visible: false }),
      el(2, { enabled: false }),
      el(3, { role: 'link', href: 'https://other.example/x' }),
      el(4, { role: 'link', name: 'About', href: `${ORIGIN}/about` }),
    ]);
    const options = buildOptions({ ...base, observation: o, routes: ['/about', '/pricing', '/pricing'] });
    expect(options.map((x) => x.description)).toEqual(['e0: button "Btn 0"', 'e4: link "About"', 'go to /pricing']);
  });

  it('adds fill options by key only and ranks by proximity', () => {
    const o = obs([el(0), el(1, { role: 'textbox', name: 'Email', fixtureKeys: ['email'] })]);
    const options = buildOptions({
      ...base,
      observation: o,
      fixtures: { email: 'secret@x.io' },
      changeTerms: new Set(['email']),
    });
    expect(options.map((x) => x.description)).toEqual([
      'e1: textbox "Email"',
      'e1: textbox "Email" fill from fixture "email"',
      'e0: button "Btn 0"',
    ]);
    expect(JSON.stringify(options)).not.toContain('secret@x.io');
  });
});

describe('buildDecisionRequest and mapAnswerToAction', () => {
  it('builds a text-only request with two questions, path-only state', () => {
    const request = buildDecisionRequest({
      claim: 'c', observation: obs([]), options: [], history: [{ step: 1, kind: 'click', description: 'e0: button "X"', result: 'changed' }],
      targetOrigin: ORIGIN, fixtureValues: [],
    });
    expect(Object.keys(request.questions)).toEqual(['next_action', 'state_reached_dom']);
    expect(typeof request.state).toBe('string');
    expect(request.state).toContain('page: /a?x=1');
    expect(request.state).toContain('step 1: click e0: button "X" -> changed');
    expect(request.state as string).not.toContain('127.0.0.1');
  });

  it('maps answers with tie-breaks and invalid keys', () => {
    const options: Option[] = [
      { kind: 'element', description: 'a', ref: 'e0', proximityScore: 0 },
      { kind: 'fill', description: 'b', ref: 'e1', fixtureKey: 'k', proximityScore: 0 },
      { kind: 'navigation', description: 'c', url: `${ORIGIN}/p`, proximityScore: 0 },
    ];
    const map = (probabilities: Record<string, number>) => mapAnswerToAction({ options, probabilities });
    expect(map({ '0': 0.1, '1': 0.9 })).toEqual({ kind: 'fill', ref: 'e1', fixtureKey: 'k' });
    expect(map({ '2': 1 })).toEqual({ kind: 'goto', url: `${ORIGIN}/p` });
    expect(map({ '1': 0.5, '0': 0.5, done: 0.5 })).toEqual({ kind: 'click', ref: 'e0' });
    expect(map({ done: 0.5, give_up: 0.5 })).toEqual({ kind: 'give_up', reason: 'invalid-answer' });
    expect(map({ done: 1 })).toEqual({ kind: 'done' });
    expect(map({ '7': 1 })).toEqual({ kind: 'give_up', reason: 'invalid-answer' });
    expect(map({ '01': 1 })).toEqual({ kind: 'give_up', reason: 'invalid-answer' });
  });
});
