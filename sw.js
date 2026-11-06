// Service worker Zartizan : rend l'appli installable et la fait démarrer même sans réseau.
// Pense à changer VERSION à chaque mise à jour de l'appli.
const VERSION = "zartizan-v2";
const SHELL = [
  "./", "./index.html", "./config.js", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Données Supabase : toujours en direct, jamais en cache
  if (url.hostname.endsWith("supabase.co")) return;

  // Librairie Supabase (CDN) : cache puis mise à jour en arrière-plan
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // Fichiers de l'appli : réseau d'abord (pour avoir la dernière version), cache si hors ligne
  e.respondWith(
    fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
  );
});
