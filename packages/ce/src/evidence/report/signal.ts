/**
 * Shared Probability_Bar and the "signal" wording. Every classifier-derived value
 * on the page is drawn through `signalBar` and labelled with `signalLabel`.
 */
import { escapeAttr, escapeHtml } from './escape.js';

/** The word that marks a classifier value as a signal, not a verdict. */
export function signalLabel(): string {
  return 'signal';
}

export interface SignalBarOptions {
  /** Marks the bar as the alternative that was taken (adds the `chosen` class). */
  chosen?: boolean;
}

function clampPercent(value: number): number {
  const percent = value * 100;
  if (percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
}

/** Fixed two-decimal rendering of a number, without trailing noise like `-0.00`. */
function twoDecimals(n: number): string {
  const s = n.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

/**
 * One Probability_Bar. `value` is a probability in 0..1 (out-of-range values are
 * clamped for the drawn length and `aria-valuenow`; the text shows the recorded
 * value). `null` or a non-finite number renders the "no answer" text, no bar.
 * `label` is both the visible label and the accessible name; it is escaped here.
 */
export function signalBar(label: string, value: number | null, options: SignalBarOptions = {}): string {
  const cls = options.chosen === true ? 'bar chosen' : 'bar';
  const name = escapeHtml(label);
  if (value === null || !Number.isFinite(value)) {
    return `<div class="${cls} no-answer"><span class="lbl">${name}</span><span class="val">no answer</span></div>`;
  }
  const percent = clampPercent(value);
  const now = twoDecimals(percent);
  const text = twoDecimals(value);
  return (
    `<div class="${cls}"><span class="lbl">${name}</span>` +
    `<div class="track" role="meter" aria-label="${escapeAttr(`${label} ${signalLabel()}`)}"` +
    ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${now}" aria-valuetext="${text}">` +
    `<div class="fill" style="width:${now}%"></div></div>` +
    `<span class="val">${text}</span></div>`
  );
}
