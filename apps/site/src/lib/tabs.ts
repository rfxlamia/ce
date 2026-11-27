export type TabKey = 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';

/** Returns the index of the tab to select after `key` is pressed on tab `current` of `count` tabs. */
export function nextTabIndex(current: number, key: TabKey, count: number): number {
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
  }
}
