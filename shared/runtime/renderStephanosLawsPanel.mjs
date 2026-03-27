import { stephanosLaws, STEPHANOS_LAWS_VERSION } from './stephanosLaws.mjs';

function groupLawsByCategory(laws = []) {
  return laws.reduce((accumulator, law) => {
    const category = String(law?.category || 'uncategorized').trim() || 'uncategorized';
    if (!accumulator[category]) {
      accumulator[category] = [];
    }
    accumulator[category].push(law);
    return accumulator;
  }, {});
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderLawCard(law) {
  const relatedFiles = Array.isArray(law.relatedFiles) ? law.relatedFiles : [];

  return `
    <details class="stephanos-law-card" data-law-id="${escapeHtml(law.id)}">
      <summary>
        <span class="stephanos-law-title">${escapeHtml(law.title)}</span>
        <span class="stephanos-law-meta">${escapeHtml(law.severity)} · ${escapeHtml(law.invariantType)}</span>
      </summary>
      <p class="stephanos-law-short">${escapeHtml(law.shortStatement)}</p>
      <p>${escapeHtml(law.fullDescription)}</p>
      <ul>
        <li><strong>Operator:</strong> ${escapeHtml(law.operatorImplication)}</li>
        <li><strong>Engineering:</strong> ${escapeHtml(law.engineeringImplication)}</li>
        <li><strong>Status:</strong> ${escapeHtml(law.status)}</li>
        <li><strong>Law ID:</strong> <code>${escapeHtml(law.id)}</code></li>
        <li><strong>Test hint:</strong> ${escapeHtml(law.testCoverageHint)}</li>
      </ul>
      <p><strong>Related files:</strong> ${relatedFiles.map((filePath) => `<code>${escapeHtml(filePath)}</code>`).join(', ')}</p>
    </details>
  `;
}

export function renderStephanosLawsPanel(documentRef = globalThis.document, options = {}) {
  const mountId = options.mountId || 'stephanos-laws-mount';
  const mount = documentRef?.getElementById?.(mountId);
  if (!mount) {
    return false;
  }

  const laws = Array.isArray(options.laws) ? options.laws : stephanosLaws;
  const grouped = groupLawsByCategory(laws);
  const categoryMarkup = Object.entries(grouped)
    .map(([category, categoryLaws]) => `
      <section class="stephanos-law-category" data-law-category="${escapeHtml(category)}">
        <h3>${escapeHtml(category)}</h3>
        ${categoryLaws.map((law) => renderLawCard(law)).join('\n')}
      </section>
    `)
    .join('\n');

  mount.innerHTML = `
    <section class="stephanos-laws-panel" aria-label="Laws of Stephanos">
      <h2>Laws of Stephanos</h2>
      <p class="stephanos-laws-intro">
        Constitutional layer v${escapeHtml(STEPHANOS_LAWS_VERSION)} · launcher truth, runtime truth, build truth, and cross-device direction.
      </p>
      ${categoryMarkup}
    </section>
  `;

  return true;
}
