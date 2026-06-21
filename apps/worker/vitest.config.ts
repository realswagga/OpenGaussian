import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    cache: false,
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
