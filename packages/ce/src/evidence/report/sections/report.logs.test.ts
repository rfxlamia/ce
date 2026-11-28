import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evidencedRunRecordArb } from '../../arbitraries.js';
import type { RunRecord } from '../../schema.js';
import { renderLogs, stopReasonMeaning } from './logs.js';

type StopReason = NonNullable<RunRecord['runtime']>['stopReason'];

function base(): RunRecord {
  const [record] = fc.sample(evidencedRunRecordArb, { numRuns: 1, seed: 14 });
  return record as RunRecord;
}

function withRuntime(stopReason: StopReason): RunRecord {
  const r = base();
  if (r.runtime === null) throw new Error('fixture needs a runtime');
  return { ...r, runtime: { ...r.runtime, stopReason } };
}

const REASONS: ReadonlyArray<[StopReason, RegExp]> = [
  ['done', /task complete/],
  ['reached', /state described by the Claim was reached/],
  ['give_up', /chose to give up/],
  ['max-steps', /step budget/],
  ['time-budget', /time budget/],
  ['aborted', /aborted/],
];

describe('stopReasonMeaning (8.2)', () => {
  it.each(REASONS)('gives a one-sentence meaning for %s', (reason, pattern) => {
    const text = stopReasonMeaning(reason);
    expect(text).toMatch(pattern);
    expect(text.endsWith('.')).toBe(true);
  });

  it('gives all stop reasons distinct sentences', () => {
    const all = REASONS.map(([r]) => stopReasonMeaning(r));
    expect(new Set(all).size).toBe(REASONS.length);
  });

  it('gives a neutral sentence for an unknown value', () => {
    expect(stopReasonMeaning('bogus')).toMatch(/does not recognize/);
    expect(stopReasonMeaning('toString')).toMatch(/does not recognize/);
  });
});

describe('renderLogs', () => {
  it.each(REASONS)('renders the stop reason %s with its sentence (8.2)', (reason) => {
    const html = renderLogs(withRuntime(reason));
    expect(html).toContain(`<span class="mono">${reason}</span>`);
    expect(html).toContain(stopReasonMeaning(reason));
  });

  it('shows "No runtime events" for an empty event log (8.1)', () => {
    const html = renderLogs({ ...base(), eventLog: [] });
    expect(html).toContain('No runtime events');
    expect(html).not.toContain('<table class="event-log">');
  });

  it('shows "not started" for a null stage timing (8.4)', () => {
    const r = base();
    const html = renderLogs({
      ...r,
      timings: { ...r.timings, stages: { ...r.timings.stages, runtime: null, assessment: null } },
    });
    expect(html).toContain('assessment not started');
    expect(html).toContain('runtime not started');
  });

  it('shows a duration for a recorded stage timing (8.4)', () => {
    const r = base();
    const html = renderLogs({
      ...r,
      timings: { ...r.timings, stages: { ...r.timings.stages, config: 250, context: 1500 } },
    });
    expect(html).toContain('config 250 ms');
    expect(html).toContain('context 1.5 s');
  });

  it('states that no Jev call returned a model for empty jevModels (8.5, 8.6)', () => {
    const html = renderLogs({ ...base(), jevModels: [] });
    expect(html).toContain('No Jev call returned a model id.');
  });

  it('lists returned models when present (8.5)', () => {
    const html = renderLogs({ ...base(), jevModels: ['typesafe/jev-1.14-20260101'] });
    expect(html).toContain('typesafe/jev-1.14-20260101');
    expect(html).not.toContain('No Jev call returned a model id.');
  });
});
