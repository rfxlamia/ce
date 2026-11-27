import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { SnippetBlock } from '../src/components/SnippetBlock';
import { ACTION_SNIPPET, CONFIG_SNIPPET } from '../src/content/snippets';
import { createFakeClipboard, type FakeClipboard } from './helpers/clipboard';

const tricky = fc.constantFrom('', '\n', '{}', '{{ }}', '${{ secrets.OPENROUTER_API_KEY }}', 'é漢字🙂', 'a\r\nb', '  ');
const textArb = fc.oneof(
  fc.string({ unit: 'grapheme' }),
  fc.string({ unit: 'grapheme' }).map((s) => `${s}\n  \${{ ${s} }}\n{${s}}`),
  fc.array(tricky, { maxLength: 6 }).map((parts) => parts.join('')),
  fc.constantFrom(CONFIG_SNIPPET, ACTION_SNIPPET),
);

let clipboard: FakeClipboard;

beforeEach(() => {
  clipboard = createFakeClipboard('resolve');
  clipboard.install();
});

afterEach(() => {
  cleanup();
  clipboard.restore();
});

describe('copy round trip', () => {
  // Feature: landing-page-skeleton, Property 1
  // Validates: Requirements 9.2, 9.8, 13.6
  it('writes exactly the displayed text, once per click', async () => {
    await fc.assert(
      fc.asyncProperty(textArb, async (text) => {
        clipboard.calls.length = 0;
        const { container, getByRole, unmount } = render(<SnippetBlock text={text} label="Copy" />);
        try {
          await act(async () => {
            fireEvent.click(getByRole('button'));
          });
          const code = container.querySelector('code');
          expect(code).not.toBeNull();
          expect(clipboard.calls).toHaveLength(1);
          expect(clipboard.calls[0]).toBe(code!.textContent);
          expect(clipboard.calls[0]).toBe(text);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});
