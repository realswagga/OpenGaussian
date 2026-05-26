import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  resolve: {
    alias: {
      '@gsplat/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@gsplat/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      '@gsplat/viewer-core': path.resolve(__dirname, '../../packages/viewer-core/src/index.ts'),
    },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'static',
  },
});
