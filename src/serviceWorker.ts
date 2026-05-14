/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'irs-helper-v18';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/app-icon.svg',
  '/service-worker.js',
  '/assets/pdf.worker.js',
];

// Files matching these patterns will be cached
const CACHE_PATTERNS = [
  /\.js$/,
  /\.mjs$/,
  /\.css$/,
  /\.json$/,
  /\.svg$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  // PDF.js worker files
  /pdf\.worker(?:\.min)?\.(?:js|mjs)$/,
];

// Install event - cache essential assets
self.addEventListener('install', (event: ExtendedEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE).catch((err) => {
        console.warn('Failed to cache essential assets:', err);
      });
    }).then(() => {
      self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: ExtendedEvent) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extensions and other non-http(s) protocols
  if (!request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    (caches.match(request) as Promise<Response | undefined>).then((response) => {
      if (response) {
        return response;
      }

      return fetch(request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Check if URL matches cacheable patterns
        const url = new URL(request.url);
        const shouldCache = CACHE_PATTERNS.some((pattern) =>
          pattern.test(url.pathname)
        );

        if (shouldCache) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache).catch((err) => {
              console.warn('Failed to cache:', request.url, err);
            });
          });
        }

        return response;
      }).catch(() => {
        // Return a fallback response when offline
        // For now, return the cached index.html as fallback for navigation requests
        if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
          return (caches.match('/index.html') as Promise<Response | undefined>).then(
            (response) => response || new Response('Offline - Application cache not available', {
              status: 503,
              statusText: 'Service Unavailable',
            })
          );
        }

        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      });
    })
  );
});

// Type definitions
interface ExtendedEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends Event {
  request: Request;
  respondWith(promise: Promise<Response>): void;
}
