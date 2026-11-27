import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App';

const SECTION_TITLES = ['Problem', 'How CE decides', 'Sample report', 'Quick start'];

const PLACEHOLDERS = ['lorem ipsum', 'todo', 'tbd', 'coming soon'];
const FORBIDDEN = [
  'ai-powered ci',
  'coding agent',
  'testing framework',
  'merge gate',
  'deploy gate',
  'guarantee',
  'ensures correctness',
  'bug-free',
];
const OUTCOME_NAMES = ['SKIPPED', 'EVIDENCED', 'UNSUPPORTED', 'ERROR'];

// Network spies. Each one fails loudly if the page tries to use the network.
let fetchSpy: ReturnType<typeof vi.fn>;
let xhrSpy: ReturnType<typeof vi.fn>;
let wsSpy: ReturnType<typeof vi.fn>;
const original = {
  fetch: globalThis.fetch,
  xhr: globalThis.XMLHttpRequest,
  ws: globalThis.WebSocket,
};

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('fetch called');
  });
  xhrSpy = vi.fn(function () {
    throw new Error('XMLHttpRequest constructed');
  });
  wsSpy = vi.fn(function () {
    throw new Error('WebSocket constructed');
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  globalThis.XMLHttpRequest = xhrSpy as unknown as typeof XMLHttpRequest;
  globalThis.WebSocket = wsSpy as unknown as typeof WebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = original.fetch;
  globalThis.XMLHttpRequest = original.xhr;
  globalThis.WebSocket = original.ws;
});

function bodyText(): string {
  return document.body.textContent ?? '';
}

function sampleReport(): HTMLElement {
  return screen.getByRole('article', { name: 'Sample report' });
}

describe('page structure (Req 3.1-3.3)', () => {
  it('renders one h1 and four h2 in order', () => {
    render(<App />);
    expect(screen.getAllByRole('heading', { level: 1, hidden: true })).toHaveLength(1);
    // The dialog heading is an h2 inside a closed dialog; exclude it by reading only visible headings.
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(SECTION_TITLES);
  });

  it('gives each Section an id and a navigation link that resolves to it', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(SECTION_TITLES);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href.startsWith('#')).toBe(true);
      const region = screen.getByRole('region', { name: link.textContent ?? '' });
      expect(region.id).toBe(href.slice(1));
      expect(region.id).not.toBe('');
    }
  });
});

describe('copy rules (Req 3.4, 3.6-3.8, 5.13)', () => {
  it('contains no placeholder text', () => {
    render(<App />);
    const text = bodyText().toLowerCase();
    for (const p of PLACEHOLDERS) expect(text, p).not.toContain(p);
  });

  it('contains no forbidden phrase, including the closed dialog', () => {
    render(<App />);
    const text = bodyText().toLowerCase();
    expect(text).toContain('view ce.yml');
    for (const p of FORBIDDEN) expect(text, p).not.toContain(p);
  });

  it('writes Outcome names in upper case only', () => {
    render(<App />);
    const found = bodyText().match(/\b(skipped|evidenced|unsupported|error)\b/gi) ?? [];
    expect(found.length).toBeGreaterThan(0);
    for (const word of found) expect(OUTCOME_NAMES, word).toContain(word);
  });
});

describe('no network (Req 3.9)', () => {
  it('makes no network call on render or interaction', async () => {
    render(<App />);
    for (const tab of screen.getAllByRole('tab')) fireEvent.click(tab);
    fireEvent.keyDown(screen.getAllByRole('tab')[0]!, { key: 'End' });
    fireEvent.click(screen.getByRole('button', { name: 'View ce.yml' }));
    for (const b of screen.getAllByRole('button', { name: /^Copy/, hidden: true })) {
      fireEvent.click(b);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
  });
});

describe('accessible names (Req 2.6)', () => {
  it('gives every button and tab a non-empty accessible name', () => {
    render(<App />);
    for (const role of ['button', 'tab'] as const) {
      const all = screen.getAllByRole(role, { hidden: true });
      const named = screen.getAllByRole(role, { hidden: true, name: /\S/ });
      expect(named).toHaveLength(all.length);
    }
  });
});

describe('Problem Section (Req 4)', () => {
  it('states the problem, inspectable Evidence, no repeated verification, and a limit', () => {
    render(<App />);
    const problem = screen.getByRole('region', { name: 'Problem' });
    const t = problem.textContent ?? '';
    expect(t).toMatch(/pass(es)? builds, tests and other Checks/);
    expect(t).toMatch(/behavior when executed (stays|remains) unproven/);
    expect(t).toMatch(/Evidence from runtime observation/);
    expect(t).toMatch(/inspect/);
    expect(t).toMatch(/does not repeat verification that existing Checks/);
    expect(t).toMatch(/does not promise that every Change is correct/);
  });
});

describe('How CE decides Section (Req 5.8-5.12)', () => {
  it('describes each Outcome', () => {
    render(<App />);
    const panel = (name: string) => {
      const tab = screen.getByRole('tab', { name });
      return document.getElementById(tab.getAttribute('aria-controls')!)!;
    };
    expect(panel('SKIPPED').textContent).toMatch(/additional Evidence is not required/);
    expect(panel('SKIPPED').textContent).toMatch(/valid result/);
    expect(panel('EVIDENCED').textContent).toMatch(/Runtime Evidence was collected/);
    expect(panel('EVIDENCED').textContent).toMatch(/inspect/);
    const unsupported = panel('UNSUPPORTED').textContent ?? '';
    expect(unsupported).toMatch(/Evidence was required, but the available capabilities were insufficient/);
    expect(unsupported).toMatch(/differs from SKIPPED/);
    expect(unsupported).toMatch(/could not produce Evidence that was needed/);
  });

  it('states ERROR and deterministic decision outside the tab panels', () => {
    render(<App />);
    const section = screen.getByRole('region', { name: 'How CE decides' });
    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    const clone = section.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[role="tabpanel"]').forEach((p) => p.remove());
    const outside = clone.textContent ?? '';
    expect(panels).toHaveLength(3);
    expect(outside).toMatch(/ERROR means the CE process failed to complete/);
    expect(outside).toMatch(/Deterministic code decides the Outcome/);
    expect(outside).toMatch(/model answer does not decide it/);
  });
});

describe('Sample report (Req 6)', () => {
  it('shows EVIDENCED and the labelled fields', () => {
    render(<App />);
    const report = sampleReport();
    const terms = within(report)
      .getAllByRole('term')
      .map((t) => t.textContent);
    expect(terms).toEqual([
      'Outcome',
      'Change',
      'Claim',
      'Subject',
      'Actions performed',
      'Observations obtained',
      'Where the Evidence can be inspected',
    ]);
    const defs = within(report).getAllByRole('definition');
    expect(defs[0]!.textContent).toBe('EVIDENCED');
    for (const d of defs) expect((d.textContent ?? '').trim()).not.toBe('');
  });

  it('says it is illustrative, not a real run', () => {
    render(<App />);
    expect(sampleReport().textContent).toMatch(/illustrative example, not the result of a real CE run/);
  });

  it('has no link, no image and no secret-like string', () => {
    render(<App />);
    const report = sampleReport();
    expect(within(report).queryAllByRole('link')).toHaveLength(0);
    expect(within(report).queryAllByRole('img', { hidden: true })).toHaveLength(0);
    const t = report.textContent ?? '';
    expect(t).not.toMatch(/https?:\/\//i);
    expect(t).not.toMatch(/\bsk-[A-Za-z0-9_-]{8,}/);
    expect(t).not.toMatch(/\b(ghp|gho|ghs|github_pat|xox[bp]|AKIA)[A-Za-z0-9_-]{8,}/);
    expect(t).not.toMatch(/[A-Za-z0-9+/=_-]{32,}/);
    expect(t).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(t).not.toMatch(/(api[_-]?key|secret|token|password)\s*[:=]/i);
  });
});
