import { fallbackNote } from 'continuous-evidence';
import type { FallbackReason } from 'continuous-evidence';

// fallbackNote lives in packages/ce so the Comment_Renderer can use it.
export { fallbackNote };
export type { FallbackReason };

function collectText(error: unknown): string {
  try {
    if (typeof error === 'string') return error;
    if (error === null || typeof error !== 'object') return '';
    const parts: string[] = [];
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'stderr', 'stdout']) {
      const value = record[key];
      if (typeof value === 'string') parts.push(value);
    }
    const result = record['result'];
    if (result !== null && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      for (const key of ['stderr', 'stdout']) {
        const value = r[key];
        if (typeof value === 'string') parts.push(value);
      }
    }
    return parts.join('\n');
  } catch {
    return '';
  }
}

const BLOCKED = /protected branch|\bGH006\b|\bGH013\b|repository rule violations|rule violations|ruleset|hook declined|pre-receive hook|\[remote rejected\]/i;
const NO_WRITE = /permission denied|\b403\b|permission to .* denied/i;

/**
 * Maps a Git or network error to a Fallback_Reason. Never throws; unknown
 * shapes fall through to `git-error`. Non-fast-forward rejections are handled
 * by the retry loop and are not classified here.
 */
export function classifyGitError(error: unknown): FallbackReason {
  try {
    const text = collectText(error);
    if (BLOCKED.test(text)) return 'push-blocked';
    if (NO_WRITE.test(text)) return 'token-lacks-write';
    return 'git-error';
  } catch {
    return 'git-error';
  }
}
