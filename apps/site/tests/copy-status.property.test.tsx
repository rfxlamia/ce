import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { CopyButton } from '../src/components/CopyButton';
import { createFakeClipboard, type ClipboardMode, type FakeClipboard } from './helpers/clipboard';

interface Attempt {
  result: ClipboardMode;
  /** Time in ms between this attempt and the next one (ignored for the last attempt). */
  gap: number;
}

const attemptsArb = fc.array(
  fc.record({
    result: fc.constantFrom<ClipboardMode>('resolve', 'reject', 'absent'),
    gap: fc.integer({ min: 0, max: 4000 }),
  }),
  { minLength: 1, maxLength: 6 },
);

let clipboard: FakeClipboard;

beforeEach(() => {
  clipboard = createFakeClipboard('resolve');
  clipboard.install();
});

afterEach(() => {
  cleanup();
  clipboard.restore();
  vi.useRealTimers();
});

describe('copy status lifecycle', () => {
  // Feature: landing-page-skeleton, Property 3
  // Validates: Requirements 9.5, 9.6, 9.7
  it('follows the latest attempt, resets within 3000 ms, and restarts on a new attempt', async () => {
    await fc.assert(
      fc.asyncProperty(attemptsArb, async (attempts: Attempt[]) => {
        vi.useFakeTimers();
        const { container, getByRole, unmount } = render(<CopyButton text="snippet" label="Copy" />);
        const status = () => container.querySelector('[aria-live="polite"]')!.textContent;
        try {
          expect(status()).toBe('');

          for (let i = 0; i < attempts.length; i++) {
            const { result, gap } = attempts[i]!;
            clipboard.setMode(result);
            const last = i === attempts.length - 1;
            if (last) {
              // Let the latest attempt resolve.
              await act(async () => {
                fireEvent.click(getByRole('button'));
                await vi.advanceTimersByTimeAsync(0);
              });
            } else if (gap === 0) {
              // Next attempt starts before this one resolves.
              act(() => {
                fireEvent.click(getByRole('button'));
              });
            } else {
              await act(async () => {
                fireEvent.click(getByRole('button'));
                await vi.advanceTimersByTimeAsync(gap);
              });
            }
          }

          const expected = attempts[attempts.length - 1]!.result === 'resolve' ? 'Copied' : 'Copy failed';

          // The status follows the latest attempt, whatever earlier attempts did.
          expect(status()).toBe(expected);

          // A timer left over from an earlier attempt must not clear it early.
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1999);
          });
          expect(status()).toBe(expected);

          // Empty within 3000 ms of the latest attempt.
          await act(async () => {
            await vi.advanceTimersByTimeAsync(3000 - 1999);
          });
          expect(status()).toBe('');
        } finally {
          unmount();
          vi.useRealTimers();
        }
      }),
      { numRuns: 100 },
    );
  });
});
