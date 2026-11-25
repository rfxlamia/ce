import { describe, expect, it } from 'vitest';
import { CATALOG, SURFACE_LABELS, finalImageQuestions } from './catalog.js';

// Requirements 2.1, 2.2, 9.1-9.5, 9.7, 9.9, 9.13, 10.9, 19.17
const entries = Object.values(CATALOG);

describe('question catalog', () => {
  it('has exactly eight entries with the expected id, version and type', () => {
    const summary = Object.fromEntries(entries.map((e) => [e.idVersion, e.type]));
    expect(entries).toHaveLength(8);
    expect(summary).toEqual({
      'claim.is_behavior@1': 'noul',
      'assess.runtime_observable@1': 'noul',
      'assess.checks_adequate@1': 'noul',
      'assess.surface@1': 'choice',
      'runtime.next_action@1': 'choice',
      'runtime.state_reached_dom@1': 'noul',
      'runtime.state_reached@1': 'noul',
      'runtime.locate_subject@1': 'box',
    });
    for (const e of entries) expect(Number.isInteger(e.version)).toBe(true);
  });

  it('fixes the six surface labels', () => {
    const q = CATALOG.assessSurface.build();
    expect([...SURFACE_LABELS]).toEqual([
      'browser_ui',
      'http_api',
      'cli',
      'backend_internal',
      'native_app',
      'non_runtime',
    ]);
    expect(Object.keys(q.criteria)).toEqual([...SURFACE_LABELS]);
  });

  it('adds done and give_up to next_action options', () => {
    const q = CATALOG.runtimeNextAction.build(['click a', 'type b']);
    expect(Object.keys(q.criteria)).toEqual(['0', '1', 'done', 'give_up']);
  });

  it('sets labelsFixed only for assess.surface', () => {
    const fixed = entries.filter((e) => e.labelsFixed).map((e) => e.id);
    expect(fixed).toEqual(['assess.surface']);
  });

  it('sets requiresImage only for the two image entries', () => {
    const image = entries.filter((e) => e.requiresImage).map((e) => e.id);
    expect(image.sort()).toEqual(['runtime.locate_subject', 'runtime.state_reached']);
  });

  it('finalImageQuestions builds one request with both image questions', () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3);
    const request = finalImageQuestions('shows a banner', png);
    expect(Object.keys(request.questions).sort()).toEqual(['locate_subject', 'state_reached']);
    expect(request.questions['state_reached']?.idVersion).toBe('runtime.state_reached@1');
    expect(request.questions['locate_subject']?.idVersion).toBe('runtime.locate_subject@1');
    expect(Object.values(request.questions).every((q) => q.requiresImage)).toBe(true);
    expect(request.stage).toBe('runtime');
    expect(typeof request.state).not.toBe('string');
  });
});
