import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Workaround for PlayCanvas sort worker crash.
 *
 * PlayCanvas creates its CPU sort Web Worker via:
 *   const workerSource = `(${SortWorker.toString()})()`;
 *
 * When Vite/esbuild minifies the bundle, SortWorker.toString() produces code
 * that references outer-scope minified variables (e.g. "ReferenceError: c is
 * not defined"), crashing the Worker silently → zero splats rendered.
 *
 * This plugin patches the two source modules at transform time so the Worker
 * source is a raw template-literal string that minifiers cannot touch.
 */
function patchPlaycanvasSortWorker(): Plugin {
  const workerModule = 'playcanvas/build/playcanvas/src/scene/gsplat/gsplat-sort-worker.js';
  const sorterModule = 'playcanvas/build/playcanvas/src/scene/gsplat/gsplat-sorter.js';

  return {
    name: 'patch-playcanvas-sort-worker',
    enforce: 'pre',
    transform(code, id) {
      // Normalize path separators for cross-platform matching
      const normalizedId = id.replace(/\\/g, '/');

      if (normalizedId.endsWith('gsplat-sort-worker.js') && normalizedId.includes('playcanvas')) {
        if (code.includes('SortWorkerSource')) return null; // already patched

        // Wrap the SortWorker function body in a raw template-literal string
        // so the minifier cannot mangle its internal variable names.
        let patched = code.replace(
          /^function SortWorker\(\) \{/m,
          'const SortWorkerSource = `function SortWorker() {',
        );
        patched = patched.replace(
          /\}\s*\n\s*export \{ SortWorker \};\s*$/,
          '}`;\n\nfunction SortWorker() {\n\t// Stub — worker source uses SortWorkerSource\n}\n\nexport { SortWorker, SortWorkerSource };\n',
        );

        // Extra safety: rename the problematic loop variable `c` to `chunkIdx`
        // so even if something else stringifies it, there's no scope collision.
        patched = patched.replace(/\bfor\(let c = 0; c < numChunks;/g, 'for(let chunkIdx = 0; chunkIdx < numChunks;');
        patched = patched.replace(/\bconst start = c \* 256;/g, 'const start = chunkIdx * 256;');
        patched = patched.replace(/\bconst end = Math\.min\(numVertices, \(c \+ 1\) \* 256\);/g, 'const end = Math.min(numVertices, (chunkIdx + 1) * 256);');
        patched = patched.replace(/\bchunks\[c \* 4 \+/g, 'chunks[chunkIdx * 4 +');

        return { code: patched, map: null };
      }

      if (normalizedId.endsWith('gsplat-sorter.js') && normalizedId.includes('playcanvas')) {
        if (code.includes('SortWorkerSource')) return null; // already patched

        let patched = code.replace(
          /import \{ SortWorker \} from '\.\/gsplat-sort-worker\.js';/,
          "import { SortWorkerSource } from './gsplat-sort-worker.js';",
        );
        patched = patched.replace(
          /const workerSource = .+?;\s*\n/,
          'const workerSource = `(${SortWorkerSource})()`;\n',
        );

        return { code: patched, map: null };
      }

      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), patchPlaycanvasSortWorker()],
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
