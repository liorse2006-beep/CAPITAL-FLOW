import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // Tests must not depend on whatever happens to be in the developer's
    // real .env — opt-in features (Paddle, Sentry, PostHog) are tested in
    // their "unconfigured" state by default; tests that need the enabled
    // path stub the relevant VITE_ var explicitly via vi.stubEnv.
    env: {
      VITE_PADDLE_CLIENT_TOKEN: '',
      VITE_SENTRY_DSN: '',
      VITE_POSTHOG_KEY: '',
    },
  },
});
