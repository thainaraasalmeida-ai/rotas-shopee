import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// base relativa: o app funciona em qualquer endereço (Netlify, GitHub Pages, subpasta).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});
