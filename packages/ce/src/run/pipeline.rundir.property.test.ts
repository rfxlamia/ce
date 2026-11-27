import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runDirName } from './pipeline.js';

const validDateArb = fc.date().filter((d) => !Number.isNaN(d.getTime()));

// Feature: run-vertical-slice, Property 9: Run directory names
describe('Property 9: Run directory names', () => {
  /**
   * **Validates: Requirements 11.2**
   */
  it('starts with run-, has no ":" or ".", and is never an eval-<iso> name', () => {
    fc.assert(
      fc.property(validDateArb, (date) => {
        const name = runDirName(date);
        const evalName = `eval-${date.toISOString().replace(/[:.]/g, '-')}`;
        expect(name.startsWith('run-')).toBe(true);
        expect(name).not.toContain(':');
        expect(name).not.toContain('.');
        expect(name.startsWith('eval-')).toBe(false);
        expect(name).not.toBe(evalName);
        expect(name).not.toBe(`eval-${date.toISOString()}`);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 11.2**
   */
  it('gives different names for different timestamps', () => {
    fc.assert(
      fc.property(validDateArb, validDateArb, (a, b) => {
        fc.pre(a.getTime() !== b.getTime());
        expect(runDirName(a)).not.toBe(runDirName(b));
      }),
      { numRuns: 200 },
    );
  });
});
