/** Agreement row and disagreement computation for the eval runner. */

export interface AgreementRow {
  /** 'claim.is_behavior' | 'assess.runtime_observable' | 'assess.checks_adequate' | 'assess.surface' | 'assessment.required' | 'assessment.claimStatus' */
  question: string;
  samples: number;
  agreeing: number;
  /** `null` iff `samples === 0`, else `agreeing / samples`. */
  agreement: number | null;
}

export interface Disagreement {
  fixtureId: string;
  question: string;
  /** Candidate text, or 'change'. */
  subject: string;
  predicted: number | string | boolean;
  label: number | string | boolean;
}

/** Generic comparator-driven row builder, reused for every question kind. */
export function buildRow<T extends number | string | boolean>(
  question: string,
  samples: readonly { fixtureId: string; subject: string; predicted: T; label: T }[],
  equal: (predicted: T, label: T) => boolean,
): { row: AgreementRow; disagreements: Disagreement[] } {
  const disagreements: Disagreement[] = [];
  let agreeing = 0;
  for (const s of samples) {
    if (equal(s.predicted, s.label)) {
      agreeing += 1;
    } else {
      disagreements.push({
        fixtureId: s.fixtureId,
        question,
        subject: s.subject,
        predicted: s.predicted,
        label: s.label,
      });
    }
  }
  const count = samples.length;
  return {
    row: {
      question,
      samples: count,
      agreeing,
      agreement: count === 0 ? null : agreeing / count,
    },
    disagreements,
  };
}
