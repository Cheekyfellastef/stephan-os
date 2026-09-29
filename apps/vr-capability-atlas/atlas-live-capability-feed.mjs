import { requestStephanosBackend } from '../../shared/runtime/backendClient.mjs';
import { CONCEPT_CATALOG, mergeLiveConcepts } from './atlas-concepts.mjs';
import { buildCurrentCapabilitySvg } from './atlas-capability-delta.mjs';
import { capabilityReadinessForConcept, capabilityReadinessSummary } from './capability-readiness-core.mjs';

const FEED_PATH = '/api/shared-workspace/vr-capability-feed';
const FEED_SCHEMA = 'stephanos.vr-capability-live-feed.v1';
const POLL_MS = 60_000;

let feed = null;
let lastConceptSignature = '';
let refreshPromise = null;
let decorateQueued = false;

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function conceptMap() {
  return new Map(CONCEPT_CATALOG.map((concept) => [concept.id, concept]));
}

function selectedConceptId() {
  return String(document.querySelector('#conceptHeroButton picture[data-media-asset]')?.dataset?.mediaAsset || document.querySelector('#conceptThumbnails .concept-thumbnail.selected')?.dataset?.conceptId || '');
}

function readiness(id) {
  return capabilityReadinessForConcept(feed?.ledger, id);
}

function currentSvgUrl(concept, result) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildCurrentCapabilitySvg(concept, result))}`;
}

function currentViewUrl(concept, result) {
  return String(result?.visual?.currentViewUrl || '').trim() || currentSvgUrl(concept, result);
}

function buildConceptProjectionSvg(concept = {}) {
  const title = xml(String(concept.title || concept.id || 'VR concept').slice(0, 42));
  const description = xml(String(concept.description || 'Emerging Stephanos VR concept.').slice(0, 95));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="Concept projection for ${title}">
    <defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07182f"/><stop offset=".55" stop-color="#151339"/><stop offset="1" stop-color="#090a18"/></linearGradient><radialGradient id="g"><stop stop-color="#69f0ff" stop-opacity=".3"/><stop offset="1" stop-color="#69f0ff" stop-opacity="0"/></radialGradient></defs>
    <rect width="1280" height="720" fill="url(#b)"/><circle cx="925" cy="245" r="280" fill="url(#g)"/><path d="M110 555 Q350 240 610 420 T1170 300" fill="none" stroke="#86dfff" stroke-opacity=".58" stroke-width="5"/><path d="M160 600 H1120 M220 520 H1040 M310 440 H960" stroke="#a796ff" stroke-opacity=".22" stroke-width="2"/><circle cx="650" cy="365" r="110" fill="none" stroke="#8deaff" stroke-opacity=".72" stroke-width="4"/><circle cx="650" cy="365" r="48" fill="#8deaff" fill-opacity=".14" stroke="#8deaff" stroke-opacity=".82" stroke-width="3"/>
    <text x="70" y="82" fill="#88eaff" font-family="system-ui,Segoe UI,sans-serif" font-size="18" font-weight="700" letter-spacing="2">LIVE CONCEPT HORIZON</text>
    <text x="70" y="620" fill="#f5f7ff" font-family="system-ui,Segoe UI,sans-serif" font-size="40" font-weight="800">${title}</text>
    <text x="70" y="660" fill="#b8c4d8" font-family="system-ui,Segoe UI,sans-serif" font-size="20">${description}</text>
  </svg>`;
}

function conceptViewUrl(concept) {
  const explicit = String(concept?.visual?.conceptViewUrl || '').trim();
  if (explicit) return explicit;
  if (concept?.dynamic) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildConceptProjectionSvg(concept))}`;
  return '';
}

function ensureStyles() {
  if (document.getElementById('atlas-live-capability-styles')) return;
  const style = document.createElement('style');
  style.id = 'atlas-live-capability-styles';
  style.textContent = `.atlas-live-concept-hero{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:3}.capability-live-source{display:inline-flex;margin-left:.35rem;padding:.08rem .38rem;border-radius:999px;border:1px solid rgba(94,228,255,.32);font-size:.62rem;letter-spacing:.06em;color:#aeefff}`;
  document.head.append(style);
}

function syncLiveConcepts() {
  const concepts = Array.isArray(feed?.concepts) ? feed.concepts : [];
  const signature = JSON.stringify(concepts.map((concept) => [concept.id, concept.title, concept.description, concept.tags, concept.visual]));
  if (signature === lastConceptSignature) return false;
  lastConceptSignature = signature;
  const changed = mergeLiveConcepts(concepts);
  if (changed) {
    queueMicrotask(() => document.getElementById('refresh')?.click());
  }
  return changed;
}

function decorateTopRow(map) {
  document.querySelectorAll('#conceptThumbnails .concept-thumbnail[data-concept-id]').forEach((button) => {
    const id = button.dataset.conceptId;
    const concept = map.get(id) || { id, title: id };
    const result = readiness(id);
    const small = button.querySelector('.thumbnail-copy small');
    if (small) {
      const research = small.dataset.researchLabel || small.textContent.match(/\d+% research fit/i)?.[0] || small.textContent.split('·')[0].trim();
      small.dataset.researchLabel = research;
      small.textContent = `${research} · ${result.available ? `${result.percent}% capability` : '— capability'}`;
      small.title = capabilityReadinessSummary(result);
    }
    const title = button.querySelector('.thumbnail-copy b');
    if (title) title.textContent = concept.title || id;
    const override = conceptViewUrl(concept);
    const image = button.querySelector('.thumbnail-media img');
    if (image && override) {
      image.src = override;
      image.removeAttribute('srcset');
      image.dataset.liveConceptOverride = 'true';
    }
  });
}

function decorateCurrentRow(map) {
  document.querySelectorAll('#currentCapabilityThumbnails [data-current-concept-id]').forEach((button) => {
    const id = button.dataset.currentConceptId;
    const concept = map.get(id) || { id, title: id };
    const result = readiness(id);
    const image = button.querySelector('.thumbnail-media img');
    if (image) image.src = currentViewUrl(concept, result);
    const title = button.querySelector('.thumbnail-copy b');
    if (title) title.textContent = concept.title || id;
    const small = button.querySelector('.thumbnail-copy small');
    if (small) {
      const source = result.visual?.currentViewUrl ? ` · ${result.visual.currentViewSource || 'observed workspace'}` : '';
      small.textContent = `${result.available ? `${result.percent}% capability` : '— capability'} · ${result.visual?.truthLabel || 'evidence-gated'}${source}`;
      small.title = capabilityReadinessSummary(result);
    }
  });
  const span = document.querySelector('.capability-current-section .thumbnail-heading > span');
  if (span) span.textContent = `${document.querySelectorAll('#conceptThumbnails [data-concept-id]').length} concepts · live evidence + spatial-workspace captures when proven`;
}

function decorateHero(map) {
  const feature = document.getElementById('conceptHeroButton');
  if (!feature) return;
  const id = selectedConceptId();
  const concept = map.get(id);
  if (!concept) return;
  const result = readiness(id);
  const mode = document.querySelector('#conceptStage [data-capability-mode].active')?.dataset?.capabilityMode || 'concept';
  const rank = document.querySelector('#conceptStage .rank-pill');
  if (rank) {
    const research = rank.dataset.researchLabel || rank.textContent.replace(/\s*·\s*CAPABILITY\s+(?:\d+%|—).*$/i, '').trim();
    rank.dataset.researchLabel = research;
    rank.textContent = `${research} · CAPABILITY ${result.available ? `${result.percent}%` : '—'}`;
  }

  feature.querySelectorAll('.atlas-live-concept-hero').forEach((node) => node.remove());
  const conceptOverride = conceptViewUrl(concept);
  if (mode === 'concept' && conceptOverride) {
    const image = document.createElement('img');
    image.className = 'atlas-live-concept-hero';
    image.src = conceptOverride;
    image.alt = `Live concept projection for ${concept.title}`;
    feature.append(image);
  }

  if (mode === 'current') {
    let image = feature.querySelector('.capability-current-hero');
    if (!image) {
      image = document.createElement('img');
      image.className = 'capability-current-hero';
      feature.append(image);
    }
    image.src = currentViewUrl(concept, result);
    image.alt = result.visual?.currentViewUrl ? `Observed current capability view for ${concept.title}` : `Current capability projection for ${concept.title}`;
  }

  if (mode === 'delta') {
    let wrap = feature.querySelector('.capability-delta-wrap');
    const missing = result.gates.filter((gate) => !gate.proven).map((gate) => gate.label);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'capability-delta-wrap';
      wrap.innerHTML = `<img class="capability-delta-left" alt=""><span class="capability-delta-divider"></span><span class="capability-delta-label current"></span><span class="capability-delta-label concept">CONCEPT</span><div class="capability-delta-summary"></div>`;
      feature.append(wrap);
    }
    const image = wrap.querySelector('.capability-delta-left');
    if (image) image.src = currentViewUrl(concept, result);
    const currentLabel = wrap.querySelector('.capability-delta-label.current');
    if (currentLabel) currentLabel.textContent = `CURRENT · ${result.available ? `${result.percent}%` : '—'}`;
    const summary = wrap.querySelector('.capability-delta-summary');
    if (summary) summary.innerHTML = `<strong>Capability delta:</strong> ${xml(result.visual?.deltaSummary || capabilityReadinessSummary(result))}<br><strong>Still missing:</strong> ${xml(missing.length ? missing.join(' · ') : 'no proof gates')}<br><strong>Visual source:</strong> ${xml(result.visual?.currentViewUrl ? result.visual.currentViewSource || 'observed workspace evidence' : 'evidence-gated projection')}`;
  }

  const detail = document.querySelector('#conceptStage .capability-mode-detail');
  if (detail && result.visual?.currentViewUrl && mode !== 'concept') {
    detail.textContent = `${detail.textContent.replace(/\s*·\s*visual source:.*$/i, '')} · visual source: ${result.visual.currentViewSource || 'observed spatial workspace'}`;
  }
}

function decorateMeta() {
  const meta = document.getElementById('conceptMeta');
  if (!meta || !feed) return;
  const suffix = ' Live Shared Workspace proof can promote capability gates automatically. Verified spatial-workspace captures replace generated Current Capability projections as soon as they are published.';
  const base = meta.dataset.liveCapabilityBase || meta.textContent.replace(suffix, '').trim();
  meta.dataset.liveCapabilityBase = base;
  meta.textContent = `${base}${suffix}`;
  meta.title = `Live capability feed: ${feed.state || 'unknown'} · ${feed.evidenceSummary?.acceptedPromotionCount || 0} proof promotions · ${feed.evidenceSummary?.spatialVisualCount || 0} observed visual captures · ${feed.evidenceSummary?.conceptCount || CONCEPT_CATALOG.length} concepts`;
  const topHeading = document.querySelector('#conceptThumbnails')?.previousElementSibling?.querySelector('span');
  if (topHeading) topHeading.textContent = `${document.querySelectorAll('#conceptThumbnails [data-concept-id]').length} responsive concepts · research fit + live capability readiness`;
}

function decorateAll() {
  if (!feed?.ledger) return;
  ensureStyles();
  const map = conceptMap();
  decorateTopRow(map);
  decorateCurrentRow(map);
  decorateHero(map);
  decorateMeta();
}

function queueDecorate() {
  if (decorateQueued) return;
  decorateQueued = true;
  queueMicrotask(() => {
    decorateQueued = false;
    decorateAll();
  });
}

async function refreshLiveFeed() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = requestStephanosBackend({ path: FEED_PATH, timeoutMs: 3500 })
    .then((response) => {
      if (response.json?.schemaVersion !== FEED_SCHEMA || !response.json?.ledger) throw new Error('vr-capability-feed-invalid');
      feed = response.json;
      globalThis.__STEPHANOS_VR_CAPABILITY_LIVE_FEED__ = feed;
      syncLiveConcepts();
      queueDecorate();
    })
    .catch((error) => {
      console.warn('VR Atlas live capability feed unavailable; retaining canonical static fallback', error);
    })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.target?.id === 'conceptStage' || record.target?.id === 'conceptThumbnails' || [...record.addedNodes].some((node) => node?.querySelector?.('#conceptStage,#conceptThumbnails,#currentCapabilityThumbnails,[data-capability-mode]')))) queueDecorate();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-concept-id],[data-current-concept-id],[data-capability-mode]')) queueMicrotask(queueDecorate);
  }, true);
  refreshLiveFeed();
  globalThis.setInterval?.(refreshLiveFeed, POLL_MS);
}
