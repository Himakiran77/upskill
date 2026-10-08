import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the React app runs on 5173 and forwards /api to the Express server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${process.env.PORT ?? 4000}`,
    },
  },
});
