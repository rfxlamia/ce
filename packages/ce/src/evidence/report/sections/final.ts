/**
 * Final_Section: the last screenshot, the Box_Highlight, and the final state signals.
 * Pure. Reads already-decided Run_Record data and decides no Outcome.
 */
import type { RunRecord } from '../../schema.js';
import { escapeAttr, escapeHtml, hrefFor } from '../escape.js';
import { PALETTE } from '../palette.js';
import { signalBar, signalLabel } from '../signal.js';

const STATE_REACHED_IMAGE = 'runtime.state_reached@1';
const STATE_REACHED_DOM = 'runtime.state_reached_dom@1';
const UNAVAILABLE = 'question text unavailable for this version';

function textOrFallback(
  questionText: (idVersion: string) => string | undefined,
  idVersion: string,
): string {
  const text = questionText(idVersion);
  return text === undefined ? `${idVersion}: ${UNAVAILABLE}` : text;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function pct(n: number): string {
  return `${(clamp01(n) * 100).toFixed(2)}%`;
}

/** The recorded value exactly as stored, never clamped or rounded. */
function verbatim(n: number): string {
  return String(n);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function figure(src: string, alt: string, box: Box | null): string {
  const highlight =
    box === null
      ? ''
      : `<div class="box" style="left:${pct(box.x)};top:${pct(box.y)};width:${pct(box.width)};` +
        `height:${pct(box.height)};border-color:${PALETTE.box};background:none">` +
        `<span>subject</span></div>`;
  return (
    `<div class="final"><img src="${escapeAttr(hrefFor(src))}" alt="${escapeAttr(alt)}">` +
    `${highlight}</div>`
  );
}

export function renderFinal(
  record: RunRecord,
  questionText: (idVersion: string) => string | undefined,
): string {
  const fi = record.finalImage;
  const parts: string[] = ['<section id="final" aria-labelledby="h-final">', '<h2 id="h-final">Final screenshot</h2>'];

  const finalShot = fi?.screenshot ?? null;

  if (finalShot === null) {
    const last = record.steps.length > 0 ? record.steps[record.steps.length - 1] : undefined;
    parts.push('<p class="no-final">No final screenshot exists for this run.</p>');
    if (last !== undefined) {
      parts.push(figure(last.screenshot, `${last.screenshot}, screenshot of the last step`, null));
      parts.push(`<p class="muted">Showing the screenshot of the last step (step ${escapeHtml(String(last.step))}).</p>`);
    }
  } else {
    const box = fi !== null && fi.error === null ? fi.box : null;
    parts.push(figure(finalShot, `${finalShot}, final screenshot`, box));
    if (fi !== null && fi.error !== null) {
      parts.push(
        `<p class="final-error">The final image request failed: ${escapeHtml(fi.error)}. ` +
          `No Box highlight is drawn. The Outcome was resolved from text ${signalLabel()}s.</p>`,
      );
    } else if (box !== null) {
      parts.push(
        `<p class="muted box-coords">Box <span class="tag-signal">${signalLabel()}</span> ` +
          `x ${escapeHtml(verbatim(box.x))}, y ${escapeHtml(verbatim(box.y))}, ` +
          `width ${escapeHtml(verbatim(box.width))}, height ${escapeHtml(verbatim(box.height))} of the screenshot.</p>`,
      );
    } else {
      parts.push('<p class="muted no-box">The classifier returned no Box.</p>');
    }
  }

  if (fi !== null && fi.model !== null) {
    parts.push(`<p class="muted">Model <span class="mono">${escapeHtml(fi.model)}</span>.</p>`);
  }

  if (fi !== null) {
    const image = fi.signals.stateReached;
    const dom = fi.signals.stateReachedDom;
    if (image !== null) {
      parts.push(signalBar(textOrFallback(questionText, STATE_REACHED_IMAGE), image));
    }
    if (dom !== null) {
      parts.push(signalBar(textOrFallback(questionText, STATE_REACHED_DOM), dom));
    }
  }

  parts.push('</section>');
  return parts.join('\n');
}
