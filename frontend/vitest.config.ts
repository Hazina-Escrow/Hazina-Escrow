import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    env: {
      VITE_API_URL: 'http://localhost:3000',
      VITE_API_KEY: 'test-api-key',
      VITE_STELLAR_NETWORK: 'testnet',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'e2e/**',
        '**/*.test.tsx',
        '**/*.spec.tsx',
        '**/*.spec.ts',
      ],
      thresholds: {
        lines: 50,
        functions: 35,
        branches: 60,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
