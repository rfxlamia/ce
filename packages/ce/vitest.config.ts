import { configDefaults, defineConfig } from 'vitest/config';

// Tests run against `src`. `tsc` also emits compiled tests into `dist`, which
// must not be collected (fixtures and sources are resolved relative to `src`).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
