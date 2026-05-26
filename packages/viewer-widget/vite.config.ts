import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/gs-viewer.ts'),
      name: 'GsViewer',
      formats: ['iife'],
      fileName: () => 'gs-viewer.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Bundle renderer dependencies and viewer-core inline since the host page won't have them
      output: {
        extend: true,
        inlineDynamicImports: true,
      },
    },
  },
  // Ensure Three.js is resolved and bundled (not treated as external)
  resolve: {
    alias: {
      '@gsplat/viewer-core': path.resolve(__dirname, '../viewer-core/src/index.ts'),
    },
  },
  optimizeDeps: {
    include: ['playcanvas', 'three'],
  },
});
