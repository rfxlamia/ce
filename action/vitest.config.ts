import { configDefaults, defineConfig } from 'vitest/config';

// `dist/` holds the committed Action bundle and a pruned node_modules tree.
// Neither contains tests this workspace owns.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
