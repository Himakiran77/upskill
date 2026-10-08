import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// In dev the React app runs on 5173 and forwards /api to the Express server.
// The backend's port comes from the same root .env the backend reads, so
// changing PORT there moves both ends together.
export default defineConfig(({ mode }) => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = process.env.PORT ?? env.PORT ?? '4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
  };
});
