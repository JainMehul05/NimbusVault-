import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Where the dev and preview servers forward /api (docker compose publishes the backend on 3002).
const proxy = {
  '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3100', changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@routes': path.resolve(__dirname, './src/routes'),
      '@services': path.resolve(__dirname, './src/services'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@context': path.resolve(__dirname, './src/context'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@styles': path.resolve(__dirname, './src/styles'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
    proxy,
  },
  preview: { port: 4173, proxy },
  build: { sourcemap: false, target: 'es2022' },
});
