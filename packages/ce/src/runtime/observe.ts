/**
 * Observer (spec observe-decide-execute-loop, Requirement 1).
 *
 * This file holds the observation types, `sanitizeText` and the Redactor.
 * Type-only dependency on Playwright: no runtime import of `playwright`.
 */

import { createHash } from 'node:crypto';

import type { PlaywrightPage } from './playwright-types.js';

/** One actionable element of a page. A Ref is valid for exactly one Observation. */
export interface ObservedElement {
  /** `e<N>`, unique within the Observation, in document order. */
  ref: string;
  role: string;
  /** Sanitized_Text accessible name; empty string when the element has none. */
  name: string;
  /** Stable_Locator. Built from the full unsanitized name, never written into question text. */
  locator: string;
  visible: boolean;
  enabled: boolean;
  /** Link target resolved against the Target_Origin. Present for a link only. */
  href?: string;
  /** Sorted fixture keys that match the field; empty for any non fill-capable element. */
  fixtureKeys: string[];
}

export interface Observation {
  step: number;
  /** Sanitized_Text. */
  url: string;
  /** Sanitized_Text. */
  title: string;
  domDigest: string;
  elements: ObservedElement[];
  /** Absolute, on-origin URLs of the Navigation_Options of this step (Requirement 1.11). */
  navigation: string[];
  /** Path relative to the Run_Dir. */
  screenshot: string;
}

export interface ObserveOptions {
  page: PlaywrightPage;
  step: number;
  targetOrigin: string;
  /** Keys only, never values (Requirement 6.1). */
  fixtureKeys: readonly string[];
}

export interface SanitizeOptions {
  /** Maximum length including the trailing `…`. Default 80 (use 200 for the path form). */
  maxLength?: number;
  fixtureValues: readonly string[];
}

/** Replaces every non-empty fixture value in a text with `[redacted]`, longest value first. */
export type Redactor = (text: string) => string;

export const REDACTED = '[redacted]';
export const DEFAULT_TEXT_LIMIT = 80;
export const PATH_TEXT_LIMIT = 200;

const ELLIPSIS = '…';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collapses every run of whitespace and control characters into one space and trims. */
function collapse(raw: string): string {
  return raw.replace(/[\s\p{Cc}]+/gu, ' ').trim();
}

/**
 * Builds a Redactor. Only non-empty values count. Values are matched longest first in a
 * single pass, so the `[redacted]` marker is never rescanned. A value that contains
 * whitespace or control characters is also matched in its collapsed form, because the
 * text is collapsed before it is redacted.
 */
export function createRedactor(fixtureValues: readonly string[]): Redactor {
  const patterns = new Set<string>();
  for (const value of fixtureValues) {
    if (value.length === 0) continue;
    patterns.add(value);
    const collapsed = collapse(value);
    if (collapsed.length > 0) patterns.add(collapsed);
  }
  if (patterns.size === 0) return (text) => text;
  const ordered = [...patterns].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const regex = new RegExp(ordered.map(escapeRegExp).join('|'), 'g');
  return (text) => text.replace(regex, REDACTED);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return '';
  let head = text.slice(0, maxLength - 1);
  // Do not leave half of a surrogate pair before the ellipsis.
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head + ELLIPSIS;
}

/**
 * Sanitized_Text of the Glossary, in this order: collapse whitespace and control
 * characters, trim, redact fixture values, truncate (the `…` counts toward the limit),
 * then escape `\` as `\\` and `"` as `\"`. Escaping runs last, so the escaped result
 * may exceed the limit by the number of escaped characters.
 */
export function sanitizeText(raw: string, options: SanitizeOptions): string {
  const maxLength = options.maxLength ?? DEFAULT_TEXT_LIMIT;
  const redacted = createRedactor(options.fixtureValues)(collapse(raw));
  const truncated = truncate(redacted, maxLength);
  return truncated.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Raw facts about one Actionable_Element, as read inside the page. Names and
 * attributes are unsanitized. No field carries the value of an input (Requirement 1.10).
 */
export interface ActionableElementSnapshot {
  tag: string;
  role: string;
  /** Full accessible name, whitespace collapsed, never sanitized. */
  name: string;
  id?: string;
  /** `data-testid` attribute. */
  testId?: string;
  /** Exactly one element of the document has this id. */
  idUnique?: boolean;
  /** Exactly one element of the document has this `data-testid`. */
  testIdUnique?: boolean;
  /** `name` attribute of a form field. */
  nameAttr?: string;
  autocomplete?: string;
  /** `type` attribute of an input, lowercased. */
  type?: string;
  /** Absolute link target (anchor with an href). */
  href?: string;
  /** Playwright-visible and not clipped to zero size by an ancestor. */
  visible: boolean;
  enabled: boolean;
  cssPath: string;
  /**
   * False when another element of the same role has a name that contains this one
   * (role-plus-name matching is a substring match). Set by `observe()`. Default true.
   */
  roleNameUnique?: boolean;
}

/** Page-side collector. Plain JavaScript in a string: it is immune to bundler helper injection. */
const SNAPSHOT_SCRIPT = String.raw`(() => {
  const doc = document;
  const ROLES = new Set(['button','link','menuitem','option','tab','combobox','checkbox','radio','switch','textbox']);
  const NON_TEXT = new Set(['hidden','checkbox','radio','button','submit','reset','image','file','range','color']);
  const collapse = (t) => (t || '').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  const implicitRole = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
      if (NON_TEXT.has(type)) return null;
      return 'textbox';
    }
    return null;
  };
  const roleOf = (el) => {
    const explicit = (el.getAttribute('role') || '').trim().toLowerCase().split(/\s+/)[0];
    if (explicit && ROLES.has(explicit)) return explicit;
    return implicitRole(el);
  };
  const textOf = (el) => collapse(el.textContent);
  const nameOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = collapse(labelledby.split(/\s+/).map((id) => { const n = doc.getElementById(id); return n ? n.textContent : ''; }).join(' '));
      if (text) return text;
    }
    const aria = collapse(el.getAttribute('aria-label'));
    if (aria) return aria;
    const isField = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (isField && el.labels && el.labels.length > 0) {
      const text = collapse(Array.from(el.labels).map((l) => l.textContent).join(' '));
      if (text) return text;
    }
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') {
        const v = collapse(el.getAttribute('value'));
        if (v) return v;
        if (type === 'submit') return 'Submit';
        if (type === 'reset') return 'Reset';
      }
      if (type === 'image') { const alt = collapse(el.getAttribute('alt')); if (alt) return alt; }
    }
    if (!isField) {
      const text = textOf(el);
      if (text) return text;
    }
    const title = collapse(el.getAttribute('title'));
    if (title) return title;
    if (isField) return collapse(el.getAttribute('placeholder'));
    return '';
  };
  const clippedToZero = (el, rect, style) => {
    const position = style.position;
    if (position === 'fixed') return false;
    const offsetParent = el.offsetParent;
    let active = position !== 'absolute';
    for (let a = el.parentElement; a && a !== doc.documentElement; a = a.parentElement) {
      if (!active) { if (a === offsetParent) active = true; else continue; }
      const s = getComputedStyle(a);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const r = a.getBoundingClientRect();
      const w = Math.min(rect.right, r.right) - Math.max(rect.left, r.left);
      const h = Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top);
      if (w <= 0 || h <= 0) return true;
    }
    return false;
  };
  const isVisible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return !clippedToZero(el, rect, style);
  };
  const cssEscape = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      if (n === doc.documentElement) { parts.unshift(tag); break; }
      let index = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) index++;
      parts.unshift(tag + ':nth-of-type(' + index + ')');
    }
    return parts.join(' > ');
  };
  const count = (selector) => { try { return doc.querySelectorAll(selector).length; } catch (e) { return 0; } };
  const out = [];
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    const role = roleOf(el);
    if (!role) continue;
    const tag = el.tagName.toLowerCase();
    const snap = { tag, role, name: nameOf(el), visible: isVisible(el), cssPath: cssPath(el) };
    let enabled = el.getAttribute('aria-disabled') !== 'true';
    try { if (el.matches(':disabled')) enabled = false; } catch (e) {}
    snap.enabled = enabled;
    const id = el.getAttribute('id');
    if (id) { snap.id = id; snap.idUnique = count('[id="' + cssEscape(id) + '"]') === 1; }
    const testId = el.getAttribute('data-testid');
    if (testId) { snap.testId = testId; snap.testIdUnique = count('[data-testid="' + cssEscape(testId) + '"]') === 1; }
    const nameAttr = el.getAttribute('name');
    if (nameAttr) snap.nameAttr = nameAttr;
    const autocomplete = el.getAttribute('autocomplete');
    if (autocomplete) snap.autocomplete = autocomplete;
    if (tag === 'input') snap.type = (el.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) snap.href = el.href;
    out.push(snap);
  }
  return out;
})()`;

function escapeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Stable_Locator: `data-testid`, then role plus accessible name, then `id`, then a CSS
 * path. A candidate is skipped when it is known to match more than one element. The
 * name is the full unsanitized accessible name and never reaches question text.
 * Deterministic for an unchanged DOM.
 */
export function buildStableLocator(el: ActionableElementSnapshot): string {
  if (el.testId && el.testIdUnique !== false) {
    return `[data-testid="${escapeSelectorValue(el.testId)}"]`;
  }
  if (el.name.length > 0 && el.roleNameUnique !== false) {
    return `role=${el.role}[name="${escapeSelectorValue(el.name)}"s]`;
  }
  if (el.id && el.idUnique !== false) {
    return `[id="${escapeSelectorValue(el.id)}"]`;
  }
  return el.cssPath;
}

/** Stable serialization: fixed field order, no dependence on object key order. */
function serializeElement(el: ObservedElement): string {
  return JSON.stringify([
    el.ref,
    el.role,
    el.name,
    el.locator,
    el.visible,
    el.enabled,
    el.href ?? null,
    [...el.fixtureKeys],
  ]);
}

/** Hash of the Observed_Element list; equal for two observations of an unchanged page. */
export function computeDomDigest(elements: readonly ObservedElement[]): string {
  const hash = createHash('sha256');
  hash.update(`[${elements.map(serializeElement).join(',')}]`);
  return hash.digest('hex');
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isFillCapable(el: ActionableElementSnapshot): boolean {
  if (el.role !== 'textbox') return false;
  if (el.tag === 'input') return el.type !== undefined && !NON_TEXT_INPUT_TYPES.has(el.type);
  return true;
}

const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color',
]);

/** Sorted fixture keys matching a field (Requirement 6.1). Keys only, never values. */
function matchFixtureKeys(el: ActionableElementSnapshot, fixtureKeys: readonly string[]): string[] {
  if (!isFillCapable(el) || fixtureKeys.length === 0) return [];
  const candidates = new Set<string>();
  const add = (value: string | undefined) => {
    if (value === undefined) return;
    const n = normalizeKey(value);
    if (n.length > 0) candidates.add(n);
  };
  add(el.nameAttr);
  add(el.id);
  add(el.name);
  for (const token of (el.autocomplete ?? '').split(/\s+/)) add(token);
  const matched = new Set<string>();
  for (const key of fixtureKeys) {
    const n = normalizeKey(key);
    if (n.length > 0 && candidates.has(n)) matched.add(key);
  }
  return [...matched].sort();
}

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Observes the page as a list of Actionable_Elements. Never reads an input value and
 * never writes page text into question text. The screenshot is attached by the loop.
 */
export async function observe(options: ObserveOptions): Promise<Omit<Observation, 'screenshot'>> {
  const { page, step, targetOrigin, fixtureKeys } = options;
  const snapshots = await page.evaluate(SNAPSHOT_SCRIPT as unknown as () => ActionableElementSnapshot[]);

  const lowerNames = snapshots.map((s) => s.name.toLowerCase());
  const elements: ObservedElement[] = snapshots.map((snap, index) => {
    const lower = lowerNames[index] ?? '';
    const roleNameUnique =
      lower.length > 0 &&
      !snapshots.some((other, j) => j !== index && other.role === snap.role && (lowerNames[j] ?? '').includes(lower));
    const locator = buildStableLocator({ ...snap, roleNameUnique });
    const element: ObservedElement = {
      ref: `e${index}`,
      role: snap.role,
      name: sanitizeText(snap.name, { fixtureValues: [] }),
      locator,
      visible: snap.visible,
      enabled: snap.enabled,
      fixtureKeys: matchFixtureKeys(snap, fixtureKeys),
    };
    if (snap.href !== undefined && snap.role === 'link') element.href = snap.href;
    return element;
  });

  const expectedOrigin = originOf(targetOrigin);
  const navigation: string[] = [];
  for (const element of elements) {
    if (element.href === undefined || expectedOrigin === undefined) continue;
    if (originOf(element.href) === expectedOrigin && !navigation.includes(element.href)) {
      navigation.push(element.href);
    }
  }

  return {
    step,
    url: sanitizeText(page.url(), { maxLength: PATH_TEXT_LIMIT, fixtureValues: [] }),
    title: sanitizeText(await page.title(), { fixtureValues: [] }),
    domDigest: computeDomDigest(elements),
    elements,
    navigation,
  };
}
