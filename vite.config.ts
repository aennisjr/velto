import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: false,
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
