/**
 * Structure snapshot over the four committed per-Outcome fixtures (task 8.7,
 * Requirement 16 criterion 9). Regenerate with
 * `npm run generate:report-fixtures -w continuous-evidence`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixtureRecords } from './report.fixtures.testsupport.js';
import { RunRecordSchema } from '../schema.js';
import { render } from './render.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const records = fixtureRecords();
const NAMES = ['skipped', 'evidenced', 'unsupported', 'error'] as const;

const read = (name: string, file: string) => readFileSync(path.join(dir, name, file), 'utf8');

/** Ordered `tag#id` of every section and every h1/h2 in the document. */
function outline(html: string): string[] {
  return [...html.matchAll(/<(section|h1|h2)\b[^>]*?(?:\sid="([^"]*)")?[^>]*>/g)].map(
    (m) => `${m[1]}#${m[2] ?? ''}`,
  );
}

describe('committed per-Outcome report fixtures', () => {
  it('covers each Outcome once', () => {
    expect(NAMES.map((n) => records[n].outcome)).toEqual(['SKIPPED', 'EVIDENCED', 'UNSUPPORTED', 'ERROR']);
  });

  for (const name of NAMES) {
    describe(name, () => {
      it('run.json is a valid Run_Record and matches the fixture source', () => {
        const parsed = RunRecordSchema.parse(JSON.parse(read(name, 'run.json')));
        expect(parsed).toEqual(records[name]);
      });

      it('report.html equals render(run.json) (fixture not stale)', () => {
        expect(read(name, 'report.html')).toBe(render(records[name]));
      });

      it('has the expected section structure', () => {
        const html = read(name, 'report.html');
        const sections = outline(html).filter((o) => o.startsWith('section#'));
        expect(sections.slice(0, 5)).toEqual([
          'section#banner',
          'section#claims',
          'section#assessment',
          'section#timeline',
          'section#final',
        ]);
        expect(sections).toContain('section#logs');
        expect(html).toContain(`data-outcome="${records[name].outcome}"`);
        expect([...html.matchAll(/<h1\b/g)]).toHaveLength(1);
      });

      it('references only screenshots that exist next to it, and contains no secret-like value', () => {
        const html = read(name, 'report.html');
        for (const m of html.matchAll(/<img\b[^>]*\ssrc="(?!data:)([^"]+)"/g)) {
          expect(existsSync(path.join(dir, name, decodeURIComponent(m[1]!)))).toBe(true);
        }
        for (const file of ['report.html', 'run.json']) {
          expect(read(name, file)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S{8,}|API_KEY\s*[=:]/i);
        }
      });
    });
  }

  it('EVIDENCED fixture shows the Box highlight; the others show no final screenshot', () => {
    expect(read('evidenced', 'report.html')).toContain('class="box"');
    for (const name of ['skipped', 'unsupported', 'error'] as const) {
      expect(read(name, 'report.html')).not.toContain('class="box"');
    }
  });
});
