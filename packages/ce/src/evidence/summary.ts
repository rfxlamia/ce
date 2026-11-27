// Terminal_Summary: a pure function from a SummaryInput to at most 10 lines of
// text, outcome first (Requirement 8). It performs no I/O and decides no
// Outcome: it only reads the value it is given.
import type { Stage } from '../errors.js';
import type { Surface } from '../assessment/types.js';
import type { FinalState, Outcome, ResolveReason } from '../outcome/types.js';
import type { RunRecord } from './schema.js';

export type SummaryInput =
  | { kind: 'bundle'; record: RunRecord; reportPath: string }
  | {
      kind: 'no_bundle';
      outcome: Outcome;
      reason: ResolveReason;
      errorStage?: Stage;
      surface?: Surface;
      claimTexts?: string[];
      finalState?: FinalState;
      stepCount?: number;
      failureFields?: string[];
    };

const MAX_LINE = 200;
const ELLIPSIS = '…';
const MAX_FIELDS_SHOWN = 10;

/** Collapse whitespace so one value never spans more than one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Length in code points, the unit of the 200-character limit. */
function cpLength(text: string): number {
  return Array.from(text).length;
}

/** Cut `text` so that `prefix + text + suffix` has at most MAX_LINE characters, ending the text in `…`. */
function fit(prefix: string, text: string, suffix: string): string {
  const full = `${prefix}${text}${suffix}`;
  if (cpLength(full) <= MAX_LINE) return full;
  const room = MAX_LINE - cpLength(prefix) - cpLength(suffix) - cpLength(ELLIPSIS);
  const kept = Array.from(text).slice(0, Math.max(0, room)).join('');
  return `${prefix}${kept}${ELLIPSIS}${suffix}`;
}

/** Truncate a whole line to MAX_LINE characters, ending in `…`. */
function clamp(line: string): string {
  return fit('', line, '');
}

function claimLine(texts: readonly string[]): string {
  if (texts.length === 0) return 'Claim: no claim was identified';
  const rest = texts.length - 1;
  const suffix = rest > 0 ? ` (+${rest} more)` : '';
  return fit('Claim: ', oneLine(texts[0] ?? ''), suffix);
}

interface Facts {
  outcome: Outcome;
  reason: ResolveReason;
  stage?: Stage;
  surface?: Surface;
  decidedBy?: string;
  finalState?: FinalState | null;
  stepCount?: number;
}

function rationaleLine(f: Facts): string {
  let text: string;
  if (f.outcome === 'SKIPPED') {
    text = `evidence was not required (decided by ${f.decidedBy ?? 'unknown'})`;
  } else if (f.outcome === 'UNSUPPORTED') {
    text = `evidence was required, but the surface ${f.surface ?? 'unknown'} has no capability`;
  } else if (f.outcome === 'EVIDENCED') {
    const steps = f.stepCount === undefined ? 'unknown number of' : String(f.stepCount);
    text = `final state ${f.finalState ?? 'unknown'} after ${steps} steps`;
  } else {
    text = `failed at stage ${f.stage ?? 'unknown'}: ${f.reason}`;
  }
  return clamp(`Why: ${text}`);
}

export function buildSummary(input: SummaryInput): string {
  const lines: string[] = [];
  if (input.kind === 'bundle') {
    const r = input.record;
    lines.push(`Outcome: ${r.outcome}`);
    lines.push(claimLine(r.claims.map((c) => c.text)));
    lines.push(
      rationaleLine({
        outcome: r.outcome,
        reason: r.outcomeReason,
        stage: r.error?.stage,
        surface: r.assessment?.surface,
        decidedBy: r.assessment?.decidedBy,
        finalState: r.finalState,
        stepCount: r.steps.length,
      }),
    );
    lines.push(`Report: ${input.reportPath}`);
  } else {
    lines.push(`Outcome: ${input.outcome}`);
    lines.push(claimLine(input.claimTexts ?? []));
    lines.push(
      rationaleLine({
        outcome: input.outcome,
        reason: input.reason,
        stage: input.errorStage,
        surface: input.surface,
        finalState: input.finalState,
        stepCount: input.stepCount,
      }),
    );
    const fields = (input.failureFields ?? []).slice(0, MAX_FIELDS_SHOWN).map(oneLine);
    const detail = fields.length > 0 ? ` (failing fields: ${fields.join(', ')})` : '';
    lines.push(`Report: no bundle was written${detail}`);
  }
  return `${lines.join('\n')}\n`;
}
