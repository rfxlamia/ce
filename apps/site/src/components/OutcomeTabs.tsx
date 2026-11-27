import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { OUTCOMES } from '../content/outcomes';
import { nextTabIndex } from '../lib/tabs';
import type { TabKey } from '../lib/tabs';

const NAV_KEYS: readonly string[] = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];

export function OutcomeTabs() {
  const [selected, setSelected] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabId = (i: number) => `${baseId}-tab-${i}`;
  const panelId = (i: number) => `${baseId}-panel-${i}`;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!NAV_KEYS.includes(e.key)) return;
    e.preventDefault();
    const next = nextTabIndex(index, e.key as TabKey, OUTCOMES.length);
    setSelected(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Execution outcomes">
        {OUTCOMES.map((outcome, i) => (
          <button
            key={outcome.name}
            type="button"
            role="tab"
            id={tabId(i)}
            aria-selected={selected === i}
            aria-controls={panelId(i)}
            tabIndex={selected === i ? 0 : -1}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            onClick={() => setSelected(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {outcome.name}
          </button>
        ))}
      </div>
      {OUTCOMES.map((outcome, i) => (
        <div
          key={outcome.name}
          role="tabpanel"
          id={panelId(i)}
          aria-labelledby={tabId(i)}
          hidden={selected !== i}
        >
          <p>{outcome.body}</p>
        </div>
      ))}
    </div>
  );
}
