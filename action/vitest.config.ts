import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// `dist/` holds the committed Action bundle and a pruned node_modules tree.
// Neither contains tests this workspace owns.
export default defineConfig({
  // Resolve the CE package from source so a clean checkout needs no packages/ce/dist.
  resolve: {
    alias: {
      'continuous-evidence': fileURLToPath(new URL('../packages/ce/src/index.ts', import.meta.url)),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
