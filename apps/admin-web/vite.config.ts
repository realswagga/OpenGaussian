import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

function patchPlaycanvasSortWorker(): Plugin {
  return {
    name: 'patch-playcanvas-sort-worker',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, '/');
      if (normalizedId.endsWith('gsplat-sort-worker.js') && normalizedId.includes('playcanvas')) {
        if (code.includes('SortWorkerSource')) return null;
        let patched = code.replace(/^function SortWorker\(\) \{/m, 'const SortWorkerSource = `function SortWorker() {');
        patched = patched.replace(/\}\s*\n\s*export \{ SortWorker \};\s*$/, '}`;\n\nfunction SortWorker() {}\n\nexport { SortWorker, SortWorkerSource };\n');
        patched = patched.replace(/\bfor\(let c = 0; c < numChunks;/g, 'for(let chunkIdx = 0; chunkIdx < numChunks;');
        patched = patched.replace(/\bconst start = c \* 256;/g, 'const start = chunkIdx * 256;');
        patched = patched.replace(/\bconst end = Math\.min\(numVertices, \(c \+ 1\) \* 256\);/g, 'const end = Math.min(numVertices, (chunkIdx + 1) * 256);');
        patched = patched.replace(/\bchunks\[c \* 4 \+/g, 'chunks[chunkIdx * 4 +');
        return { code: patched, map: null };
      }
      if (normalizedId.endsWith('gsplat-sorter.js') && normalizedId.includes('playcanvas')) {
        if (code.includes('SortWorkerSource')) return null;
        let patched = code.replace(/import \{ SortWorker \} from '\.\/gsplat-sort-worker\.js';/, "import { SortWorkerSource } from './gsplat-sort-worker.js';");
        patched = patched.replace(/const workerSource = .+?;\s*\n/, 'const workerSource = `(${SortWorkerSource})()`;\n');
        return { code: patched, map: null };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), patchPlaycanvasSortWorker()],
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
