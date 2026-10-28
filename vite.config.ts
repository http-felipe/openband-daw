import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the production build also loads from file:// inside Electron.
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  server: { port: 5173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
