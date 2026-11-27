export type OutcomeName = 'SKIPPED' | 'EVIDENCED' | 'UNSUPPORTED';

// Panel bodies are plain strings so this stays a .ts file.
export interface OutcomeDef {
  name: OutcomeName;
  body: string;
}

export const OUTCOMES: readonly [OutcomeDef, OutcomeDef, OutcomeDef] = [
  {
    name: 'SKIPPED',
    body: 'The Assessment determined that additional Evidence is not required. This is a valid result: existing Checks already provide enough verification, so CE does not repeat it.',
  },
  {
    name: 'EVIDENCED',
    body: 'Runtime Evidence was collected. A reader can inspect it in the Evidence bundle and the report.',
  },
  {
    name: 'UNSUPPORTED',
    body: 'Evidence was required, but the available capabilities were insufficient. This differs from SKIPPED: with SKIPPED no Evidence is needed, while here CE could not produce Evidence that was needed.',
  },
];
