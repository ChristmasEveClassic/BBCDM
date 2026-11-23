
// BBCDM Progressive Web App
// Service worker for application caching.

const CACHE = 'bbcdm-static-v2';

const CORE = [
  '/',
  '/icon.svg',
  '/manifest.webmanifest',
];

// Install the service worker.

self.addEventListener(
  'install',
  event => {
    event.waitUntil(
      caches
        .open(CACHE)
        .then(cache =>
          cache.addAll(CORE)
        )
        .then(() =>
          self.skipWaiting()
        )
    );
  }
);

// Remove old caches after updates.

self.addEventListener(
  'activate',
  event => {
    event.waitUntil(
      Promise.all([
        caches
          .keys()
          .then(keys =>
            Promise.all(
              keys
                .filter(
                  key => key !== CACHE
                )
                .map(
                  key =>
                    caches.delete(key)
                )
            )
          ),

        self.clients.claim(),
      ])
    );
  }
);

// Use network-first loading.
// Cached content is a fallback when offline.

self.addEventListener(
  'fetch',
  event => {
    if (
      event.request.method !== 'GET'
    ) {
      return;
    }

    const url = new URL(
      event.request.url
    );

    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }

    event.respondWith(
      (async () => {
        try {
          const response = await fetch(
            event.request
          );

          if (
            response.ok
          ) {
            const cache =
              await caches.open(CACHE);

            await cache.put(
              event.request,
              response.clone()
            );
          }

          return response;

        } catch {
          return (
            (await caches.match(
              event.request
            )) ||

            (
              event.request.mode ===
              'navigate'
                ? await caches.match('/')
                : undefined
            ) ||

            Response.error()
          );
        }
      })()
    );
  }
);
