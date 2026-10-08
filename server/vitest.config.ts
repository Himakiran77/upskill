import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The API tests share one test database, so files run one at a time.
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
  },
});
