import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DIALOG_DETAIL_LIMIT, registerPageHandlers, type EventLogEntry } from './capture.js';
import type { PlaywrightDialog, PlaywrightPage } from './playwright-types.js';

// Feature: observe-decide-execute-loop, Property 14: Dialog message truncation is bounded
// **Validates: Requirements 7.5**

/** Minimal page that records listeners so a test can emit a dialog event. */
function fakePage(): { page: PlaywrightPage; emitDialog: (dialog: PlaywrightDialog) => void } {
  const listeners = new Map<string, Array<(arg: never) => void>>();
  const page = {
    on(event: string, listener: (arg: never) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    off() {},
  } as unknown as PlaywrightPage;
  return {
    page,
    emitDialog: (dialog) => {
      for (const listener of listeners.get('dialog') ?? []) listener(dialog as never);
    },
  };
}

const typeArb = fc.constantFrom('alert', 'confirm', 'prompt', 'beforeunload');
// Lengths straddle the 500 limit; the redactor can also lengthen the message.
const messageArb = fc.oneof(
  fc.string({ maxLength: 1200, unit: 'grapheme' }),
  fc.string({ minLength: 480, maxLength: 520 }),
);

function run(type: string, message: string, redact: (text: string) => string): EventLogEntry[] {
  const { page, emitDialog } = fakePage();
  const entries: EventLogEntry[] = [];
  registerPageHandlers({ page, onEvent: (entry) => entries.push(entry), redact });
  emitDialog({ type: () => type, message: () => message, dismiss: async () => undefined });
  return entries;
}

describe('Property 14: dialog message truncation is bounded', () => {
  it('never exceeds 500 characters and is a prefix of the redacted detail', () => {
    fc.assert(
      fc.property(typeArb, messageArb, fc.stringMatching(/^[A-Z0-9]{3,6}$/), (type, message, secret) => {
        const redact = (text: string): string => text.split(secret).join('[redacted]');
        const entries = run(type, message, redact);
        expect(entries).toHaveLength(1);
        const entry = entries[0]!;
        expect(entry.kind).toBe('dialog');
        expect(entry.detail.length).toBeLessThanOrEqual(DIALOG_DETAIL_LIMIT);
        const full = `${type}: ${redact(message)}`;
        expect(full.startsWith(entry.detail)).toBe(true);
        // Truncation only happens when needed.
        expect(entry.detail).toBe(full.slice(0, DIALOG_DETAIL_LIMIT));
      }),
      { numRuns: 200 },
    );
  });

  it('leaves messages that fit untouched', () => {
    const entries = run('alert', 'hello', (text) => text);
    expect(entries[0]!.detail).toBe('alert: hello');
  });
});
