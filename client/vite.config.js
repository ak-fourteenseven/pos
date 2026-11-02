import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { appDepAliases } from '../shared/app-alias.js';

const repoRoot = path.resolve(__dirname, '..');

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': path.join(repoRoot, 'shared'),
      ...appDepAliases(__dirname),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot], strict: false },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
