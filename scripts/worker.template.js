const prefix = 'shosho-' + self.registration.scope + '-';
const cacheName = prefix + '__VERSION__';
const files = "__FILES__";
self.addEventListener('install', event => {
  // versão nova assume logo, sem esperar fechar todas as janelas
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Mantém as 3 versões mais recentes: uma página aberta na versão anterior continua achando seus arquivos.
    const mine = (await caches.keys()).filter(name => name.startsWith(prefix));
    for (const name of mine.slice(0, Math.max(0, mine.length - 3))) if (name !== cacheName) await caches.delete(name);
    await self.clients.claim();
  })());
});
async function fromAnyCache(request) {
  const own = await (await caches.open(cacheName)).match(request);
  if (own) return own;
  for (const name of (await caches.keys()).reverse()) {
    if (!name.startsWith(prefix)) continue;
    const hit = await (await caches.open(name)).match(request);
    if (hit) return hit;
  }
  return undefined;
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    if (event.request.mode === 'navigate') {
      // Com internet, abre sempre a página mais nova; sem internet, a guardada.
      try {
        const fresh = await fetch(event.request, { cache: 'no-store' });
        if (fresh.ok) return fresh;
      } catch { /* sem conexão */ }
      return (await fromAnyCache('index.html')) || fetch(event.request);
    }
    return (await fromAnyCache(event.request)) || fetch(event.request);
  })());
});
