import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src'), '@shared': path.resolve(import.meta.dirname, '../shared') } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['tests/setup.ts'], css: false },
  build: { chunkSizeWarningLimit: 1200 },
})
