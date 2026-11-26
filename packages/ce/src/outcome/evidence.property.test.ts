import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbEvidenceSummary, arbPassingSummary } from './arbitraries.js';
import { satisfiesMinimumEvidence } from './evidence.js';
import type { EvidenceSummary } from './evidence.js';
import type { Provenance } from '../context/types.js';

const NUM_RUNS = 300;

function filled(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

/** The six conditions of Requirement 7 criterion 3, computed from the summary. */
function sixConditions(s: EvidenceSummary): boolean[] {
  const change =
    [s.change.title, s.change.description, s.change.base, s.change.head].some(filled) ||
    s.change.files.length >= 1;
  const claim =
    s.claim.status === 'not_identified' || (filled(s.claim.id) && filled(s.claim.text));
  const subject = filled(s.subject.url);
  const actions = Array.isArray(s.actions);
  const observations = s.observations.length >= 1 && s.observations.every((o) => filled(o.screenshot));
  const artifacts = filled(s.artifacts.runDir) && filled(s.artifacts.reportPath);
  return [change, claim, subject, actions, observations, artifacts];
}

describe('outcome-resolver Property 15: satisfiesMinimumEvidence matches the six-condition specification', () => {
  // Feature: outcome-resolver, Property 15: satisfiesMinimumEvidence matches the six-condition specification exactly
  // **Validates: Requirements 7.3, 7.4, 7.5**
  it('equals the AND of the six independently computed conditions', () => {
    fc.assert(
      fc.property(arbEvidenceSummary, (summary) => {
        const expected = sixConditions(summary).every(Boolean);
        expect(satisfiesMinimumEvidence(summary)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const arbBlankish = fc.constantFrom('', ' ', '\t', '\n', '  \n ');
const arbMaybeBlank = fc.oneof(arbBlankish, fc.string());
const arbOptMaybeBlank = fc.option(arbMaybeBlank, { nil: undefined });

/** Summaries with empty or whitespace strings and empty lists in every position. */
const arbDegenerateSummary: fc.Arbitrary<EvidenceSummary> = fc.record({
  change: fc.record({
    title: arbOptMaybeBlank,
    description: arbOptMaybeBlank,
    base: arbOptMaybeBlank,
    head: arbOptMaybeBlank,
    files: fc.oneof(fc.constant<string[]>([]), fc.array(arbMaybeBlank, { maxLength: 3 })),
  }),
  claim: fc.oneof(
    fc.constant<EvidenceSummary['claim']>({ status: 'not_identified' }),
    fc.record({
      status: fc.constant('identified' as const),
      id: arbMaybeBlank,
      text: arbMaybeBlank,
      provenance: fc.constant({ provider: 'cli' } as unknown as Provenance),
    }),
  ),
  subject: fc.record({ url: arbMaybeBlank }),
  actions: fc.oneof(
    fc.constant<EvidenceSummary['actions']>([]),
    fc.array(fc.record({ kind: arbMaybeBlank, description: arbMaybeBlank }), { maxLength: 3 }),
  ),
  observations: fc.oneof(
    fc.constant<EvidenceSummary['observations']>([]),
    fc.array(fc.record({ step: fc.integer(), screenshot: arbMaybeBlank }), { maxLength: 3 }),
  ),
  artifacts: fc.record({ runDir: arbMaybeBlank, reportPath: arbMaybeBlank }),
});

describe('outcome-resolver Property 16: satisfiesMinimumEvidence is total', () => {
  // Feature: outcome-resolver, Property 16: satisfiesMinimumEvidence is total
  // **Validates: Requirements 7.6**
  it('returns a boolean and never throws for any EvidenceSummary', () => {
    fc.assert(
      fc.property(fc.oneof(arbEvidenceSummary, arbDegenerateSummary), (summary) => {
        let result: unknown;
        expect(() => {
          result = satisfiesMinimumEvidence(summary);
        }).not.toThrow();
        expect(typeof result).toBe('boolean');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('outcome-resolver Property 17: every Evidence_Summary item is necessary', () => {
  // Feature: outcome-resolver, Property 17: Every one of the five Evidence_Summary items is necessary
  // **Validates: Requirements 8.4**
  const arbBlank = fc.constantFrom('', ' ', '\t', '\n', '  \n ');
  const arbWhich = fc.constantFrom('id', 'text', 'both') as fc.Arbitrary<'id' | 'text' | 'both'>;
  const arbArtifactWhich = fc.constantFrom('runDir', 'reportPath', 'both') as fc.Arbitrary<
    'runDir' | 'reportPath' | 'both'
  >;

  it('a passing summary stays passing before any item is emptied', () => {
    fc.assert(
      fc.property(arbPassingSummary, (summary) => {
        expect(satisfiesMinimumEvidence(summary)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emptying the change fails the check', () => {
    fc.assert(
      fc.property(arbPassingSummary, arbBlank, (summary, blank) => {
        const emptied: EvidenceSummary = {
          ...summary,
          change: { title: blank, description: blank, base: blank, head: blank, files: [] },
        };
        expect(satisfiesMinimumEvidence(emptied)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emptying the claim (identified with blank id or text) fails the check', () => {
    fc.assert(
      fc.property(
        arbPassingSummary,
        arbBlank,
        arbWhich,
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
        (summary, blank, which, other) => {
          const provenance =
            summary.claim.status === 'identified'
              ? summary.claim.provenance
              : ({ provider: 'cli' } as unknown as Provenance);
          const emptied: EvidenceSummary = {
            ...summary,
            claim: {
              status: 'identified',
              id: which === 'text' ? other : blank,
              text: which === 'id' ? other : blank,
              provenance,
            },
          };
          expect(satisfiesMinimumEvidence(emptied)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('emptying the subject fails the check', () => {
    fc.assert(
      fc.property(arbPassingSummary, arbBlank, (summary, blank) => {
        expect(satisfiesMinimumEvidence({ ...summary, subject: { url: blank } })).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emptying the observations fails the check', () => {
    fc.assert(
      fc.property(arbPassingSummary, (summary) => {
        expect(satisfiesMinimumEvidence({ ...summary, observations: [] })).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emptying the artifacts fails the check', () => {
    fc.assert(
      fc.property(arbPassingSummary, arbBlank, arbArtifactWhich, (summary, blank, which) => {
        const artifacts = {
          runDir: which === 'reportPath' ? summary.artifacts.runDir : blank,
          reportPath: which === 'runDir' ? summary.artifacts.reportPath : blank,
        };
        expect(satisfiesMinimumEvidence({ ...summary, artifacts })).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('replacing the claim with not_identified still passes', () => {
    fc.assert(
      fc.property(arbPassingSummary, (summary) => {
        expect(
          satisfiesMinimumEvidence({ ...summary, claim: { status: 'not_identified' } }),
        ).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('outcome-resolver Property 18: no fabricated claim', () => {
  // Feature: outcome-resolver, Property 18: No fabricated claim
  // **Validates: Requirements 7.4, 7.5, 8.5**
  const arbNonEmptyText = fc.string({ minLength: 1 }).filter((s) => s.trim() !== '');
  const arbBlank = fc.constantFrom('', ' ', '\t', '\n', '  \n ');

  it('ignores extra text attached to a not_identified claim', () => {
    fc.assert(
      fc.property(arbPassingSummary, arbNonEmptyText, (summary, text) => {
        const plain: EvidenceSummary = { ...summary, claim: { status: 'not_identified' } };
        const withText = {
          ...summary,
          claim: { status: 'not_identified', text },
        } as unknown as EvidenceSummary;
        expect(satisfiesMinimumEvidence(withText)).toBe(satisfiesMinimumEvidence(plain));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never passes an identified claim whose text is empty or whitespace-only', () => {
    fc.assert(
      fc.property(arbPassingSummary, arbBlank, arbNonEmptyText, (summary, blank, id) => {
        const provenance =
          summary.claim.status === 'identified'
            ? summary.claim.provenance
            : ({ provider: 'cli' } as unknown as Provenance);
        const blanked: EvidenceSummary = {
          ...summary,
          claim: { status: 'identified', id, text: blank, provenance },
        };
        expect(satisfiesMinimumEvidence(blanked)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
