import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

(window as Window & { __shoshoBooted?: boolean }).__shoshoBooted = true;
try { sessionStorage.removeItem('shoshoRecovered'); } catch { /* */ }
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
    // Quando chega uma versão nova, recarrega uma vez para mostrar as telas atualizadas (os dados ficam salvos).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {
      /* ambiente sem suporte (ex.: visualização dentro do Claude) */
    });
  });
}
