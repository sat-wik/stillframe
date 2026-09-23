import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // relative paths so the build works from an itch.io HTML5 zip
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
