import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OutcomeTabs } from '../src/components/OutcomeTabs';
import { nextTabIndex } from '../src/lib/tabs';
import type { TabKey } from '../src/lib/tabs';

const COUNT = 3;

type Step = { kind: 'click'; index: number } | { kind: 'key'; key: TabKey };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.integer({ min: 0, max: COUNT - 1 }).map((index): Step => ({ kind: 'click', index })),
  fc
    .constantFrom<TabKey>('ArrowRight', 'ArrowLeft', 'Home', 'End')
    .map((key): Step => ({ kind: 'key', key })),
);

function selectedIndex(): number {
  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(COUNT);
  const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
  expect(selected).toHaveLength(1);
  tabs.forEach((t) => {
    const isSel = t === selected[0];
    expect(t.getAttribute('aria-selected')).toBe(isSel ? 'true' : 'false');
    expect(t.getAttribute('tabindex')).toBe(isSel ? '0' : '-1');
  });

  const panels = screen.getAllByRole('tabpanel', { hidden: true });
  expect(panels).toHaveLength(COUNT);
  const visible = panels.filter((p) => !p.hasAttribute('hidden'));
  expect(visible).toHaveLength(1);

  const index = tabs.indexOf(selected[0]!);
  expect(selected[0]!.getAttribute('aria-controls')).toBe(visible[0]!.id);
  expect(visible[0]!.getAttribute('aria-labelledby')).toBe(selected[0]!.id);
  tabs.forEach((t, i) => {
    expect(t.getAttribute('aria-controls')).toBe(panels[i]!.id);
    expect(panels[i]!.getAttribute('aria-labelledby')).toBe(t.id);
  });
  return index;
}

describe('OutcomeTabs', () => {
  // Feature: landing-page-skeleton, Property 2
  // Validates: Requirements 5.2, 5.4, 5.5, 5.6, 5.7, 13.7
  it('keeps exactly one selected tab and one visible panel under any interaction sequence', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 30 }), (steps) => {
        cleanup();
        const { unmount } = render(<OutcomeTabs />);
        try {
          let current = selectedIndex();
          expect(current).toBe(0);
          for (const step of steps) {
            const tabs = screen.getAllByRole('tab');
            if (step.kind === 'click') {
              fireEvent.click(tabs[step.index]!);
              current = step.index;
            } else {
              fireEvent.keyDown(tabs[current]!, { key: step.key });
              current = nextTabIndex(current, step.key, COUNT);
            }
            expect(selectedIndex()).toBe(current);
          }
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});
