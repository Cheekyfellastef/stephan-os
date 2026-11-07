const CACHE_NAME = 'stephanos-spatial-workspace-v1-console-view-v3';
const CORE_ASSETS = [
  './',
  './quest-entry.html',
  './holodeck-baseline-v0.mjs',
  './holodeck-room-v1.mjs',
  './holodeck-screen-v1.mjs',
  './holodeck-window-client-v1.mjs',
  './holodeck-screen-input-v1.mjs',
  './holodeck-display-renderer-v1.mjs',
  './holodeck-locomotion-v1.mjs',
  './holodeck-layout-v1.mjs',
  './holodeck-comfort-v1.mjs',
  './holodeck-collision-v1.mjs',
  './holodeck-cube-physics-v1.mjs',
  './holodeck-cube-interaction-v1.mjs',
  './holodeck-cube-scene-v1.mjs',
  './holodeck-cube-store-v1.mjs',
  './spatial-telemetry-client.mjs',
  './index.html',
  './bridge-state.v0.json',
  './manifest.webmanifest',
  './offline.html',
  '../../shared/runtime/commandDeckReturnControls.mjs',
  '../../shared/runtime/commandDeckReturnButton.mjs',
  '../../shared/runtime/commandDeckDestination.mjs',
  '../../shared/runtime/backendClient.mjs',
  '../../shared/runtime/stephanosHomeNode.mjs',
  '../../shared/vr/spatialWorkspaceTelemetryContractV1.mjs'
];
const GENERATED_PACKAGING_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(CORE_ASSETS);
        await Promise.all(GENERATED_PACKAGING_ASSETS.map((asset) => cache.add(asset).catch(() => null)));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        return cached || caches.match('./offline.html');
      })
  );
});
