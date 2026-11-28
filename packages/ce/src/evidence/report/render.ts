/**
 * render: the one public pure function of the Report_Generator.
 * RunRecord (plus one injected question-text lookup) in, the text of report.html out.
 *
 * Total and pure: no environment, clock, randomness, I/O, SDK or fetch. Decides no Outcome:
 * every section reads the Outcome from the record as data.
 */
import { questionTextFor } from '../../jev/catalog.js';
import type { RunRecord } from '../schema.js';
import { renderDocument } from './document.js';
import { renderAssessment } from './sections/assessment.js';
import { renderBanner } from './sections/banner.js';
import { renderClaims } from './sections/claims.js';
import { renderFinal } from './sections/final.js';
import { renderLogs } from './sections/logs.js';
import { renderRaw } from './sections/raw.js';
import { renderTimeline } from './sections/timeline.js';

export interface RenderDeps {
  /** jev/catalog.ts's questionTextFor, injectable so tests can drive the "entry missing" branch. */
  questionText: (idVersion: string) => string | undefined;
}

export function render(record: RunRecord, deps: RenderDeps = { questionText: questionTextFor }): string {
  return renderDocument(record, {
    banner: renderBanner(record),
    claims: renderClaims(record),
    assessment: renderAssessment(record, deps.questionText),
    timeline: renderTimeline(record),
    final: renderFinal(record, deps.questionText),
    logs: renderLogs(record),
    raw: renderRaw(record),
  });
}
