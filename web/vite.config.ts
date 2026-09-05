import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunk so react/router updates don't invalidate app chunks
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // During development the browser calls `/auth` and `/api`, which Vite
    // forwards to the backend so you don't have to deal with CORS.
    proxy: {
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});