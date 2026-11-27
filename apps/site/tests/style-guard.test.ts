// Style_Guard. This test is a snapshot of the "before" state of the Site: the
// page is deliberately unstyled. The first pull request of issue #19 removes
// or relaxes it.
// Validates: Requirements 10.5, 10.7, 10.8.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS_REL = 'apps/site/src/styles.css';
const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css');
const FORBIDDEN =
  /(?:^|[\s;{])(color|background(?:-[a-z]+)?|border-radius|box-shadow|animation(?:-[a-z]+)?|transition)\s*:/gm;

describe('Style_Guard', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it(`${CSS_REL} has at most 40 lines`, () => {
    const lines = css.replace(/\n$/, '').split('\n').length;
    expect(lines, `${CSS_REL} has ${lines} lines`).toBeLessThanOrEqual(40);
  });

  it(`${CSS_REL} declares no forbidden property`, () => {
    const found = [...css.matchAll(FORBIDDEN)].map((m) => m[1]);
    expect(found, `${CSS_REL} declares: ${found.join(', ')}`).toEqual([]);
  });
});
