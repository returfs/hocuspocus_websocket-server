import { defineConfig } from 'vitest/config';

// Own config so Vitest 4 does not walk up to the root vitest.config.ts and
// apply its `projects` list relative to this package.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
