const CACHE_NAME = 'stephanos-spatial-workspace-v1-carry-walk-v6';
const CACHE_PREFIX = 'stephanos-spatial-workspace-v1-';
const CORE_ASSETS = [
  './',
  './quest-entry.html',
  './holodeck-baseline-v0.mjs',
  './holodeck-room-v1.mjs',
  './holodeck-screen-v1.mjs',
  './holodeck-keycaps-v1.mjs',
  './holodeck-window-client-v1.mjs',
  './holodeck-screen-input-v1.mjs',
  './holodeck-furniture-v1.mjs',
  './holodeck-audio-v1.mjs',
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
// Limit caching to audited public shell files. Same-origin app and private
// desktop/window routes must never become offline captures.
const STATIC_PATHS=new Set([...CORE_ASSETS,...GENERATED_PACKAGING_ASSETS]
  .map(asset=>new URL(asset,self.location.href).pathname));

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
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.cache === 'no-store'
    || event.request.headers?.has?.('authorization')) return;
  const url=new URL(event.request.url);
  if (url.origin!==self.location.origin || url.search || !STATIC_PATHS.has(url.pathname)) return;
  event.respondWith(fetch(event.request)
    .then(response=>{
      const policy=response?.headers?.get?.('cache-control')??'';
      if(response?.ok&&response.status===200&&response.type!=='opaque'
        &&!/\b(?:private|no-store)\b/i.test(policy)){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
      }
      return response;
    })
    .catch(async()=>{
      const cache=await caches.open(CACHE_NAME);
      return await cache.match(event.request)??await cache.match('./offline.html')??Response.error();
    }));
});
