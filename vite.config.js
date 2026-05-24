import { defineConfig } from 'vite';

const REPO_BASE = '/qrbookhub/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020',
    cssCodeSplit: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 800,
    minify: 'esbuild',
  },
  server: {
    port: 5173,
    open: true,
  },
  preview: {
    port: 4173,
    open: true,
  },
}));
