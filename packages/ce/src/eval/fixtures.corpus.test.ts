// Checks the real fixtures/eval/ corpus without an API key.
// Requirements 11.1-11.11, 12.1, 12.4, 12.5, 16.8, 16.17.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigDefaults } from '../config/defaults.js';
import { SURFACE_LABELS } from '../jev/catalog.js';
import { loadFixtures, type EvalFixtureFile } from './fixture.js';
import { buildFixtureContext } from './providers.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '..', '..', 'fixtures', 'eval');

const names = readdirSync(dir)
  .filter((n) => n.endsWith('.json'))
  .sort();
const files: { name: string; file: EvalFixtureFile }[] = names.map((name) => ({
  name,
  file: JSON.parse(readFileSync(join(dir, name), 'utf8')) as EvalFixtureFile,
}));

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /sk-or-[A-Za-z0-9_-]{8,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{16,}/i,
];

describe('fixtures/eval corpus', () => {
  it('has between 15 and 20 fixtures (11.1)', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.length).toBeLessThanOrEqual(20);
  });

  it('every id equals the file name without .json (11.2)', () => {
    for (const { name, file } of files) {
      expect(file.id, name).toBe(name.slice(0, -'.json'.length));
    }
  });

  it('loadFixtures succeeds on the real directory (12.1, 12.4, 12.5)', () => {
    const result = loadFixtures(dir);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.fixtures).toHaveLength(files.length);
  });

  describe('coverage (11.6, 11.7, 11.10)', () => {
    const surfacesOf = (f: EvalFixtureFile) => Object.values(f.labels.surface);

    it('has at least 3 fixtures with required false', () => {
      expect(files.filter((x) => !x.file.labels.required).length).toBeGreaterThanOrEqual(3);
    });

    it('has at least 3 required fixtures with a browser_ui surface', () => {
      const n = files.filter(
        (x) => x.file.labels.required && surfacesOf(x.file).includes('browser_ui'),
      ).length;
      expect(n).toBeGreaterThanOrEqual(3);
    });

    it('has at least 2 required fixtures with a surface other than browser_ui and non_runtime', () => {
      const n = files.filter(
        (x) =>
          x.file.labels.required &&
          surfacesOf(x.file).some((s) => s !== 'browser_ui' && s !== 'non_runtime'),
      ).length;
      expect(n).toBeGreaterThanOrEqual(2);
    });

    it('has at least 1 not_identified fixture', () => {
      expect(
        files.filter((x) => x.file.labels.claimStatus === 'not_identified').length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('has at least 1 fixture with claims', () => {
      expect(
        files.filter((x) => (x.file.change.claims?.length ?? 0) > 0).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('uses every one of the six Surface values', () => {
      const used = new Set(files.flatMap((x) => surfacesOf(x.file)));
      for (const s of SURFACE_LABELS) expect(used.has(s), s).toBe(true);
    });

    it('has at least 2 near-miss fixtures', () => {
      const n = files.filter((x) => /near[- ]miss/i.test(x.file.description)).length;
      expect(n).toBeGreaterThanOrEqual(2);
    });
  });

  describe('candidates (11.3, 11.11, 12.4)', () => {
    it('produces at most 12 candidates per fixture and no isBehavior label for cli candidates', () => {
      for (const { name, file } of files) {
        const { context, execCalls } = buildFixtureContext(file, {
          config: ConfigDefaults,
          env: {},
        });
        expect(execCalls, name).toHaveLength(0);
        expect(context.candidates.length, name).toBeLessThanOrEqual(12);
        for (const c of context.candidates) {
          const hasLabel = Object.prototype.hasOwnProperty.call(file.labels.isBehavior, c.text);
          if (c.provenance.provider === 'cli') {
            expect(hasLabel, `${name}: cli candidate "${c.text}"`).toBe(false);
          } else {
            expect(hasLabel, `${name}: candidate "${c.text}"`).toBe(true);
          }
        }
      }
    });
  });

  it('contains no secret-looking strings (11.8)', () => {
    for (const { name } of files) {
      const text = readFileSync(join(dir, name), 'utf8');
      for (const pattern of SECRET_PATTERNS) {
        expect(pattern.test(text), `${name} matches ${pattern}`).toBe(false);
      }
    }
  });
});
