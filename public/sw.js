/**
 * KAVACH service worker — offline survival without stale bundles.
 *
 * ---------------------------------------------------------------------------
 * The conflict this file exists to resolve
 * ---------------------------------------------------------------------------
 *
 * docs/09 requires offline operation and an installable Android path. vite.config.ts
 * sets `Cache-Control: no-store, must-revalidate` on purpose, with a comment
 * explaining why: a device holding an old bundle would score a trainee against
 * gate logic that is no longer the logic being certified. A certificate issued
 * under rules nobody is currently teaching is worse than no certificate.
 *
 * A cache-first service worker would destroy exactly that guarantee, so it is
 * not what this is. The resolution:
 *
 *   online   → network wins, always. Fresh code, fresh manifests, fresh gate
 *              logic. The cache is updated behind the request, not instead of it.
 *   offline  → the cache answers, so the app opens and a trainee can keep
 *              working. Attempts queue locally and sync on reconnect.
 *
 * So the cache is a *fallback*, never a source of truth. A trainee can only
 * ever run an older bundle while the network is unreachable — and in that state
 * there is no newer bundle to run, so nothing is being contradicted. The moment
 * the network returns, the next load is fresh.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT cached
 * ---------------------------------------------------------------------------
 *
 * `/convex/*` — the backend. Caching an API response would mean serving a stale
 * score, a stale gate verdict, or a stale certificate status, which is the same
 * class of bug as the stale bundle. Those requests go to the network or they
 * fail, and `lib/db.ts` already owns retry through the IndexedDB queue.
 */

const VERSION = "kavach-v1";
const SHELL = `${VERSION}-shell`;

/** The minimum needed for the app to open with no network at all. */
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Individually, so one 404 cannot abort the whole install. `addAll` is
      // atomic and would leave the app with no cache at all.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {}),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache from a previous version. Nothing old survives an
      // update, so a device can never mix two builds.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GETs are cacheable, and only same-origin ones are ours.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The backend is never cached. See the note at the top of this file.
  if (url.pathname.startsWith("/convex/")) return;

  // Vite's dev server and source maps are not for a trainee's phone.
  if (url.pathname.startsWith("/@") || url.pathname.startsWith("/node_modules/")) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(request);
        // Only cache real, complete responses. A 404 or an opaque error cached
        // here would become a permanently broken app shell while offline.
        if (fresh && fresh.ok && fresh.type === "basic") {
          const cache = await caches.open(SHELL);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(request, { ignoreSearch: url.pathname === "/" });
        if (cached) return cached;

        // A navigation with nothing cached for it still gets the shell, because
        // this is a single-page app and every route is client-side.
        if (request.mode === "navigate") {
          const shell = await caches.match("/index.html");
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
