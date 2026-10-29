importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js');

// Gebruik exact dezelfde config als in je hoofdscript
const firebaseConfig = {
  apiKey: "AIzaSyB8uHwRXCe1iV7z6T80YPxEbeB64qdMpNY",
  authDomain: "shift-planner-dc7ad.firebaseapp.com",
  projectId: "shift-planner-dc7ad",
  messagingSenderId: "719441527396",
  appId: "1:719441527396:web:de87d6f950fe23702a5571"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Bericht tonen als de app op de achtergrond draait of gesloten is
// (berichten mét "notification" toont Firebase zelf; anders zou je ze dubbel krijgen)
messaging.onBackgroundMessage(payload => {
  if (payload.notification) return;
  const { title = 'Shift Planner', body = '' } = payload.data || {};
  self.registration.showNotification(title, { body, icon: 'favicon-192x192.png' });
});

// Tik op een melding: app openen
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => new URL(c.url).pathname === new URL(self.registration.scope).pathname);
      return open ? open.focus() : self.clients.openWindow('./');
    })
  );
});

// ---------------------------------------------------------------------
// App op het beginscherm: offline openen
// - eigen bestanden: eerst internet (altijd de nieuwste versie), anders uit de cache
// - bibliotheken en lettertypes (CDN): uit de cache, op de achtergrond bijwerken
// Firestore-data gaat hier niet door; die heeft een eigen offline-cache.
// ---------------------------------------------------------------------
const CACHE = 'shift-planner-v4';
const APP_SHELL = ['./', 'index.html', 'app.css', 'app.js', 'login/', 'login/login.css', 'login/login.js', 'manifest.json', 'favicon-192x192.png', 'apple-touch-icon-180x180.png', 'favicon.svg'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com', 'cdnjs.cloudflare.com', 'unpkg.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Netwerk eerst; versienummers (?v=) negeren voor de offline-kopie
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then(r => r || caches.match(req, { ignoreSearch: true })))
    );
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(req).then(hit => {
          const net = fetch(req)
            .then(res => {
              if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
  }
});
