import { useId, useRef } from 'react';
import type { MouseEvent } from 'react';
import { CONFIG_SNIPPET } from '../content/snippets';
import { shouldCloseOnBackdropClick } from '../lib/dialog';
import { SnippetBlock } from './SnippetBlock';

export function ConfigModal() {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  function onDialogClick(e: MouseEvent<HTMLDialogElement>) {
    if (
      shouldCloseOnBackdropClick(
        e.target === e.currentTarget,
        e.clientX,
        e.clientY,
        e.currentTarget.getBoundingClientRect(),
      )
    ) {
      ref.current?.close();
    }
  }

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()}>
        View ce.yml
      </button>
      <dialog ref={ref} aria-labelledby={titleId} onClick={onDialogClick}>
        <h2 id={titleId}>ce.yml</h2>
        <button type="button" onClick={() => ref.current?.close()}>
          Close
        </button>
        <SnippetBlock text={CONFIG_SNIPPET} label="Copy ce.yml" />
      </dialog>
    </>
  );
}
