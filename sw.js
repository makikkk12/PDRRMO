/* =====================================================================
   PDRRMO Staff Daily Monitoring — Service Worker
   - Makes the app installable and usable offline
   - Checks Netlify for changed files and tells the open app to refresh

   IMPORTANT: if you ADD or RENAME a file in the app, add it to the lists
   below. (Just editing an existing file needs no change here — updates
   are detected automatically.)
   ===================================================================== */

const APP_CACHE  = 'pdrrmo-app';
const FONT_CACHE = 'pdrrmo-fonts';

// Your own files — checked for changes on every update check
const APP_FILES = [
  './',
  './css/styles.css',
  './js/config.js',
  './js/constants.js',
  './js/utils.js',
  './js/offline-store.js',
  './js/db.js',
  './js/whereabouts.js',
  './js/personnel.js',
  './js/history.js',
  './js/pdf.js',
  './js/pwa.js',
  './js/main.js',
  './manifest.webmanifest',
];

// Files that rarely change — saved once at install
const STATIC_FILES = [
  './vendor/supabase.js',
  './vendor/html2canvas.min.js',
  './vendor/jspdf.umd.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

// ---------- INSTALL: save everything needed to run offline ----------
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll([...APP_FILES, ...STATIC_FILES].map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

// ---------- ACTIVATE: clean up old caches, take control ----------
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [APP_CACHE, FONT_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter(n => !keep.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// ---------- FETCH ----------
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: keep a copy so the app looks right offline
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(fontStrategy(req));
    return;
  }

  // Anything else on another domain (Supabase API, realtime) goes straight to the network
  if (url.origin !== self.location.origin) return;

  // Opening the app: serve the saved page instantly, then check for updates
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('./');
      if (cached) {
        event.waitUntil(checkForUpdates());
        return cached;
      }
      return fetch(req);
    })());
    return;
  }

  // App files: saved copy first, network as a fallback
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const cache = await caches.open(APP_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  })());
});

async function fontStrategy(req) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) return cached;
  const res = await network;
  return res || new Response('', { status: 503 });
}

// ---------- UPDATE CHECK ----------
// Downloads the latest copy of every app file. If anything changed, the
// new files replace the saved ones all together, then the open app is told
// to reload. Unchanged files come back as tiny "304 Not Modified" replies.
let checking = null;
let lastCheck = 0;

function checkForUpdates(force = false) {
  if (checking) return checking;
  if (!force && Date.now() - lastCheck < 30 * 1000) return Promise.resolve(false);
  lastCheck = Date.now();

  checking = (async () => {
    try {
      const cache = await caches.open(APP_CACHE);
      const fresh = await Promise.all(APP_FILES.map(async u => {
        const res = await fetch(new Request(u, { cache: 'no-cache' }));
        if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
        return res;
      }));

      const changed = [];
      for (let i = 0; i < APP_FILES.length; i++) {
        const old = await cache.match(APP_FILES[i]);
        const newText = await fresh[i].clone().text();
        const oldText = old ? await old.text() : null;
        if (newText !== oldText) changed.push(i);
      }

      if (changed.length === 0) return false;

      // Save all changed files together so the app never mixes versions
      await Promise.all(changed.map(i => cache.put(APP_FILES[i], fresh[i])));
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage({ type: 'UPDATE_READY', files: changed.map(i => APP_FILES[i]) }));
      return true;
    } catch (e) {
      // Offline or Netlify unreachable — try again next time
      return false;
    } finally {
      checking = null;
    }
  })();
  return checking;
}

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
  if (type === 'CHECK_FOR_UPDATES') event.waitUntil(checkForUpdates(!!event.data.force));
});
