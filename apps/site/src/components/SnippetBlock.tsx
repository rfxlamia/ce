import { CopyButton } from './CopyButton';

interface SnippetBlockProps {
  text: string;
  label: string;
}

export function SnippetBlock({ text, label }: SnippetBlockProps) {
  return (
    <>
      <pre>
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label={label} />
    </>
  );
}
