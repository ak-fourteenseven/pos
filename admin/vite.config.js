import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { appDepAliases } from '../shared/app-alias.js';

const repoRoot = path.resolve(__dirname, '..');

export default defineConfig({
  plugins: [vue()],
  /* 開發模式根路徑；UAT 打包時以 ADMIN_BASE_PATH=/admin/ 構建，由服務端以 /admin 前綴託管 */
  base: process.env.ADMIN_BASE_PATH || '/',
  resolve: {
    alias: {
      '@shared': path.join(repoRoot, 'shared'),
      ...appDepAliases(__dirname),
    },
  },
  server: {
    port: 5175,
    fs: { allow: [repoRoot], strict: false },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
