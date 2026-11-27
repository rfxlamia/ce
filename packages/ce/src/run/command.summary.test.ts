import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TargetUnreachableError } from '../runtime/target.js';
import { runRunCommand } from './command.js';
import type { RunCommandDeps } from './command.js';
import { run } from './pipeline.js';
import type { RunResult } from './types.js';

vi.mock('./pipeline.js', () => ({ run: vi.fn() }));

let out: string[];
let err: string[];

function deps(): RunCommandDeps {
  return {
    env: {},
    cwd: '/nonexistent',
    stdout: { write: (t: string) => out.push(t) },
    stderr: { write: (t: string) => err.push(t) },
    createGateway: vi.fn(),
    now: () => new Date('2026-01-02T03:04:05.678Z'),
  };
}

function noBundle(fields: Record<string, unknown>): RunResult {
  return {
    kind: 'resolved',
    bundleWritten: false,
    runDir: '/nonexistent/.ce/runs/x',
    claimTexts: [],
    ...fields,
  } as unknown as RunResult;
}

beforeEach(() => {
  out = [];
  err = [];
  vi.mocked(run).mockReset();
});

describe('runRunCommand summary output', () => {
  it.each([
    ['SKIPPED', 0],
    ['UNSUPPORTED', 0],
    ['ERROR', 1],
  ] as const)('writes a stdout that starts with "Outcome: %s" and returns the result exit code', async (outcome, exitCode) => {
    vi.mocked(run).mockResolvedValueOnce(noBundle({ outcome, reason: 'some-reason', exitCode }));
    const code = await runRunCommand([], deps());
    expect(code).toBe(exitCode);
    expect(out.join('').startsWith(`Outcome: ${outcome}\n`)).toBe(true);
  });

  it('leaves stderr empty for a non-ERROR result', async () => {
    vi.mocked(run).mockResolvedValueOnce(noBundle({ outcome: 'SKIPPED', reason: 'checks-adequate', exitCode: 0 }));
    await runRunCommand([], deps());
    expect(err.join('')).toBe('');
  });

  it('keeps the Reason and Surface diagnostics on stderr for an ERROR without a Stage_Error', async () => {
    vi.mocked(run).mockResolvedValueOnce(
      noBundle({ outcome: 'ERROR', reason: 'no-observation', surface: 'browser_ui', exitCode: 1 }),
    );
    await runRunCommand([], deps());
    expect(out.join('').startsWith('Outcome: ERROR\n')).toBe(true);
    expect(err.join('')).toBe('Reason: no-observation\nSurface: browser_ui\n');
  });

  it('keeps the error message and the unreachable-target lines on stderr', async () => {
    const cause = new TargetUnreachableError({
      url: 'http://localhost:3000/',
      lastStatus: 503,
      timeoutMs: 100,
      mode: 'attached',
    });
    const error = Object.assign(new Error('runtime failed'), { cause });
    vi.mocked(run).mockResolvedValueOnce(noBundle({ outcome: 'ERROR', reason: 'x', exitCode: 1, error }));
    await runRunCommand([], deps());
    expect(out.join('').startsWith('Outcome: ERROR\n')).toBe(true);
    expect(err.join('')).toBe(
      `runtime failed\nTarget URL: ${cause.url}\nLast status: 503\n`,
    );
  });
});
