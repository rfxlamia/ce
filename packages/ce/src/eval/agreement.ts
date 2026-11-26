/** Agreement row and disagreement computation for the eval runner. */

export interface AgreementRow {
  /** 'claim.is_behavior' | 'assess.runtime_observable' | 'assess.checks_adequate' | 'assess.surface' | 'assessment.required' | 'assessment.claimStatus' */
  question: string;
  samples: number;
  agreeing: number;
  /** `null` iff `samples === 0`, else `agreeing / samples`. */
  agreement: number | null;
}

/** What the classifier returned, beside the thresholded decision. */
export interface SampleDetail {
  /** Boolean questions: the returned probability compared with `threshold`. */
  probability?: number;
  threshold?: number;
  /** Surface: the confidence (probability) of the predicted label. */
  confidence?: number;
}

export interface Disagreement extends SampleDetail {
  fixtureId: string;
  question: string;
  /** Candidate text, or 'change'. */
  subject: string;
  /** The decision that was compared with the label (boolean after thresholding, or the label). */
  predicted: number | string | boolean;
  label: number | string | boolean;
}

/** One entry per sample (agreeing or not), so scores map back to fixtures. */
export interface EvalSample extends Disagreement {
  agreed: boolean;
}

export interface BucketRow {
  bucket: string;
  samples: number;
  agreeing: number;
  agreement: number | null;
}

export interface RowSample<T> extends SampleDetail {
  fixtureId: string;
  subject: string;
  predicted: T;
  label: T;
}

/** Generic comparator-driven row builder, reused for every question kind. */
export function buildRow<T extends number | string | boolean>(
  question: string,
  samples: readonly RowSample<T>[],
  equal: (predicted: T, label: T) => boolean,
): { row: AgreementRow; disagreements: Disagreement[]; samples: EvalSample[] } {
  const disagreements: Disagreement[] = [];
  const all: EvalSample[] = [];
  let agreeing = 0;
  for (const s of samples) {
    const agreed = equal(s.predicted, s.label);
    const entry: Disagreement = {
      fixtureId: s.fixtureId,
      question,
      subject: s.subject,
      predicted: s.predicted,
      label: s.label,
      ...(s.probability !== undefined ? { probability: s.probability } : {}),
      ...(s.threshold !== undefined ? { threshold: s.threshold } : {}),
      ...(s.confidence !== undefined ? { confidence: s.confidence } : {}),
    };
    all.push({ ...entry, agreed });
    if (agreed) agreeing += 1;
    else disagreements.push(entry);
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
    samples: all,
  };
}

/** Counts samples and agreeing samples per bucket, sorted by bucket name (code-unit order). */
export function buildBuckets<T>(
  samples: readonly { bucket: string; predicted: T; label: T }[],
): BucketRow[] {
  const map = new Map<string, { samples: number; agreeing: number }>();
  for (const s of samples) {
    const b = map.get(s.bucket) ?? { samples: 0, agreeing: 0 };
    b.samples += 1;
    if (s.predicted === s.label) b.agreeing += 1;
    map.set(s.bucket, b);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, b]) => ({
      bucket,
      samples: b.samples,
      agreeing: b.agreeing,
      agreement: b.samples === 0 ? null : b.agreeing / b.samples,
    }));
}
