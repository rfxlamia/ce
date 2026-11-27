import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App';
import { ConfigModal } from '../src/components/ConfigModal';
import { OutcomeTabs } from '../src/components/OutcomeTabs';
import { SnippetBlock } from '../src/components/SnippetBlock';
import { CONFIG_SNIPPET } from '../src/content/snippets';
import { createFakeClipboard, type FakeClipboard } from './helpers/clipboard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('config modal', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Stub: HTMLDialogElement.prototype.showModal. happy-dom does not reliably
    // implement modal behavior, so the stub only records the call and sets `open`.
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    // Stub: HTMLDialogElement.prototype.close. The real method removes `open` and
    // queues a `close` event; the stub only removes `open`. Tests dispatch `close` themselves.
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal as unknown as () => void;
    HTMLDialogElement.prototype.close = close as unknown as () => void;
  });

  function getDialog(): HTMLElement {
    // A closed dialog is not exposed in the accessibility tree, and the name of a hidden
    // element computes to "", so query without a name; the name is checked in the first test.
    return screen.getByRole('dialog', { hidden: true });
  }

  it('has a "View ce.yml" button and a dialog named by its heading', () => {
    render(<ConfigModal />);
    expect(screen.getByRole('button', { name: 'View ce.yml' })).toBeTruthy();
    const dialog = getDialog();
    const heading = within(dialog).getByRole('heading', { hidden: true, name: 'ce.yml' });
    expect(heading).toBeTruthy();
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    // While open, the dialog's accessible name comes from the heading.
    dialog.setAttribute('open', '');
    expect(screen.getByRole('dialog', { name: 'ce.yml' })).toBe(dialog);
  });

  it('contains a Close button and the shared config snippet', () => {
    render(<ConfigModal />);
    const dialog = getDialog();
    expect(within(dialog).getByRole('button', { hidden: true, name: 'Close' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { hidden: true, name: 'Copy ce.yml' })).toBeTruthy();
    expect(dialog.querySelector('code')?.textContent).toBe(CONFIG_SNIPPET);
  });

  it('is rendered without `open` while closed', () => {
    render(<ConfigModal />);
    expect(getDialog().hasAttribute('open')).toBe(false);
  });

  it('opens with showModal, closes with Close, and opens again after a close event', () => {
    render(<ConfigModal />);
    const opener = screen.getByRole('button', { name: 'View ce.yml' });
    fireEvent.click(opener);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(getDialog().hasAttribute('open')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(getDialog().hasAttribute('open')).toBe(false);

    // Dismissal by the browser (for example Escape) fires `close` on the dialog.
    getDialog().removeAttribute('open');
    fireEvent(getDialog(), new Event('close'));
    fireEvent.click(opener);
    expect(showModal).toHaveBeenCalledTimes(2);
  });
});

describe('outcome tabs', () => {
  it('selects SKIPPED first and hides the other panels', () => {
    render(<OutcomeTabs />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'SKIPPED' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'EVIDENCED' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'UNSUPPORTED' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(3);
    expect(screen.getByRole('tabpanel', { name: 'SKIPPED' }).hasAttribute('hidden')).toBe(false);
    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels.map((p) => p.hasAttribute('hidden'))).toEqual([false, true, true]);
  });

  it('activates a tab by click', () => {
    render(<OutcomeTabs />);
    fireEvent.click(screen.getByRole('tab', { name: 'EVIDENCED' }));
    expect(screen.getByRole('tab', { name: 'EVIDENCED' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'SKIPPED' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel', { name: 'EVIDENCED' })).toBeTruthy();
  });

  // Tabs are native <button> elements. A browser turns Enter (keydown) and Space (keyup)
  // into a click on a focused button; happy-dom does not, so the test dispatches the key
  // events and then the click the browser would synthesize.
  it.each([
    ['Enter', 'keyDown'],
    [' ', 'keyUp'],
  ] as const)('activates a tab with the %j key', (key, phase) => {
    render(<OutcomeTabs />);
    const tab = screen.getByRole('tab', { name: 'UNSUPPORTED' });
    tab.focus();
    fireEvent[phase](tab, { key });
    fireEvent.click(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'UNSUPPORTED' })).toBeTruthy();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });
});

describe('copy buttons', () => {
  let clipboard: FakeClipboard;

  beforeEach(() => {
    clipboard = createFakeClipboard('resolve');
    clipboard.install();
  });
  afterEach(() => {
    clipboard.restore();
  });

  it('renders Copy ce.yml twice and Copy workflow once, as plain buttons', () => {
    render(<App />);
    expect(screen.getAllByRole('button', { hidden: true, name: 'Copy ce.yml' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Copy workflow' })).toHaveLength(1);
    const copyButtons = screen
      .getAllByRole('button', { hidden: true })
      .filter((b) => /^Copy /.test(b.textContent ?? ''));
    expect(copyButtons).toHaveLength(3);
    for (const b of copyButtons) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.hasAttribute('aria-label')).toBe(false);
    }
  });

  it('starts with an empty status element', () => {
    render(<SnippetBlock text="x" label="Copy workflow" />);
    const button = screen.getByRole('button', { name: 'Copy workflow' });
    const status = button.nextElementSibling as HTMLElement;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');
  });

  it('shows "Copied" after a successful write', async () => {
    render(<SnippetBlock text="x" label="Copy workflow" />);
    const button = screen.getByRole('button', { name: 'Copy workflow' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.nextElementSibling?.textContent).toBe('Copied');
    expect(clipboard.calls).toEqual(['x']);
  });

  it('shows "Copy failed" when the write is rejected', async () => {
    clipboard.setMode('reject');
    render(<SnippetBlock text="x" label="Copy workflow" />);
    const button = screen.getByRole('button', { name: 'Copy workflow' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.nextElementSibling?.textContent).toBe('Copy failed');
  });

  it('shows "Copy failed" when the clipboard is absent', async () => {
    clipboard.setMode('absent');
    render(<SnippetBlock text="x" label="Copy workflow" />);
    const button = screen.getByRole('button', { name: 'Copy workflow' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.nextElementSibling?.textContent).toBe('Copy failed');
  });
});
