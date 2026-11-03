
const ZONES = [
  { id: 'overview-mission', label: 'Mission', icon: '◎' },
  { id: 'knowledge-shape', label: 'Knowledge', icon: '◈' },
  { id: 'techniques-experiments', label: 'Methods', icon: '✦' },
  { id: 'workspace-links-next-steps', label: 'Evidence', icon: '▦' },
  { id: 'system-insight', label: 'Watcher', icon: '⌁' },
  { id: 'mission-console', label: 'Stephanos', icon: '◇' },
];

const LENSES = [
  { label: 'All', value: '' },
  { label: 'Starfield', value: 'starfield' },
  { label: 'Rendering', value: 'render stereo openxr camera frame' },
  { label: 'Interaction', value: 'hand body interaction holster controller weapon' },
  { label: 'Evidence', value: 'proof source licence evidence runtime operator' },
];

function node(tag, className = '', text = '') {
  const out = document.createElement(tag);
  if (className) out.className = className;
  if (text) out.textContent = text;
  return out;
}

function zone(id) {
  return document.querySelector('[data-panel-id="' + id + '"]');
}

function enhanceTitle(panel, icon) {
  const title = panel?.querySelector('h2.title');
  if (!title || title.dataset.deepEnhanced === 'true') return;
  title.dataset.deepEnhanced = 'true';
  title.dataset.icon = icon;
  title.classList.add('vr-deep-panel-title');
}

function addRail(card, tone = '') {
  if (!card || card.querySelector(':scope > .vr-card-rail')) return;
  card.prepend(node('span', 'vr-card-rail ' + tone));
}

function domainFor(text = '') {
  const value = text.toLowerCase();
  if (/starfield|ship|cockpit|creation kit/.test(value)) return ['starship', 'violet'];
  if (/hand|body|weapon|holster|interaction|controller/.test(value)) return ['embodiment', 'green'];
  if (/openxr|stereo|render|camera|frame|latency|fove/.test(value)) return ['rendering', ''];
  if (/licen|source|proof|evidence|registry|provenance/.test(value)) return ['evidence', 'amber'];
  if (/dialogue|cinematic|hud|ui|subtitle|menu/.test(value)) return ['presentation', 'violet'];
  return ['research', ''];
}

function experimentPhase(status = '') {
  const value = status.toLowerCase();
  if (/validated|proven|complete|accepted/.test(value)) return 4;
  if (/testing|runtime|playtest/.test(value)) return 3;
  if (/research|awaiting|source|extract/.test(value)) return 2;
  return 1;
}

function enhanceCards() {
  document.querySelectorAll('#targets-grid .card').forEach((card) => {
    if (card.dataset.deepEnhanced === 'true') return;
    card.dataset.deepEnhanced = 'true';
    addRail(card, 'violet');
    const [domain] = domainFor(card.textContent);
    card.append(node('span', 'vr-domain-badge', 'TARGET · ' + domain));
  });

  document.querySelectorAll('#bucket-grid .card').forEach((card) => {
    if (card.dataset.deepEnhanced === 'true') return;
    card.dataset.deepEnhanced = 'true';
    const [domain, tone] = domainFor(card.textContent);
    addRail(card, tone);
    card.append(node('span', 'vr-domain-badge', domain));
  });

  document.querySelectorAll('#techniques-grid .card').forEach((card) => {
    if (card.dataset.deepEnhanced === 'true') return;
    card.dataset.deepEnhanced = 'true';
    const [domain, tone] = domainFor(card.textContent);
    addRail(card, tone);
    card.append(node('span', 'vr-domain-badge', 'METHOD · ' + domain));
  });

  document.querySelectorAll('#experiments-grid .card').forEach((card) => {
    if (card.dataset.deepEnhanced === 'true') return;
    card.dataset.deepEnhanced = 'true';
    const status = card.querySelector('.pill')?.textContent || '';
    const phase = experimentPhase(status);
    const track = node('div', 'vr-experiment-track');
    for (let i = 1; i <= 4; i += 1) track.append(node('span', i <= phase ? 'on' : ''));
    card.append(track);
    const [domain, tone] = domainFor(card.textContent);
    addRail(card, tone);
    card.append(node('span', 'vr-domain-badge', 'EXPERIMENT · ' + domain));
  });

  document.querySelectorAll('#watcher-insight .card').forEach((card) => {
    if (card.dataset.deepEnhanced === 'true') return;
    card.dataset.deepEnhanced = 'true';
    addRail(card, card.classList.contains('ok') ? 'green' : card.classList.contains('warn') ? 'amber' : '');
  });
}

function enhanceLists() {
  document.getElementById('overview-list')?.classList.add('vr-overview-brief');
  document.getElementById('folder-map')?.classList.add('vr-evidence-vault');
  document.getElementById('next-actions')?.classList.add('vr-runway');
  document.getElementById('integration-seams')?.classList.add('vr-seams');
}

function counts() {
  return {
    targets: document.querySelectorAll('#targets-grid .card').length,
    domains: document.querySelectorAll('#bucket-grid .card').length,
    methods: document.querySelectorAll('#techniques-grid .card').length,
    experiments: document.querySelectorAll('#experiments-grid .card').length,
    actions: document.querySelectorAll('#next-actions li').length,
    watcher: document.querySelectorAll('#watcher-insight .card').length,
  };
}

function ensureDeck() {
  let deck = document.getElementById('vr-deep-deck');
  if (deck) return deck;

  deck = node('section', 'vr-deep-deck');
  deck.id = 'vr-deep-deck';
  const inner = node('div', 'vr-deep-deck-inner');

  const head = node('div', 'vr-deep-deck-head');
  const intro = node('div');
  intro.append(
    node('h2', 'vr-deep-deck-title', 'Deep Evidence · upgraded'),
    node('p', 'vr-deep-deck-copy', 'The original VR Research Lab, rebuilt as an evidence flight deck. Search, jump, inspect and reason without losing the canonical detail.')
  );

  const nav = node('div', 'vr-deep-deck-nav');
  for (const item of ZONES) {
    const button = node('button', '', item.icon + ' ' + item.label);
    button.type = 'button';
    button.addEventListener('click', () => zone(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    nav.append(button);
  }
  head.append(intro, nav);

  const kpis = node('div', 'vr-deep-kpis');
  for (const label of ['targets', 'domains', 'methods', 'experiments', 'next moves', 'watcher signals']) {
    const box = node('div', 'vr-deep-kpi');
    const value = node('strong', '', '0');
    value.dataset.deepKpi = label;
    box.append(value, node('span', '', label));
    kpis.append(box);
  }

  const search = node('div', 'vr-deep-search');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search the evidence deck: Starfield, stereo, hands, licences, runtime proof…';
  input.id = 'vr-deep-search';
  const reset = node('button', 'vr-lens-button', 'Clear lens');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    input.value = '';
    applySearch('');
    input.focus();
  });
  input.addEventListener('input', () => applySearch(input.value));
  search.append(input, reset);

  const lenses = node('div', 'vr-deep-lens-row');
  for (const lens of LENSES) {
    const button = node('button', 'vr-lens-button', lens.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      input.value = lens.value;
      applySearch(lens.value);
    });
    lenses.append(button);
  }

  inner.append(head, kpis, search, lenses);
  deck.append(inner);

  const surface = document.querySelector('.surface');
  surface?.before(deck);
  return deck;
}

function updateKpis() {
  const c = counts();
  const values = {
    targets: c.targets,
    domains: c.domains,
    methods: c.methods,
    experiments: c.experiments,
    'next moves': c.actions,
    'watcher signals': c.watcher || 'live',
  };
  for (const [label, value] of Object.entries(values)) {
    const out = document.querySelector('[data-deep-kpi="' + label + '"]');
    if (out) out.textContent = String(value);
  }
}

function applySearch(query) {
  const terms = String(query || '').toLowerCase().split(/s+/).filter(Boolean);
  const candidates = document.querySelectorAll(
    '#targets-grid .card, #bucket-grid .card, #techniques-grid .card, #experiments-grid .card, #folder-map li, #next-actions li, #integration-seams li, #watcher-insight .card'
  );
  candidates.forEach((item) => {
    const text = item.textContent.toLowerCase();
    const visible = !terms.length || terms.some((term) => text.includes(term));
    item.classList.toggle('vr-deep-hidden', !visible);
  });
}

function quickPrompt(label, text) {
  const button = node('button', 'vr-console-prompt', label);
  button.type = 'button';
  button.addEventListener('click', () => {
    const prompt = document.getElementById('prompt-input');
    if (!prompt) return;
    const selected = globalThis.__STEPHANOS_VR_RESEARCH_SELECTION__;
    const prefix = selected
      ? 'Focus on selected object: ' + selected.kind + ' / ' + selected.title + '.\n\n'
      : '';
    prompt.value = prefix + text;
    prompt.focus();
  });
  return button;
}

function enhanceConsole() {
  const consolePanel = zone('mission-console');
  if (!consolePanel || consolePanel.dataset.deepEnhanced === 'true') return;
  consolePanel.dataset.deepEnhanced = 'true';
  consolePanel.classList.add('vr-console-deluxe');
  enhanceTitle(consolePanel, '◇');

  const orbit = node('div', 'vr-console-orbit');
  const orbitHead = node('div', 'vr-console-orbit-head');
  orbitHead.append(
    node('span', 'vr-console-orbit-title', 'Research co-pilot lenses'),
    node('span', 'vr-console-selection', 'No visual object selected')
  );
  const prompts = node('div', 'vr-console-quickprompts');
  prompts.append(
    quickPrompt('What changed?', 'Compare the newest canonical VR evidence with the existing research model. Summarise what materially changed and what should be updated.'),
    quickPrompt('Find contradictions', 'Find contradictions, stale assumptions and weak evidence in the current VR research state. Separate proven facts from inference.'),
    quickPrompt('Design next test', 'Choose the highest-value next VR experiment. Give the hypothesis, variables, telemetry, pass/fail criteria and what result would change our direction.'),
    quickPrompt('Promote method', 'Look for a repeated result that deserves promotion into a reusable VR method. Explain the evidence, scope, limits and next proof gate.')
  );
  orbit.append(orbitHead, prompts);

  const title = consolePanel.querySelector('h2.title');
  title?.insertAdjacentElement('afterend', orbit);

  window.addEventListener('stephanos:vr-research-selection', (event) => {
    const selected = event.detail;
    const label = consolePanel.querySelector('.vr-console-selection');
    if (label) label.textContent = selected ? selected.kind + ' · ' + selected.title : 'No visual object selected';
  });
}

function enhancePanels() {
  for (const item of ZONES) enhanceTitle(zone(item.id), item.icon);
}

function enhanceAll() {
  ensureDeck();
  enhancePanels();
  enhanceLists();
  enhanceCards();
  enhanceConsole();
  updateKpis();
}

const surface = document.querySelector('.surface');
if (surface) {
  const observer = new MutationObserver(() => enhanceAll());
  observer.observe(surface, { childList: true, subtree: true });
}

enhanceAll();
setTimeout(enhanceAll, 250);
setTimeout(enhanceAll, 1200);
