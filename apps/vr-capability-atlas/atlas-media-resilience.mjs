import { CONCEPT_CATALOG } from './atlas-concepts.mjs';
import { resolveStephanosBackendClientBaseUrl } from '../../shared/runtime/backendClient.mjs';

const MEDIA_SCHEMA = 'stephanos.vr-atlas-media-resilience.v1';
const VERIFIED_MEDIA_SOURCE = 'verified-content-addressed-cache';
const PROBE_TIMEOUT_MS = 1500;
const conceptsById = new Map(CONCEPT_CATALOG.map((concept) => [concept.id, concept]));
const bundledUrls = new Map();
const bundledPromises = new Map();

export function chooseAtlasMediaTransport({ ok = false, source = '' } = {}) {
  return ok && String(source || '').toLowerCase() === VERIFIED_MEDIA_SOURCE
    ? 'fabric'
    : 'bundled';
}

function safeOrigin(value = '') {
  return String(value || '').trim().replace(/\/$/, '');
}

function mediaApiUrl(origin, conceptId, variant) {
  return `${safeOrigin(origin)}/api/media/vr-atlas/${encodeURIComponent(conceptId)}/${variant}`;
}

async function resolveBundledAsset(concept, variant) {
  const path = concept?.assets?.[variant];
  if (!path) return '';
  const key = `${concept.id}:${variant}`;
  if (bundledUrls.has(key)) return bundledUrls.get(key);
  if (bundledPromises.has(key)) return bundledPromises.get(key);

  const promise = (async () => {
    const assetUrl = new URL(path, import.meta.url);
    const response = await fetch(assetUrl, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${assetUrl.pathname}`);
    const encoded = (await response.text()).replace(/\s+/g, '');
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/avif' }));
    bundledUrls.set(key, objectUrl);
    return objectUrl;
  })().catch((error) => {
    console.warn('VR Atlas bundled artwork unavailable', concept?.id, variant, error);
    return '';
  }).finally(() => bundledPromises.delete(key));

  bundledPromises.set(key, promise);
  return promise;
}

async function probeMediaRuntime() {
  const frontendOrigin = String(globalThis.location?.origin || '');
  const origin = safeOrigin(resolveStephanosBackendClientBaseUrl({ frontendOrigin }));
  const sample = CONCEPT_CATALOG[0];
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = globalThis.setTimeout?.(() => controller?.abort(), PROBE_TIMEOUT_MS);

  try {
    if (!origin || !sample) throw new Error('media-origin-unavailable');
    const response = await fetch(mediaApiUrl(origin, sample.id, 'thumb'), {
      cache: 'no-store',
      signal: controller?.signal,
    });
    const source = response.headers.get('X-Stephanos-Media-Source') || '';
    return {
      mode: chooseAtlasMediaTransport({ ok: response.ok, source }),
      origin,
      source,
      status: response.status,
    };
  } catch (error) {
    return {
      mode: 'bundled',
      origin,
      source: '',
      status: 0,
      reason: error?.name === 'AbortError' ? 'probe-timeout' : (error?.message || 'probe-failed'),
    };
  } finally {
    if (timeoutId) globalThis.clearTimeout?.(timeoutId);
  }
}

function setPictureFabricSources(img, concept, origin) {
  const picture = img.closest('picture[data-media-asset]');
  const thumb = mediaApiUrl(origin, concept.id, 'thumb');
  const panel = mediaApiUrl(origin, concept.id, 'panel');
  const hero = mediaApiUrl(origin, concept.id, 'hero');
  if (picture) {
    const sources = [...picture.querySelectorAll('source')];
    if (sources[0]) sources[0].srcset = hero;
    if (sources[1]) sources[1].srcset = `${panel} 1x, ${hero} 2x`;
    img.src = panel;
    img.srcset = `${thumb} 640w, ${panel} 1920w, ${hero} 3840w`;
  } else {
    img.removeAttribute('srcset');
    img.src = thumb;
  }
}

async function setPictureBundledSources(img, concept) {
  const picture = img.closest('picture[data-media-asset]');
  if (!picture) {
    const thumb = await resolveBundledAsset(concept, 'thumb');
    if (!thumb) return false;
    img.removeAttribute('srcset');
    img.src = thumb;
    return true;
  }

  const [thumb, panel, hero] = await Promise.all([
    resolveBundledAsset(concept, 'thumb'),
    resolveBundledAsset(concept, 'panel'),
    resolveBundledAsset(concept, 'hero'),
  ]);
  if (!panel) return false;

  const sources = [...picture.querySelectorAll('source')];
  if (sources[0]) sources[0].srcset = hero || panel;
  if (sources[1]) sources[1].srcset = hero ? `${panel} 1x, ${hero} 2x` : panel;
  img.src = panel;
  img.srcset = [
    thumb ? `${thumb} 640w` : '',
    `${panel} 1920w`,
    hero ? `${hero} 3840w` : '',
  ].filter(Boolean).join(', ');
  return true;
}

function markUnavailable(img) {
  img.removeAttribute('srcset');
  img.removeAttribute('src');
  img.dataset.mediaResolved = 'true';
  img.dataset.mediaTransport = 'unavailable';
  img.style.display = 'none';
}

function conceptIdForImage(img) {
  return String(
    img?.dataset?.mediaAsset
    || img?.closest?.('picture[data-media-asset]')?.dataset?.mediaAsset
    || '',
  ).toLowerCase();
}

function installBrowserResilience() {
  const diagnostics = {
    schemaVersion: MEDIA_SCHEMA,
    mode: 'probing',
    mediaOrigin: '',
    source: '',
    status: 0,
    reason: '',
  };
  globalThis.__STEPHANOS_VR_ATLAS_MEDIA_RESILIENCE__ = diagnostics;

  const style = document.createElement('style');
  style.textContent = `
    img[data-media-asset]:not([data-media-resolved="true"]),
    picture[data-media-asset] img:not([data-media-resolved="true"]) { visibility: hidden; }
  `;
  document.head.append(style);

  const transportPromise = probeMediaRuntime().then((runtime) => {
    diagnostics.mode = runtime.mode;
    diagnostics.mediaOrigin = runtime.origin || '';
    diagnostics.source = runtime.source || '';
    diagnostics.status = runtime.status || 0;
    diagnostics.reason = runtime.reason || '';
    return runtime;
  });

  async function repairImage(img) {
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.mediaResolved === 'true') return;
    const concept = conceptsById.get(conceptIdForImage(img));
    if (!concept) return;
    img.dataset.mediaResolved = 'pending';

    const runtime = await transportPromise;
    let ok = false;
    try {
      if (runtime.mode === 'fabric' && runtime.origin) {
        setPictureFabricSources(img, concept, runtime.origin);
        ok = true;
      } else {
        ok = await setPictureBundledSources(img, concept);
      }
    } catch (error) {
      console.warn('VR Atlas media repair failed', concept.id, error);
    }

    if (!ok) {
      markUnavailable(img);
      return;
    }
    img.dataset.mediaResolved = 'true';
    img.dataset.mediaTransport = runtime.mode;
  }

  function scan(root) {
    if (!root) return;
    if (root instanceof HTMLImageElement) repairImage(root);
    if (typeof root.querySelectorAll === 'function') {
      root.querySelectorAll('img[data-media-asset], picture[data-media-asset] img').forEach(repairImage);
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(scan);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  installBrowserResilience();
}
