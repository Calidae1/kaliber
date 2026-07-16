/* sw.js — Offline-Betrieb.
 * Zwei getrennte Caches: die App-Hülle ändert sich selten, die Daten regelmäßig.
 * Hülle: cache-first (schneller Start). Daten: network-first mit Cache-Rückfall
 * (frisch wenn online, funktioniert wenn nicht).
 *
 * WICHTIG BEIM AUSLIEFERN EINER NEUEN VERSION: VERSION hochzählen. Sonst
 * installiert sich dieser Worker nie neu, und die Nutzer bekommen dauerhaft die
 * alte Hülle serviert — auch wenn auf dem Server längst neue Dateien liegen.
 */
const VERSION = 'v7';
// SHELL-HASH: 58c53d52309cc003
// Die Zeile darüber prüft tools/pruefe.py: Ändert sich eine Datei der App-Hülle,
// ohne dass VERSION hochgezählt wird, liefert der Worker sie nie neu aus — die
// Nutzer bekämen dauerhaft den alten Stand. Genau das ist hier zweimal passiert.
const SHELL = 'kk-shell-' + VERSION;
const DATA = 'kk-data-' + VERSION;

const SHELL_FILES = [
  './', './index.html', './app.css', './app.js', './ballistik.js',
  './manifest.webmanifest',
  // Die Symbole gehören dazu: ohne sie zeigt die installierte App auf dem
  // Startbildschirm im Zweifel nichts an.
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // cache:'reload' umgeht den HTTP-Cache des Browsers. Ohne das kann eine frisch
    // installierte Worker-Version die ALTEN Dateien aus dem Browser-Cache einsammeln
    // und sie dann dauerhaft als vermeintlich neu ausliefern.
    await Promise.all(SHELL_FILES.map(async url => {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok) await c.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  // "Daten aktualisieren" im UI leert den Datencache, damit der nächste Abruf frisch zieht.
  if (e.data && e.data.typ === 'daten-neu') caches.delete(DATA);
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    e.respondWith(
      // cache:'reload' umgeht den HTTP-Cache des Browsers. Ohne das ist
      // "network-first" eine Lüge: Der Abruf landet im Browser-Cache (GitHub
      // Pages setzt dort max-age=600), liefert bis zu zehn Minuten alte Daten
      // zurück — und die schreiben wir dann auch noch in den Offline-Cache.
      // Nach einem Preis-Update sähen die Nutzer so alte Preise, obwohl die App
      // scheinbar frisch geladen hat.
      fetch(new Request(req.url, { cache: 'reload' }))
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(req, copy));
      return res;
    }))
  );
});
