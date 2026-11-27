import { useEffect, useRef, useState } from 'react';

interface CopyButtonProps {
  text: string;
  label: string;
}

type CopyStatus = '' | 'Copied' | 'Copy failed';

const RESET_MS = 2000;

export function CopyButton({ text, label }: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>('');
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
    };
  }, []);

  async function onClick(): Promise<void> {
    attempt.current += 1;
    const mine = attempt.current;
    clearTimeout(timer.current);

    let outcome: Exclude<CopyStatus, ''>;
    try {
      await navigator.clipboard.writeText(text);
      outcome = 'Copied';
    } catch {
      outcome = 'Copy failed';
    }

    if (mine !== attempt.current) return;
    setStatus(outcome);
    timer.current = setTimeout(() => {
      setStatus('');
    }, RESET_MS);
  }

  return (
    <>
      <button type="button" onClick={() => void onClick()}>
        {label}
      </button>
      <span aria-live="polite">{status}</span>
    </>
  );
}
