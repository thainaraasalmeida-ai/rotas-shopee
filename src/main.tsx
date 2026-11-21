import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: funciona offline depois da primeira abertura (onde service workers são permitidos).
// No app do iPhone (Capacitor) os arquivos já ficam dentro do aplicativo: não precisa de service worker.
const nativeApp = !!(window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
if (import.meta.env.PROD && !nativeApp && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* ambiente sem suporte (ex.: visualização dentro do Claude) */
    });
  });
}
