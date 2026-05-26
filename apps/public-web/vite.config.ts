import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://api:4000',
      '/assets': 'http://minio:9000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'static',
  },
});
