import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Tests for the committed Action_Bundle (working-tree action/dist/).
// Requirements 2.5, 2.7, 2.9.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'action', 'dist');
const DIST_MODULES = path.join(DIST, 'node_modules');
const MAIN = path.join(ROOT, 'action', 'dist', 'index.js');

const FIXTURE_KEYS = {
  OPENROUTER_API_KEY: 'sk-or-fixture-0123456789abcdef-bundle-test',
  TYPESAFE_API_KEY: 'ts-fixture-fedcba9876543210-bundle-test',
};

/** Every file under `dir` as a sorted list of paths relative to `dir`. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  visit(dir);
  return out.sort();
}

let tmp = '';
let rebuilt = '';

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'ce-bundle-test-'));
  rebuilt = path.join(tmp, 'dist');
  const res = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'build-action.mjs'), `--out-dir=${rebuilt}`],
    { cwd: ROOT, env: { ...process.env, ...FIXTURE_KEYS }, encoding: 'utf8' },
  );
  if (res.status !== 0) {
    throw new Error(`build-action failed (${res.status}): ${res.stderr}\n${res.stdout}`);
  }
}, 180_000);

afterAll(() => {
  if (tmp !== '') rmSync(tmp, { recursive: true, force: true });
});

describe('committed Action_Bundle', () => {
  it('equals a fresh rebuild (Requirement 2.5)', () => {
    const committed = listFiles(DIST);
    const fresh = listFiles(rebuilt);
    expect(fresh).toEqual(committed);
    const differing = committed.filter(
      (file) => !readFileSync(path.join(DIST, file)).equals(readFileSync(path.join(rebuilt, file))),
    );
    expect(differing, 'run `npm run build:action` and commit action/dist/').toEqual([]);
  }, 60_000);

  it('contains no fixture credential value (Requirement 2.7)', () => {
    for (const root of [DIST, rebuilt]) {
      for (const file of listFiles(root)) {
        if (!/\.(c|m)?js$|\.json$/.test(file)) continue;
        const text = readFileSync(path.join(root, file), 'utf8');
        for (const [name, value] of Object.entries(FIXTURE_KEYS)) {
          expect(text.includes(value), `${name} value found in ${file}`).toBe(false);
        }
      }
    }
  }, 60_000);

  it('is not ignored by git (Requirement 2.9)', () => {
    const ignored = (file: string): boolean =>
      spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: ROOT }).status === 0;
    expect(existsSync(MAIN)).toBe(true);
    expect(ignored(MAIN), 'runs.main file is ignored').toBe(false);
    if (existsSync(DIST_MODULES)) {
      const sample = listFiles(DIST_MODULES)[0];
      expect(sample).toBeDefined();
      expect(ignored(path.join(DIST_MODULES, sample as string)), 'node_modules file is ignored').toBe(
        false,
      );
    }
  });
});
