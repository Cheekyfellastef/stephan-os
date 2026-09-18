import {
  chooseSelectedConceptId,
  CONCEPT_CATALOG,
  CONCEPT_LIMIT,
  rankConcepts,
} from './atlas-concepts.mjs';

const outcomes = [
  ['🪐','Starfield VR cockpit → living starship','Stereo, head tracking, HUD and ship interaction can grow toward embodiment, hands, crew behaviour and spatial systems.','Mutar/OpenXR + Skyrim parity + Starfield authoring'],
  ['🫴','Embodied hands and physical weapons','A transport-neutral pose contract separates Quest/OpenXR tracking from title-specific skeleton adapters.','Universal Hands + Cyberpunk + Skyrim parity'],
  ['🎬','Comfortable dialogue and cinematics','Immersive conversation, focused framing and room-fixed 3D theatre can be selected according to camera ownership.','Halo theatre + adaptive presentation'],
  ['🧬','Convert resistant flat games','Escalate through framework, title adapter, reconstructed stereo, spatial screen or lawful independent recreation.','Route planner + UEVR/vorpX + reconstruction'],
  ['🛸','Stephanos Spatial Bridge','A seated Quest 3 command bridge over the same canonical Stephanos brain with mission state preserved outside the headset.','Single-brain doctrine + Battle Bridge'],
  ['🧰','Reusable VR conversion factory','Every experiment should leave adapters, tests, provenance and acceptance evidence so later titles start further ahead.','Capability Graph + Method Library'],
];
const fallbackSources = [
  ['Halo MCC VR','rendering','Open-source reference','Multi-title runtime patterns and room-fixed 3D cutscene theatre.','cutscene theatre'],
  ['OpenXR SDK Source','runtime','Authoritative implementation','Loader, API-layer and sample implementation behaviour.','runtime plumbing'],
  ['Skyrim VR ecosystem','interaction','Native parity benchmark','Body, holsters, grabbing and character response decomposed into capabilities.','embodiment parity'],
  ['Meta Quest Link / Air Link','delivery','Primary Quest 3 transport','Wireless PCVR delivery with layered failure attribution.','Quest 3 delivery'],
  ['Starfield + Creation Kit','tooling','Authoritative title evidence','Authoring and runtime attachment points for Starfield-specific systems.','integration seams'],
  ['Paradise Decay / creator evidence','field','Field evidence','Headset-use evidence for usability, setup, comfort and performance questions.','acceptance clues'],
];
const fallbackMethods = [
  ['Capability Route Planner','active','Choose native, framework, title-adapter, reconstructed-stereo, spatial-screen or recreation routes from evidence.'],
  ['Skyrim VR Parity Decomposition','active','Translate body, holsters, interaction and character response into reusable attachment points and tests.'],
  ['Room-fixed 3D Cutscene Theatre','reference-proven','Preserve authored cinematic framing on a room-fixed stereo screen while retaining 6DoF head tracking.'],
  ['Transport-neutral Hand Pose Contract','active','Separate tracking producers from title-specific skeleton adapters using a bounded pose contract and calibration.'],
  ['Starfield Mutar OpenXR Baseline','proof-pending','Bind exact Starfield/provider identity to Meta OpenXR and Quest 3 Air Link proof.'],
  ['Adaptive Dialogue Presentation','design-active','Choose immersive dialogue, focused conversation or theatre based on camera ownership and intent.'],
];

let sources = [...fallbackSources];
let methods = [...fallbackMethods];
let workspace = null;
let active = 'all';
let rankedConcepts = [];
let selectedConceptId = '';
let selectionPinnedByUser = false;
let mediaManifest = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const sourceCount = $('#sourceCount');
const techniqueCount = $('#techniqueCount');
const targetCount = $('#targetCount');
const researchTitle = $('#researchTitle');
const badge = $('#badge');
const liveMeta = $('#liveMeta');
const search = $('#search');
const refresh = $('#refresh');
const lightbox = $('#conceptLightbox');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');

function mediaUrl(concept, variant) {
  return `/api/media/vr-atlas/${encodeURIComponent(concept.id)}/${variant}`;
}

function mediaPicture(concept, { lightboxMode = false } = {}) {
  const thumb = mediaUrl(concept, 'thumb');
  const panel = mediaUrl(concept, 'panel');
  const hero = mediaUrl(concept, 'hero');
  const sizes = lightboxMode
    ? '100vw'
    : '(min-width: 1840px) 1796px, (min-width: 900px) calc(100vw - 44px), calc(100vw - 28px)';
  return `<picture data-media-asset="${esc(concept.id)}" data-media-fabric="v1">
    <source media="(min-width:1800px)" srcset="${hero}">
    <source media="(min-width:900px)" srcset="${panel} 1x, ${hero} 2x">
    <img src="${panel}" srcset="${thumb} 640w, ${panel} 1920w, ${hero} 3840w" sizes="${sizes}" width="3840" height="2160" alt="${esc(concept.alt)}" decoding="async" fetchpriority="high" data-media-role="featured">
  </picture>`;
}

$('#outcomes').innerHTML = outcomes.map((item) => `<article class="card"><div class="icon">${item[0]}</div><h3>${esc(item[1])}</h3><p>${esc(item[2])}</p><div class="unlock"><b>UNLOCKED BY</b><br>${esc(item[3])}</div></article>`).join('');

function switchView(view) {
  $$('.viewpage').forEach((page) => page.classList.toggle('active', page.id === `view-${view}`));
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'concepts') renderConcepts();
  window.scrollTo({ top: $('.viewbar').offsetTop - 62, behavior: 'smooth' });
}
$$('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));

function renderSources() {
  const query = search.value.toLowerCase().trim();
  const rows = sources.filter((source) => (active === 'all' || source[1] === active) && (!query || source.join(' ').toLowerCase().includes(query)));
  $('#sources').innerHTML = rows.map((source) => `<article class="card source"><div class="type">${esc(source[2])}</div><h3>${esc(source[0])}</h3><p>${esc(source[3])}</p><div class="small">↳ ${esc(source[4])}</div></article>`).join('');
}
function renderMethods() {
  $('#methodsGrid').innerHTML = methods.map((method) => `<article class="card method"><span class="status ${esc(method[1])}">${esc(method[1])}</span><div><h3>${esc(method[0])}</h3><p>${esc(method[2])}</p></div></article>`).join('');
}
function techniqueWeight(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'active' || value === 'reference-proven') return 3;
  if (value === 'proof-pending' || value === 'design-active') return 2;
  return 1;
}
function researchItems() {
  const targets = Array.isArray(workspace?.targets) ? workspace.targets.map((target) => ({ name: target.name || target.title || target.id || 'Mission target', text: JSON.stringify(target), weight: 2 })) : [];
  const techniqueItems = methods.map((method) => ({ name: method[0], text: method.join(' '), weight: techniqueWeight(method[1]) }));
  const sourceItems = sources.map((source) => ({ name: source[0], text: source.join(' '), weight: 1 }));
  return [...techniqueItems, ...targets, ...sourceItems];
}

function currentConcept() {
  return rankedConcepts.find((concept) => concept.id === selectedConceptId) || rankedConcepts[0];
}
function supportCopy(concept) {
  return concept.hits.length ? concept.hits.map(esc).join(' · ') : 'No strong canonical match yet — retained as a bounded future direction.';
}
function renderConcepts() {
  const selected = currentConcept();
  if (!selected) return;
  const mediaMode = mediaManifest?.sharpFallback === 'vector-native' ? 'Media Fabric V1 · verified cache or vector-sharp fallback' : 'Media Fabric V1';
  $('#conceptMeta').textContent = `${rankedConcepts.length} views ranked against ${sources.length} canonical sources, ${methods.length} techniques${Array.isArray(workspace?.targets) ? ` and ${workspace.targets.length} mission targets` : ''}. ${selectionPinnedByUser ? 'Your selected scene is preserved.' : 'The strongest current match is selected.'} ${mediaMode}.`;
  $('#conceptStage').innerHTML = `<article class="concept-feature"><button id="conceptHeroButton" class="concept-feature-media" type="button" aria-label="Open ${esc(selected.title)} in a lightbox">${mediaPicture(selected)}<span class="hero-shade"></span><span class="truth-ribbon">CONCEPT PROJECTION / NOT RUNTIME PROOF</span><span class="rank-pill">LIVE RANK #${selected.rank} · RESEARCH FIT ${selected.fit}%</span><span class="zoom-hint">Open lightbox ↗</span></button><div class="concept-feature-copy"><div><div class="kicker">Featured research match</div><h3>${esc(selected.title)}</h3><p>${esc(selected.description)}</p></div><div class="concept-evidence"><b>${selected.score ? 'CURRENT CANONICAL SUPPORT' : 'FUTURE DIRECTION'}</b><span>${supportCopy(selected)}</span><div class="concept-tags">${selected.tags.slice(0, 7).map((tag) => `<span class="concept-tag">${esc(tag)}</span>`).join('')}</div></div><div class="feature-actions"><button class="control-button" type="button" data-concept-step="-1" aria-label="Previous concept">← Previous</button><button id="openLightbox" class="control-button primary" type="button">View large</button><button class="control-button" type="button" data-concept-step="1" aria-label="Next concept">Next →</button></div></div></article>`;
  $('#conceptThumbnails').innerHTML = rankedConcepts.map((concept) => `<button class="concept-thumbnail ${concept.id === selected.id ? 'selected' : ''}" type="button" role="listitem" data-concept-id="${concept.id}" aria-pressed="${concept.id === selected.id}" aria-label="Show ${esc(concept.title)}"><span class="thumbnail-media"><img src="${mediaUrl(concept, 'thumb')}" width="640" height="360" loading="lazy" decoding="async" alt="" data-media-role="thumbnail" data-media-asset="${esc(concept.id)}"><span class="thumbnail-rank">#${concept.rank}</span></span><span class="thumbnail-copy"><b>${esc(concept.title)}</b><small>${concept.fit}% research fit</small></span></button>`).join('');
  $$('[data-concept-id]').forEach((button) => button.addEventListener('click', () => selectConcept(button.dataset.conceptId, true)));
  $$('[data-concept-step]').forEach((button) => button.addEventListener('click', () => navigateConcept(Number(button.dataset.conceptStep))));
  $('#conceptHeroButton').addEventListener('click', openLightbox);
  $('#openLightbox').addEventListener('click', openLightbox);
}
function rerankConcepts() {
  rankedConcepts = rankConcepts(CONCEPT_CATALOG, researchItems(), CONCEPT_LIMIT);
  const previous = selectedConceptId;
  selectedConceptId = chooseSelectedConceptId(rankedConcepts, previous, selectionPinnedByUser);
  if (previous && previous !== selectedConceptId && !rankedConcepts.some((concept) => concept.id === previous)) selectionPinnedByUser = false;
  renderConcepts();
}
function selectConcept(id, pin = true) {
  if (!rankedConcepts.some((concept) => concept.id === id)) return;
  selectedConceptId = id;
  selectionPinnedByUser = pin;
  renderConcepts();
  if (lightbox.open) populateLightbox();
}
function navigateConcept(direction) {
  const index = Math.max(0, rankedConcepts.findIndex((concept) => concept.id === selectedConceptId));
  const next = (index + direction + rankedConcepts.length) % rankedConcepts.length;
  selectConcept(rankedConcepts[next].id, true);
}
function populateLightbox() {
  const selected = currentConcept();
  if (!selected) return;
  $('#lightboxMedia').innerHTML = mediaPicture(selected, { lightboxMode: true });
  $('#lightboxTitle').textContent = selected.title;
}
function openLightbox() {
  populateLightbox();
  if (!lightbox.open) lightbox.showModal();
}

$('#closeLightbox').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.close(); });
$('#enterFullscreen').addEventListener('click', async () => {
  if (document.fullscreenElement) { await document.exitFullscreen(); return; }
  if (lightbox.requestFullscreen) await lightbox.requestFullscreen();
});
document.addEventListener('fullscreenchange', () => { $('#enterFullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Enter full screen'; });
document.addEventListener('keydown', (event) => {
  const conceptView = $('#view-concepts').classList.contains('active');
  if (!conceptView || event.target.closest('input,textarea,select')) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); navigateConcept(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); navigateConcept(1); }
  if (event.key === 'Escape' && lightbox.open) lightbox.close();
});

function setState(mode, text) {
  badge.className = `badge ${mode}`;
  badge.innerHTML = `<span class="dot"></span>${mode === 'live' ? 'LIVE · canonical research' : mode === 'pending' ? 'CONNECTING · verifying' : 'SNAPSHOT · live unavailable'}`;
  liveMeta.textContent = text || '';
}
function renderSnapshot() {
  workspace = null;
  sources = [...fallbackSources];
  methods = [...fallbackMethods];
  sourceCount.textContent = sources.length;
  techniqueCount.textContent = methods.length;
  targetCount.textContent = 'snapshot';
  researchTitle.textContent = 'Embedded VR research snapshot';
  renderSources();
  renderMethods();
  rerankConcepts();
}

const paths = {
  workspace: ['../../VR-Research-Lab/lab-workspace.json', 'https://raw.githubusercontent.com/Cheekyfellastef/stephan-os/main/VR-Research-Lab/lab-workspace.json'],
  registry: ['../../VR-Research-Lab/knowledge-sources.json', 'https://raw.githubusercontent.com/Cheekyfellastef/stephan-os/main/VR-Research-Lab/knowledge-sources.json'],
};
async function firstJson(urls) {
  let last;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { data: await response.json(), url };
    } catch (error) { last = error; }
  }
  throw last || new Error('unavailable');
}
function category(source) {
  const text = norm(`${source.source_id} ${source.title}`);
  if (/hand|skyrim|vrik|higgs|planck/.test(text)) return 'interaction';
  if (/virtual desktop|air link|quest link|meta quest/.test(text)) return 'delivery';
  if (/creator|voodoo|paradise|beardo|headset/.test(text)) return 'field';
  if (/installer|creation kit|rai pal|deluxe/.test(text)) return 'tooling';
  if (/openxr sdk|openxr spec|reframework/.test(text)) return 'runtime';
  return 'rendering';
}
function sourceRow(source) {
  return [source.title || source.source_id, category(source), String(source.status || source.priority || 'registered').replaceAll('-', ' '), String(source.promotion_rule || 'Canonical evidence retained with provenance and reuse boundaries.').slice(0, 190), [`licence: ${source.licence || 'tracked'}`, source.snapshot_version || source.snapshot_release || source.snapshot_date || source.snapshot_commit?.slice(0, 8)].filter(Boolean).join(' · ')];
}
async function hydrateMediaManifest() {
  try {
    const response = await fetch('/api/media/vr-atlas/manifest', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.schemaVersion !== 'stephanos.media-asset-fabric.v1' || Number(data?.assetCount) !== 10) throw new Error('manifest-invalid');
    mediaManifest = data;
  } catch {
    mediaManifest = null;
  }
}
async function hydrate() {
  setState('pending', 'Refreshing canonical VR research and Media Asset Fabric…');
  await hydrateMediaManifest();
  try {
    const [workspaceResult, registryResult] = await Promise.all([firstJson(paths.workspace), firstJson(paths.registry)]);
    if (!Array.isArray(registryResult.data.sources) || !registryResult.data.sources.length) throw new Error('empty source registry');
    if (!Array.isArray(workspaceResult.data.techniques) || !workspaceResult.data.techniques.length) throw new Error('empty technique set');
    workspace = workspaceResult.data;
    sources = registryResult.data.sources.map(sourceRow);
    methods = workspaceResult.data.techniques.map((technique) => [technique.name, technique.status || 'active', technique.goal || 'Reusable VR method']);
    sourceCount.textContent = sources.length;
    techniqueCount.textContent = methods.length;
    targetCount.textContent = Array.isArray(workspace.targets) ? workspace.targets.length : '—';
    researchTitle.textContent = `The ${sources.length}-source live VR stack`;
    renderSources();
    renderMethods();
    rerankConcepts();
    const local = workspaceResult.url.startsWith('..') && registryResult.url.startsWith('..');
    const stamp = workspace.updatedAt ? new Date(workspace.updatedAt).toLocaleString() : 'current';
    const mediaState = mediaManifest ? 'Media Fabric V1 sharp path' : 'media manifest unproven';
    setState('live', `${local ? 'Battle Bridge / repo-local' : 'GitHub main'} · workspace ${stamp} · ${mediaState} · auto-refresh 60s`);
  } catch (error) {
    renderSnapshot();
    setState('snapshot', `Embedded snapshot in use · ${error.message || 'live fetch failed'} · ${mediaManifest ? 'Media Fabric V1 available' : 'media fabric unavailable'}`);
  }
}

search.addEventListener('input', renderSources);
$$('.filter').forEach((button) => button.addEventListener('click', () => {
  $$('.filter').forEach((candidate) => candidate.classList.remove('active'));
  button.classList.add('active');
  active = button.dataset.filter;
  renderSources();
}));
refresh.addEventListener('click', hydrate);

renderSnapshot();
hydrate();
setInterval(hydrate, 60_000);
