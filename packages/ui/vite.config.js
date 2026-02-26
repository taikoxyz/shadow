import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Forward REST API calls to the Rust backend
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Forward WebSocket to the Rust backend
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
