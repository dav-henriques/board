/* ═══════════════════════════════════════════════════════════════
   Service worker — app shell offline
   Troque a versão sempre que publicar mudanças nos assets.

   Vale para a cor: o index.html vem sempre da rede (o site em si muda de
   cor na hora), mas ícones, og e splash ficam em cache. Trocou CONFIG.accent,
   rodou o build-assets.py? Suba o VERSION junto, senão quem já instalou o
   app continua com o ícone antigo na tela do celular por mais um tempo.
   ═══════════════════════════════════════════════════════════════ */
const VERSION = 'v3';
const SHELL   = `sunn-shell-${VERSION}`;
const RUNTIME = `sunn-runtime-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/mark.png',
  './assets/mark-sun.png',
  './assets/mark-core.png',
  './assets/avatar.jpg',
  './assets/og.png',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cada item isolado: um asset ausente não invalida a instalação inteira
    await Promise.all(PRECACHE.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // navegação: rede primeiro, cai para o shell em caso de offline
  if (request.mode === 'navigate'){
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // fontes externas: stale-while-revalidate
  if (FONT_HOSTS.includes(url.hostname)){
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(request);
      const net = fetch(request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  // mesma origem: cache primeiro, revalidando em segundo plano
  if (url.origin === location.origin){
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(request, { ignoreSearch: true });
      const net = fetch(request).then((res) => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});
