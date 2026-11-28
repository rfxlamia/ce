/**
 * The CE package version. Leaf module: imports nothing, so any module
 * (including `evidence/`) can read it without a cycle through `index.ts`.
 *
 * Must equal `version` in `packages/ce/package.json`; `version.staleness.test.ts`
 * fails when they differ.
 */
export const VERSION = '0.1.1';
