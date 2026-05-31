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

        const fnMatch = code.match(/^(function SortWorker\(\) \{[\s\S]*?\n\})\s*\n\s*export \{ SortWorker \};\s*$/);
        if (!fnMatch) return null;

        let fnSource = fnMatch[1];

        fnSource = fnSource.replace(/\bfor\(let c = 0; c < numChunks;/g, 'for(let chunkIdx = 0; chunkIdx < numChunks;');
        fnSource = fnSource.replace(/\bconst start = c \* 256;/g, 'const start = chunkIdx * 256;');
        fnSource = fnSource.replace(/\bconst end = Math\.min\(numVertices, \(c \+ 1\) \* 256\);/g, 'const end = Math.min(numVertices, (chunkIdx + 1) * 256);');
        fnSource = fnSource.replace(/\bchunks\[c \* 4 \+/g, 'chunks[chunkIdx * 4 +');

        const patched = `const SortWorkerSource = ${JSON.stringify(fnSource)};\n\nfunction SortWorker() {}\n\nexport { SortWorker, SortWorkerSource };\n`;

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
