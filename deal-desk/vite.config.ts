import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  base: '/deal-desk/',
  publicDir: false,
  plugins: [react()],
  resolve: {alias: {'@': fileURLToPath(new URL('.', import.meta.url))}},
  css: {postcss: {plugins: [tailwind()]}},
  build: {outDir: '../public/deal-desk', emptyOutDir: true},
});
