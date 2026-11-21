import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// base relativa: o app funciona em qualquer endereço (Netlify, GitHub Pages, subpasta).
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) },
  plugins: [react()],
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});
