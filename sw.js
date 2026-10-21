/* Basic app-shell cache. For data integrity, use server sync APIs; never treat this cache as a database. */
const CACHE_NAME = 'rk-tent-erp-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => { if (event.request.method !== 'GET') return; const url = new URL(event.request.url); if (url.origin !== self.location.origin) return; event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy=response.clone(); caches.open(CACHE_NAME).then(c=>c.put(event.request,copy)); } return response; }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))); });
