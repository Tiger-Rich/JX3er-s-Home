import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e.spec.js'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.js',
  },
});
