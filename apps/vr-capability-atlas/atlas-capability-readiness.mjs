import {
  capabilityReadinessForConcept,
  capabilityReadinessSummary,
} from './capability-readiness-core.mjs';

const LEDGER_PATHS = [
  '../../VR-Research-Lab/capability-readiness.json',
  'https://raw.githubusercontent.com/Cheekyfellastef/stephan-os/main/VR-Research-Lab/capability-readiness.json',
];

let ledger = null;
let ledgerSource = '';
let refreshPromise = null;
let decorateQueued = false;

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

function capabilityLabel(result) {
  return result.available ? `${result.percent}% capability` : '— capability';
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function decorateThumbnail(button) {
  const conceptId = String(button?.dataset?.conceptId || '');
  if (!conceptId) return;
  const small = button.querySelector('.thumbnail-copy small');
  if (!small) return;
  const researchLabel = small.dataset.researchLabel
    || (small.textContent.match(/\d+% research fit/i)?.[0] || small.textContent.trim());
  if (!small.dataset.researchLabel) small.dataset.researchLabel = researchLabel;
  const result = readiness(conceptId);
  const next = `${researchLabel} · ${capabilityLabel(result)}`;
  setText(small, next);
  small.title = capabilityReadinessSummary(result);
}

function selectedConceptId() {
  return String(
    document.querySelector('#conceptHeroButton picture[data-media-asset]')?.dataset?.mediaAsset
    || document.querySelector('.concept-thumbnail.selected')?.dataset?.conceptId
    || '',
  );
}

function decorateFeatured() {
  const conceptId = selectedConceptId();
  if (!conceptId) return;
  const result = readiness(conceptId);
  const rankPill = document.querySelector('#conceptStage .rank-pill');
  if (rankPill) {
    const researchLabel = rankPill.dataset.researchLabel
      || rankPill.textContent.replace(/\s*·\s*CAPABILITY\s+(?:\d+%|—).*$/i, '').trim();
    if (!rankPill.dataset.researchLabel) rankPill.dataset.researchLabel = researchLabel;
    setText(rankPill, `${researchLabel} · CAPABILITY ${result.available ? `${result.percent}%` : '—'}`);
    rankPill.title = capabilityReadinessSummary(result);
  }

  const evidence = document.querySelector('#conceptStage .concept-evidence');
  if (!evidence) return;
  let audit = evidence.querySelector('[data-capability-readiness-audit]');
  if (!audit) {
    audit = document.createElement('span');
    audit.dataset.capabilityReadinessAudit = 'true';
    audit.style.display = 'block';
    audit.style.marginTop = '.5rem';
    audit.style.fontSize = '.78rem';
    audit.style.opacity = '.78';
    const tags = evidence.querySelector('.concept-tags');
    evidence.insertBefore(audit, tags || null);
  }
  const source = result.sourceHead ? ` · evidence ${result.sourceHead.slice(0, 8)}` : '';
  setText(audit, `${capabilityReadinessSummary(result)}${source}`);
  audit.title = result.available
    ? result.gates.map((gate) => `${gate.proven ? '✓' : '○'} ${gate.label} (${gate.weight}%): ${gate.note || gate.status}`).join('\n')
    : capabilityReadinessSummary(result);
}

function decorateMeta() {
  const meta = document.querySelector('#conceptMeta');
  if (!meta) return;
  const suffix = ' Capability readiness is absolute proof-backed progress, not a relative ranking; unproven stages add zero and stale evidence shows as unavailable.';
  const base = meta.dataset.capabilityBase || meta.textContent.replace(suffix, '').trim();
  if (!meta.dataset.capabilityBase) meta.dataset.capabilityBase = base;
  setText(meta, `${base}${suffix}`);
  meta.title = ledger
    ? `Capability ledger: ${ledgerSource || 'canonical'} · ${ledger.updatedAt || 'unknown update'} · source ${String(ledger.sourceHead || '').slice(0, 12) || 'unknown'}`
    : 'Capability ledger unavailable; no capability percentage is guessed.';
}

function decorateAll() {
  document.querySelectorAll('.concept-thumbnail[data-concept-id]').forEach(decorateThumbnail);
  decorateFeatured();
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
    .then((result) => {
      ledger = result.data;
      ledgerSource = result.url;
    })
    .catch((error) => {
      console.warn('VR Atlas capability readiness unavailable', error);
      ledger = null;
      ledgerSource = '';
    })
    .finally(() => {
      refreshPromise = null;
      queueDecorate();
    });
  return refreshPromise;
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(queueDecorate);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  refreshLedger();
  queueDecorate();
  globalThis.setInterval?.(refreshLedger, 60_000);
}
