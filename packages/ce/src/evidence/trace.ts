// Types only. Must not import from `runtime/` (Requirement 10.3).

export interface RuntimeTraceStep {
  step: number;
  url: string;
  title: string;
  /** Bundle_Relative_Path */
  screenshot: string;
  action: { kind: string; description: string };
  executed: boolean;
  probabilities: Record<string, number>;
  alternatives: { key: string; description: string; probability: number }[];
}

export interface RuntimeTraceEvent {
  step: number;
  kind: 'dialog' | 'download' | 'popup' | 'settle' | 'refusal';
  detail: string;
}

/** Mirrors `StopReason` in runtime/loop.ts. */
export type StopReason = 'done' | 'reached' | 'give_up' | 'max-steps' | 'time-budget' | 'aborted';

export interface RuntimeTrace {
  steps: RuntimeTraceStep[];
  eventLog: RuntimeTraceEvent[];
  finalScreenshot?: string;
  finalImageModel?: string;
  finalImageError?: string;
  /** Fractions of the final screenshot. */
  finalBox?: { x: number; y: number; width: number; height: number };
  finalSignals?: { stateReachedDom?: number; stateReached?: number };
  stopReason: StopReason;
  /** Distinct returned model ids of the decide calls and the final image request, in order of first appearance. */
  modelIds: string[];
}
