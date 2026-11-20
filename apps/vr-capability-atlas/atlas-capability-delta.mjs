import { CONCEPT_CATALOG } from './atlas-concepts.mjs';
import {
  capabilityReadinessForConcept,
  capabilityReadinessSummary,
  maturityBandForPercent,
} from './capability-readiness-core.mjs';

const LEDGER_PATHS = [
  '../../VR-Research-Lab/capability-readiness.json',
  'https://raw.githubusercontent.com/Cheekyfellastef/stephan-os/main/VR-Research-Lab/capability-readiness.json',
];

const conceptsById = new Map(CONCEPT_CATALOG.map((concept) => [concept.id, concept]));
let ledger = null;
let ledgerSource = '';
let refreshPromise = null;
let decorateQueued = false;
let heroMode = 'concept';
let lastStripSignature = '';

async function firstJson(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { data: await response.json(), url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('capability-readiness-unavailable');
}

function readiness(conceptId) {
  return capabilityReadinessForConcept(ledger, conceptId);
}

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function shortTitle(value, max = 34) {
  const text = String(value || 'Capability');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function sceneMarkup(id, solid = false) {
  const stroke = solid ? 'rgba(220,246,255,.92)' : 'rgba(180,226,255,.68)';
  const fill = solid ? 'rgba(78,203,255,.18)' : 'none';
  const common = `stroke="${stroke}" stroke-width="4" fill="${fill}" vector-effect="non-scaling-stroke"`;
  switch (id) {
    case 'spatial-bridge':
      return `<path d="M140 430 Q640 90 1140 430" ${common}/><path d="M260 470 L420 300 H860 L1020 470" ${common}/><rect x="470" y="330" width="340" height="125" rx="20" ${common}/><circle cx="640" cy="235" r="54" ${common}/>`;
    case 'embodied-exploration':
      return `<circle cx="640" cy="230" r="58" ${common}/><path d="M640 290 V505 M640 350 L430 455 M640 350 L850 455 M640 505 L500 660 M640 505 L780 660" ${common}/><path d="M382 415 q70 18 92 78 q-92 28-150-22" ${common}/><path d="M898 415 q-70 18-92 78 q92 28 150-22" ${common}/>`;
    case 'immersive-engineering':
      return `<rect x="185" y="160" width="350" height="245" rx="24" ${common}/><rect x="745" y="165" width="350" height="245" rx="24" ${common}/><rect x="460" y="450" width="360" height="205" rx="24" ${common}/><path d="M535 285 H745 M640 405 V450" ${common}/>`;
    case 'spatial-collaboration':
      return `<ellipse cx="640" cy="455" rx="310" ry="125" ${common}/><circle cx="390" cy="245" r="58" ${common}/><circle cx="640" cy="190" r="58" ${common}/><circle cx="890" cy="245" r="58" ${common}/><path d="M420 295 L535 390 M640 248 V330 M860 295 L745 390" ${common}/>`;
    case 'living-starship':
      return `<path d="M120 470 L330 245 H950 L1160 470" ${common}/><path d="M330 245 L430 510 H850 L950 245" ${common}/><circle cx="640" cy="360" r="96" ${common}/><path d="M640 264 V456 M544 360 H736" ${common}/><path d="M220 540 H1060" ${common}/>`;
    case 'physical-interaction':
      return `<rect x="585" y="255" width="250" height="310" rx="32" ${common}/><path d="M360 485 q120-130 250-15 q-40 120-175 150 q-105-15-75-135" ${common}/><circle cx="710" cy="410" r="58" ${common}/>`;
    case 'adaptive-dialogue':
      return `<circle cx="430" cy="310" r="86" ${common}/><circle cx="850" cy="310" r="86" ${common}/><path d="M330 530 q100-110 200 0 M750 530 q100-110 200 0" ${common}/><path d="M515 250 H690 Q735 250 735 295 V355 H585 L535 405 V355 H515 Z" ${common}/>`;
    case 'cinematic-theatre':
      return `<rect x="220" y="145" width="840" height="390" rx="22" ${common}/><path d="M305 620 q65-95 130 0 M510 620 q65-95 130 0 M715 620 q65-95 130 0 M920 620 q65-95 130 0" ${common}/><path d="M640 535 V675" ${common}/>`;
    case 'flat-to-vr-lab':
      return `<rect x="150" y="220" width="330" height="255" rx="20" ${common}/><path d="M520 350 H650 M615 315 L650 350 L615 385" ${common}/><rect x="700" y="180" width="205" height="330" rx="28" ${common}/><rect x="930" y="180" width="205" height="330" rx="28" ${common}/><path d="M805 545 L805 620 M1032 545 L1032 620" ${common}/>`;
    case 'capability-factory':
      return `<circle cx="245" cy="370" r="72" ${common}/><circle cx="505" cy="240" r="72" ${common}/><circle cx="505" cy="500" r="72" ${common}/><circle cx="790" cy="370" r="88" ${common}/><rect x="980" y="285" width="170" height="170" rx="28" ${common}/><path d="M317 350 L430 270 M317 390 L430 470 M577 250 L715 335 M577 490 L715 405 M878 370 H980" ${common}/>`;
    default:
      return `<rect x="240" y="175" width="800" height="420" rx="40" ${common}/><path d="M300 520 L520 320 L680 450 L825 300 L980 520" ${common}/>`;
  }
}

export function buildCurrentCapabilitySvg(concept = {}, result = {}) {
  const available = Boolean(result.available);
  const percent = available ? Number(result.percent) : null;
  const band = maturityBandForPercent(percent);
  const solid = band === 'prototype' || band === 'runtime-like' || band === 'accepted';
  const title = xml(shortTitle(concept.title || concept.id || 'Capability'));
  const label = xml(result.visual?.truthLabel || (available ? band.toUpperCase() : 'EVIDENCE UNAVAILABLE'));
  const pct = available ? `${percent}%` : '—';
  const accent = band === 'accepted' ? '#85ffd4' : band === 'runtime-like' ? '#7be7ff' : band === 'prototype' ? '#8ab4ff' : '#9b8cff';
  const gridOpacity = solid ? '.17' : '.10';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="Current capability view for ${title}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#061328"/><stop offset="1" stop-color="#12091f"/></linearGradient>
      <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="${accent}" stroke-opacity="${gridOpacity}"/></pattern>
      <linearGradient id="meter" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${accent}"/><stop offset="1" stop-color="#69f0ff"/></linearGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)"/><rect width="1280" height="720" fill="url(#grid)"/>
    <rect x="36" y="34" width="1208" height="652" rx="30" fill="none" stroke="${accent}" stroke-opacity=".28" stroke-width="2"/>
    <g opacity="${solid ? '.95' : '.72'}">${sceneMarkup(concept.id, solid)}</g>
    <rect x="64" y="55" width="330" height="38" rx="19" fill="${accent}" fill-opacity=".14" stroke="${accent}" stroke-opacity=".48"/>
    <text x="84" y="81" fill="${accent}" font-family="system-ui,Segoe UI,sans-serif" font-size="18" font-weight="700" letter-spacing="2">CURRENT CAPABILITY PROJECTION</text>
    <text x="64" y="642" fill="#f3f7ff" font-family="system-ui,Segoe UI,sans-serif" font-size="34" font-weight="750">${title}</text>
    <text x="64" y="676" fill="#aebbd0" font-family="system-ui,Segoe UI,sans-serif" font-size="20">${label}</text>
    <text x="1120" y="640" fill="${accent}" text-anchor="end" font-family="system-ui,Segoe UI,sans-serif" font-size="58" font-weight="800">${pct}</text>
    <text x="1120" y="674" fill="#aebbd0" text-anchor="end" font-family="system-ui,Segoe UI,sans-serif" font-size="18">CAPABILITY READINESS</text>
    <rect x="900" y="70" width="220" height="10" rx="5" fill="#ffffff" fill-opacity=".10"/><rect x="900" y="70" width="${available ? Math.max(0, Math.min(220, 2.2 * percent)) : 0}" height="10" rx="5" fill="url(#meter)"/>
  </svg>`;
}

function svgDataUrl(concept, result) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildCurrentCapabilitySvg(concept, result))}`;
}

function selectedConceptId() {
  return String(document.querySelector('#conceptHeroButton picture[data-media-asset]')?.dataset?.mediaAsset || document.querySelector('.concept-thumbnail.selected')?.dataset?.conceptId || '');
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function ensureStyles() {
  if (document.getElementById('capability-delta-styles')) return;
  const style = document.createElement('style');
  style.id = 'capability-delta-styles';
  style.textContent = `
    .capability-current-section{margin-top:2rem;padding-top:1.6rem;border-top:1px solid rgba(150,180,255,.18)}
    .capability-current-section .thumbnail-heading{margin-bottom:1rem}
    .capability-current-thumbnail .thumbnail-media::after{content:'CURRENT';position:absolute;left:10px;bottom:10px;padding:.24rem .45rem;border-radius:999px;background:rgba(4,10,24,.76);border:1px solid rgba(155,140,255,.45);font-size:.62rem;letter-spacing:.12em;color:#d9e4ff}
    .capability-mode-switch{display:flex;gap:.45rem;flex-wrap:wrap;margin:.9rem 0 .6rem}
    .capability-mode-switch button{appearance:none;border:1px solid rgba(150,180,255,.28);background:rgba(12,20,42,.72);color:#cbd7ee;border-radius:999px;padding:.48rem .8rem;font:inherit;font-size:.78rem;cursor:pointer}
    .capability-mode-switch button.active{border-color:rgba(100,225,255,.7);background:rgba(50,150,190,.2);color:white}
    .capability-mode-detail{font-size:.78rem;line-height:1.45;color:#aebbd0;margin-bottom:.6rem}
    .capability-current-hero,.capability-delta-left{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:4}
    .capability-delta-wrap{position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden}
    .capability-delta-left{width:50%;right:auto}
    .capability-delta-divider{position:absolute;left:50%;top:0;bottom:0;width:2px;background:rgba(255,255,255,.72);box-shadow:0 0 18px rgba(100,220,255,.55)}
    .capability-delta-label{position:absolute;top:18px;z-index:6;padding:.42rem .65rem;border-radius:999px;background:rgba(4,9,20,.78);border:1px solid rgba(255,255,255,.22);font-size:.68rem;font-weight:700;letter-spacing:.08em;color:white}
    .capability-delta-label.current{left:18px}.capability-delta-label.concept{right:18px}
    .capability-delta-summary{position:absolute;left:18px;right:18px;bottom:18px;z-index:6;padding:.7rem .85rem;border-radius:14px;background:rgba(3,8,18,.84);backdrop-filter:blur(10px);color:#d8e5f6;font-size:.76rem;line-height:1.45;text-align:left}
    .capability-mode-badge{display:inline-flex;margin-left:.35rem;padding:.1rem .38rem;border-radius:999px;border:1px solid rgba(155,140,255,.34);color:#c6cfff;font-size:.68rem}
    @media (max-width:720px){.capability-delta-summary{font-size:.68rem}.capability-mode-switch{gap:.3rem}.capability-mode-switch button{padding:.4rem .62rem}}
  `;
  document.head.append(style);
}

function decorateTopPercentages() {
  document.querySelectorAll('#conceptThumbnails .concept-thumbnail[data-concept-id]').forEach((button) => {
    const small = button.querySelector('.thumbnail-copy small');
    if (!small) return;
    const conceptId = button.dataset.conceptId;
    const researchLabel = small.dataset.researchLabel || (small.textContent.match(/\d+% research fit/i)?.[0] || small.textContent.trim());
    small.dataset.researchLabel = researchLabel;
    const result = readiness(conceptId);
    setText(small, `${researchLabel} · ${result.available ? `${result.percent}% capability` : '— capability'}`);
    small.title = capabilityReadinessSummary(result);
  });
  const rankPill = document.querySelector('#conceptStage .rank-pill');
  if (rankPill) {
    const result = readiness(selectedConceptId());
    const researchLabel = rankPill.dataset.researchLabel || rankPill.textContent.replace(/\s*·\s*CAPABILITY\s+(?:\d+%|—).*$/i, '').trim();
    rankPill.dataset.researchLabel = researchLabel;
    setText(rankPill, `${researchLabel} · CAPABILITY ${result.available ? `${result.percent}%` : '—'}`);
    rankPill.title = capabilityReadinessSummary(result);
  }
}

function ensureCurrentSection() {
  const top = document.getElementById('conceptThumbnails');
  if (!top) return null;
  let section = document.querySelector('.capability-current-section');
  if (!section) {
    section = document.createElement('div');
    section.className = 'capability-current-section';
    section.innerHTML = `<div class="thumbnail-heading"><div><div class="kicker">Grounded reality</div><h3>Current Capability Views</h3></div><span>same 10 concepts · evidence-gated visual maturity</span></div><div id="currentCapabilityThumbnails" class="concept-thumbnails" role="list" aria-label="Current capability views"></div>`;
    top.insertAdjacentElement('afterend', section);
  }
  return section;
}

function renderCurrentStrip() {
  const section = ensureCurrentSection();
  if (!section) return;
  const topButtons = [...document.querySelectorAll('#conceptThumbnails .concept-thumbnail[data-concept-id]')];
  if (!topButtons.length) return;
  const signature = `${ledger?.updatedAt || 'none'}|${topButtons.map((button) => button.dataset.conceptId).join('|')}`;
  if (signature === lastStripSignature) return;
  lastStripSignature = signature;
  const grid = section.querySelector('#currentCapabilityThumbnails');
  grid.innerHTML = topButtons.map((button) => {
    const id = button.dataset.conceptId;
    const concept = conceptsById.get(id) || { id, title: id };
    const result = readiness(id);
    const truthLabel = result.visual?.truthLabel || maturityBandForPercent(result.percent).replaceAll('-', ' ');
    return `<button class="concept-thumbnail capability-current-thumbnail ${button.classList.contains('selected') ? 'selected' : ''}" type="button" role="listitem" data-current-concept-id="${xml(id)}" aria-label="Show current capability for ${xml(concept.title)}"><span class="thumbnail-media"><img src="${svgDataUrl(concept, result)}" width="640" height="360" loading="lazy" decoding="async" alt="Current capability projection for ${xml(concept.title)}"></span><span class="thumbnail-copy"><b>${xml(concept.title)}</b><small>${result.available ? `${result.percent}% capability` : '— capability'} · ${xml(truthLabel)}</small></span></button>`;
  }).join('');
  grid.querySelectorAll('[data-current-concept-id]').forEach((button) => button.addEventListener('click', () => {
    heroMode = 'current';
    const topButton = document.querySelector(`#conceptThumbnails [data-concept-id="${CSS.escape(button.dataset.currentConceptId)}"]`);
    topButton?.click();
    queueDecorate();
    document.getElementById('conceptStage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function syncCurrentSelection() {
  const selected = selectedConceptId();
  document.querySelectorAll('[data-current-concept-id]').forEach((button) => button.classList.toggle('selected', button.dataset.currentConceptId === selected));
}

function ensureHeroModeControls() {
  const copy = document.querySelector('#conceptStage .concept-feature-copy');
  if (!copy) return;
  let controls = copy.querySelector('.capability-mode-switch');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'capability-mode-switch';
    controls.setAttribute('aria-label', 'Hero view mode');
    controls.innerHTML = `<button type="button" data-capability-mode="concept">Concept</button><button type="button" data-capability-mode="current">Current Capability</button><button type="button" data-capability-mode="delta">Delta</button>`;
    const detail = document.createElement('div');
    detail.className = 'capability-mode-detail';
    controls.insertAdjacentElement('afterend', detail);
    copy.firstElementChild?.insertAdjacentElement('afterend', controls);
    controls.querySelectorAll('[data-capability-mode]').forEach((button) => button.addEventListener('click', () => {
      heroMode = button.dataset.capabilityMode;
      applyHeroMode();
    }));
  }
}

function applyHeroMode() {
  const feature = document.querySelector('#conceptHeroButton');
  if (!feature) return;
  const id = selectedConceptId();
  const concept = conceptsById.get(id);
  if (!concept) return;
  const result = readiness(id);
  ensureHeroModeControls();
  const copy = document.querySelector('#conceptStage .concept-feature-copy');
  copy?.querySelectorAll('[data-capability-mode]').forEach((button) => button.classList.toggle('active', button.dataset.capabilityMode === heroMode));
  const detail = copy?.querySelector('.capability-mode-detail');
  const missing = result.gates.filter((gate) => !gate.proven).map((gate) => gate.label);
  if (detail) {
    if (heroMode === 'concept') setText(detail, `Concept projection. Research fit shows support strength; capability readiness is ${result.available ? `${result.percent}%` : 'unavailable'}.`);
    if (heroMode === 'current') setText(detail, result.available ? `${result.visual?.truthLabel || maturityBandForPercent(result.percent)} · ${result.visual?.deltaSummary || capabilityReadinessSummary(result)}` : capabilityReadinessSummary(result));
    if (heroMode === 'delta') setText(detail, `${result.available ? `${result.percent}% capability` : 'Capability unavailable'} · missing gates: ${missing.length ? missing.join(', ') : 'none'}.`);
  }

  feature.querySelectorAll('.capability-current-hero,.capability-delta-wrap').forEach((node) => node.remove());
  const signature = `${heroMode}:${id}:${result.available ? result.percent : 'na'}:${ledger?.updatedAt || 'none'}`;
  feature.dataset.capabilityHeroSignature = signature;
  if (heroMode === 'concept') return;
  const currentSrc = svgDataUrl(concept, result);
  if (heroMode === 'current') {
    const image = document.createElement('img');
    image.className = 'capability-current-hero';
    image.src = currentSrc;
    image.alt = `Current capability projection for ${concept.title}`;
    feature.append(image);
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'capability-delta-wrap';
  const summary = result.visual?.deltaSummary || capabilityReadinessSummary(result);
  wrap.innerHTML = `<img class="capability-delta-left" src="${currentSrc}" alt=""><span class="capability-delta-divider"></span><span class="capability-delta-label current">CURRENT · ${result.available ? `${result.percent}%` : '—'}</span><span class="capability-delta-label concept">CONCEPT</span><div class="capability-delta-summary"><strong>Capability delta:</strong> ${xml(summary)}<br><strong>Still missing:</strong> ${xml(missing.length ? missing.join(' · ') : 'no proof gates')}</div>`;
  feature.append(wrap);
}

function decorateMeta() {
  const meta = document.getElementById('conceptMeta');
  if (!meta) return;
  const suffix = ' Capability readiness is absolute proof-backed progress. The lower row shows the strongest view Stephanos can justify now; stale evidence is shown as unavailable rather than guessed.';
  const base = meta.dataset.capabilityBase || meta.textContent.replace(suffix, '').trim();
  meta.dataset.capabilityBase = base;
  setText(meta, `${base}${suffix}`);
  meta.title = ledger ? `Capability ledger: ${ledgerSource || 'canonical'} · ${ledger.updatedAt || 'unknown update'} · source ${String(ledger.sourceHead || '').slice(0, 12) || 'unknown'}` : 'Capability ledger unavailable; no capability percentage is guessed.';
}

function decorateAll() {
  ensureStyles();
  decorateTopPercentages();
  renderCurrentStrip();
  syncCurrentSelection();
  ensureHeroModeControls();
  applyHeroMode();
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

async function refreshLedger() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = firstJson(LEDGER_PATHS)
    .then((result) => { ledger = result.data; ledgerSource = result.url; lastStripSignature = ''; })
    .catch((error) => { console.warn('VR Atlas capability readiness unavailable', error); ledger = null; ledgerSource = ''; lastStripSignature = ''; })
    .finally(() => { refreshPromise = null; queueDecorate(); });
  return refreshPromise;
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  document.addEventListener('click', (event) => {
    const top = event.target.closest?.('#conceptThumbnails [data-concept-id]');
    if (top) heroMode = 'concept';
  }, true);
  const observer = new MutationObserver((records) => {
    if (records.some((record) => [...record.addedNodes].some((node) => node?.id === 'conceptStage' || node?.querySelector?.('#conceptStage,.concept-thumbnail')) || record.target?.id === 'conceptStage' || record.target?.id === 'conceptThumbnails')) queueDecorate();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  refreshLedger();
  queueDecorate();
  globalThis.setInterval?.(refreshLedger, 60_000);
}
