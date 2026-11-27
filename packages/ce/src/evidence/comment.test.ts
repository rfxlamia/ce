// Unit tests: one example per Outcome plus the unavailable record, and the
// small cases of the PR comment renderer (Requirements 8.4, 8.6-8.11, 8.13, 9.2, 10.6, 15.9).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { COMMENT_MARKER, renderPrComment, stripCommentMarker } from './comment.js';
import type { CommentInput } from './comment.js';
import {
  errorRunRecordArb,
  evidencedRunRecordArb,
  skippedRunRecordArb,
  unsupportedRunRecordArb,
} from './arbitraries.js';
import type { RunRecord } from './schema.js';
import { buildSummary } from './summary.js';

const LINK = 'https://github.com/o/r/actions/runs/1/artifacts/42';

function claim(i: number, text: string, probability: number | null = null): RunRecord['claims'][number] {
  return { id: `c${i}`, text, probability, provenance: { provider: 'cli' } } as never;
}

/** A sampled record with the fields the renderer reads replaced by fixed values. */
function make(arb: fc.Arbitrary<RunRecord>, patch: Record<string, unknown>): RunRecord {
  const [base] = fc.sample(arb, 1);
  return { ...base, claims: [claim(0, 'Users can log in', 0.5)], ...patch } as unknown as RunRecord;
}

function render(record: RunRecord | CommentInput['record'], artifactLink = LINK): string {
  return renderPrComment({ record, artifactLink, secrets: [] });
}

/** The `Why:` line that the Terminal_Summary prints for the same record. */
function summaryWhy(record: RunRecord): string {
  const line = buildSummary({ kind: 'bundle', record, reportPath: 'r.html' })
    .split('\n')
    .find((l) => l.startsWith('Why: '));
  if (line === undefined) throw new Error('no Why line');
  return line;
}

const steps3 = [{}, {}, {}];

describe('renderPrComment examples', () => {
  it('SKIPPED states decidedBy and outcomeReason (8.6)', () => {
    const record = make(skippedRunRecordArb, {
      outcome: 'SKIPPED',
      outcomeReason: 'not-required',
      assessment: { required: false, decidedBy: 'policy', surface: 'browser_ui' },
      steps: [],
      error: undefined,
    });
    const lines = render(record).split('\n');
    expect(lines[0]).toBe(COMMENT_MARKER);
    expect(lines[1]).toBe('Outcome: SKIPPED');
    expect(lines).toContain('Evidence was not required: decided by policy, reason not-required.');
    expect(lines).toContain(summaryWhy(record));
    expect(lines).toContain(`Artifact: ${LINK}`);
  });

  it('EVIDENCED states finalState, step count and the not-a-verdict note (8.11)', () => {
    const record = make(evidencedRunRecordArb, {
      outcome: 'EVIDENCED',
      outcomeReason: 'evidence-collected',
      finalState: 'reached',
      steps: steps3,
    });
    const body = render(record);
    const lines = body.split('\n');
    expect(lines[1]).toBe('Outcome: EVIDENCED');
    expect(lines).toContain(
      'Final state reached after 3 steps. This evidence is for inspection and is not a verdict.',
    );
    expect(lines).toContain(summaryWhy(record));
    expect(lines).toContain('- Users can log in (signal: 0.50)');
  });

  it('UNSUPPORTED states the surface without a capability (8.9)', () => {
    const record = make(unsupportedRunRecordArb, {
      outcome: 'UNSUPPORTED',
      outcomeReason: 'surface-unsupported',
      assessment: { required: true, decidedBy: 'classifier', surface: 'backend_internal' },
      steps: [],
    });
    const lines = render(record).split('\n');
    expect(lines[1]).toBe('Outcome: UNSUPPORTED');
    expect(lines).toContain('No capability exists for the surface backend\\_internal.');
    expect(lines).toContain(summaryWhy(record));
  });

  it('ERROR states stage and reason, and no underlying message (8.10)', () => {
    const record = make(errorRunRecordArb, {
      outcome: 'ERROR',
      outcomeReason: 'stage-error',
      error: { stage: 'runtime', reason: 'stage-error', cause: 'boom at /secret/path.ts:1' },
      steps: [],
    });
    const body = render(record);
    const lines = body.split('\n');
    expect(lines[1]).toBe('Outcome: ERROR');
    expect(lines).toContain('Stage runtime, reason stage-error.');
    expect(lines).toContain(summaryWhy(record));
    expect(body).not.toContain('boom');
  });

  it('unavailable record shows unknown outcome, exit code and no claims (8.8)', () => {
    const body = render({ kind: 'unavailable', exitCode: 3 }, '');
    const lines = body.split('\n');
    expect(lines[0]).toBe(COMMENT_MARKER);
    expect(lines[1]).toBe('Outcome: unknown (no run record)');
    expect(lines).toContain('CE exit code: 3');
    expect(lines).toContain('No claim was identified.');
    expect(lines).toContain('Artifact: the evidence artifact is unavailable.');
    for (const o of ['SKIPPED', 'EVIDENCED', 'UNSUPPORTED', 'ERROR']) expect(body).not.toContain(o);
  });
});

describe('renderPrComment small cases', () => {
  it('states that no claim was identified and lists no claim text (8.4)', () => {
    const body = render(make(evidencedRunRecordArb, { claims: [], steps: steps3, finalState: 'reached' }));
    expect(body).toContain('No claim was identified.');
    expect(body).not.toContain('Claims:');
    expect(body).not.toContain('more claims');
  });

  it('lists 10 claims and a (+N more claims) line (8.13)', () => {
    const claims = Array.from({ length: 12 }, (_, i) => claim(i, `claim number ${i}`));
    const lines = render(make(evidencedRunRecordArb, { claims, steps: steps3, finalState: 'reached' })).split('\n');
    expect(lines.filter((l) => l.startsWith('- '))).toHaveLength(10);
    expect(lines).toContain('(+2 more claims)');
  });

  it('states the artifact is unavailable for an empty link (8.7)', () => {
    const body = render(make(evidencedRunRecordArb, { steps: steps3, finalState: 'reached' }), '');
    expect(body).toContain('Artifact: the evidence artifact is unavailable.');
    expect(body).not.toContain('https://');
  });

  it('stripCommentMarker removes only the marker line (10.6)', () => {
    const body = render({ kind: 'unavailable', exitCode: 1 }, '');
    const stripped = stripCommentMarker(body);
    expect(stripped).not.toContain(COMMENT_MARKER);
    expect(stripped.startsWith('Outcome: unknown (no run record)')).toBe(true);
    expect(`${COMMENT_MARKER}\n${stripped}`).toBe(body);
    expect(stripCommentMarker('no marker here')).toBe('no marker here');
  });
});
