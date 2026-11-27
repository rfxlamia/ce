export type ClipboardMode = 'resolve' | 'reject' | 'absent';

export interface FakeClipboard {
  /** Every string passed to writeText, in call order. */
  readonly calls: string[];
  mode: ClipboardMode;
  /** Puts the fake on `navigator` (or removes `navigator.clipboard` when mode is 'absent'). */
  install(): void;
  /** Restores the original `navigator.clipboard` property. */
  restore(): void;
  /** Changes the result for the next attempts and re-installs the fake. */
  setMode(mode: ClipboardMode): void;
}

export function createFakeClipboard(initialMode: ClipboardMode = 'resolve'): FakeClipboard {
  const calls: string[] = [];
  let original: PropertyDescriptor | undefined;
  let installed = false;

  const fake: FakeClipboard = {
    calls,
    mode: initialMode,
    install() {
      if (!installed) {
        original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        installed = true;
      }
      const value =
        fake.mode === 'absent'
          ? undefined
          : {
              writeText(text: string): Promise<void> {
                calls.push(text);
                return fake.mode === 'reject'
                  ? Promise.reject(new Error('clipboard write rejected'))
                  : Promise.resolve();
              },
            };
      Object.defineProperty(navigator, 'clipboard', {
        value,
        configurable: true,
        writable: true,
      });
    },
    setMode(mode: ClipboardMode) {
      fake.mode = mode;
      fake.install();
    },
    restore() {
      if (!installed) return;
      if (original) {
        Object.defineProperty(navigator, 'clipboard', original);
      } else {
        delete (navigator as unknown as Record<string, unknown>)['clipboard'];
      }
      installed = false;
    },
  };
  return fake;
}
