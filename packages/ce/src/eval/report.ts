// Eval report (Requirements 13.12, 14.5). Prints only counts, question ids, fixture ids and
// candidate text from the labelled fixtures. It never receives keys, headers or request state.

import type { AgreementRow, Disagreement } from './agreement.js';

export interface ReportInput {
  rows: readonly AgreementRow[];
  disagreements: readonly Disagreement[];
}

export function formatPercentage(agreement: number | null): string {
  return agreement === null ? 'n/a' : `${(agreement * 100).toFixed(1)}%`;
}

export function formatRow(row: AgreementRow): string {
  return `${row.question}  samples=${row.samples}  agreeing=${row.agreeing}  agreement=${formatPercentage(row.agreement)}`;
}

export function formatDisagreement(d: Disagreement): string {
  return `${d.fixtureId}  ${d.question}  subject=${JSON.stringify(d.subject)}  predicted=${String(d.predicted)}  label=${String(d.label)}`;
}

/** Table of rows followed by the disagreement list. Ends with a newline. */
export function formatReport(input: ReportInput): string {
  const lines: string[] = input.rows.map(formatRow);
  lines.push('');
  if (input.disagreements.length === 0) {
    lines.push('Disagreements: none');
  } else {
    lines.push(`Disagreements (${input.disagreements.length}):`);
    for (const d of input.disagreements) lines.push(`  ${formatDisagreement(d)}`);
  }
  return `${lines.join('\n')}\n`;
}
